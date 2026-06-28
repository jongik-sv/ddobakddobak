require "rubygems/package"
require "zlib"
require "json"
require "fileutils"
require "tempfile"

# FolderExporter が作った .ddobak-folder.tgz を読んで現在のプロジェクトの
# フォルダサブツリーとして復元する (stdlib only).
#
# 사용법:
#   result = FolderImporter.new(io, user:, project:, parent_folder: nil).run!
#   result[:folder_id]    # 새 루트 폴더 ID
#   result[:meeting_ids]  # 새 회의 ID 배열
#
# 예외:
#   Transfer::Archive::InvalidArchiveError  — 손상 파일·scope!="folder"·미지원 버전·zip-bomb
#   Transfer::Archive::UnsafeEntryError     — zip-slip 공격 경로 감지
class FolderImporter
  CHUNK_SIZE               = 64 * 1024
  SUPPORTED_FORMAT_VERSION = 1

  # @param io_or_path [IO, String]       tar.gz 스트림 또는 파일 경로
  # @param user [User]                   새 컨텐츠 소유자
  # @param project [Project]             대상 프로젝트
  # @param parent_folder [Folder, nil]   import 후 루트 폴더의 부모 (nil=프로젝트 루트)
  def initialize(io_or_path, user:, project:, parent_folder: nil)
    @io_or_path       = io_or_path
    @user             = user
    @project          = project
    @parent_folder    = parent_folder
    @staged_paths     = {}   # tar 엔트리명 → staged Tempfile 경로
    @staged_files     = []   # Tempfile 객체 보관(GC 방지)
    @all_copied_paths = []   # 트랜잭션 실패 시 롤백할 storage/ 파일
    @root_folder      = nil  # import 후 루트 Folder 레코드
  end

  # @return [Hash] { folder_id: Integer, meeting_ids: [Integer, ...] }
  def run!
    manifest     = read_archive
    validate_manifest!(manifest)

    new_meetings = []

    begin
      ActiveRecord::Base.transaction do
        tag_map      = build_tag_map(manifest["tags"] || [])
        folder_map   = import_folders(manifest, tag_map)
        new_meetings = import_meetings(manifest, folder_map, tag_map)
      end
    rescue StandardError
      # 트랜잭션 실패 시에만 복사된 storage/ 파일 롤백
      @all_copied_paths.each { |path| FileUtils.rm_f(path) }
      raise
    ensure
      # 트랜잭션 성공·실패 무관, staged tempfile 은 항상 정리
      cleanup_staged_files
    end

    # ↓ 커밋 확정 후. 여기서 raise 해도 copied_paths 는 절대 삭제 안 됨
    new_meetings.each do |mtg|
      EmbedBackfillJob.perform_later(meeting_id: mtg.id) if mtg.transcripts.exists?
    end

    { folder_id: @root_folder.id, meeting_ids: new_meetings.map(&:id) }
  end

  private

  # ── tar.gz 읽기 ──

  # 아카이브를 스트리밍으로 읽어 manifest.json 을 파싱하고
  # 나머지 엔트리(audio/·attachments/)는 Tempfile 에 스테이징.
  # @return [Hash, nil] 파싱된 manifest (없으면 nil)
  def read_archive
    manifest = nil
    counter  = [0]  # zip-bomb 바이트 카운터

    open_gz do |gz|
      Gem::Package::TarReader.new(gz) do |tar|
        tar.each do |entry|
          next unless entry.file?

          name = entry.full_name
          Transfer::Archive.guard_entry_name!(name)

          if name == "manifest.json"
            bytes = entry.read.to_s
            Transfer::Archive.account_bytes!(bytes.bytesize, counter)
            manifest = JSON.parse(bytes)
          else
            stage_entry(name, entry, counter)
          end
        end
      end
    end

    manifest
  end

  # 엔트리를 Tempfile 에 청크 단위로 쓰고 스테이징 맵에 등록.
  def stage_entry(name, entry, counter)
    tmp = Tempfile.new(["ddobak-folder-import", File.extname(name)])
    tmp.binmode
    @staged_files << tmp  # GC 방지

    begin
      while (chunk = entry.read(CHUNK_SIZE))
        Transfer::Archive.account_bytes!(chunk.bytesize, counter)
        tmp.write(chunk)
      end
    ensure
      tmp.close  # flush + fd 반납. 파일은 남김(close! 가 아님)
    end

    @staged_paths[name] = tmp.path
  end

  # ── 검증 ──

  def validate_manifest!(manifest)
    raise Transfer::Archive::InvalidArchiveError, "manifest.json missing" if manifest.nil?

    version = manifest["format_version"]
    unless version == SUPPORTED_FORMAT_VERSION
      raise Transfer::Archive::InvalidArchiveError,
            "unsupported format_version: #{version.inspect}"
    end

    scope = manifest["scope"]
    unless scope == "folder"
      raise Transfer::Archive::InvalidArchiveError,
            "expected scope=folder, got #{scope.inspect}"
    end
  end

  # ── 태그 맵 ──

  # 태그 이름 기준으로 dedup. 없으면 대상 프로젝트에 생성.
  # @param tags_data [Array<Hash>] manifest["tags"]
  # @return [Hash] old_tag_id → Tag
  def build_tag_map(tags_data)
    map = {}
    tags_data.each do |t|
      old_id = t["id"]
      tag = Tag.find_or_create_by!(name: t["name"]) do |new_tag|
        new_tag.color      = t["color"].presence || "#6b7280"
        new_tag.project_id = @project.id
      end
      map[old_id] = tag
    end
    map
  end

  # ── 폴더 (2-pass) ──

  # 1패스: 모든 폴더를 parent_id=nil 로 생성하며 old_id → new folder 맵 작성.
  #         루트 폴더(원본 parent_id 가 export 세트 밖)만 @parent_folder&.id 로 설정.
  # 2패스: export 세트 내 parent_id 를 새 맵으로 리맵해 계층 연결.
  # 각 폴더의 glossary_entries·taggings 도 함께 복원.
  def import_folders(manifest, tag_map)
    folders_data = manifest["folders"] || []
    exported_ids = folders_data.map { |f| f["id"] }.to_set

    # 루트: parent_id 가 export 세트에 없는 폴더
    root_data = folders_data.find { |f| !exported_ids.include?(f["parent_id"]) }

    folder_map = {}

    # Pass 1
    folders_data.each do |f|
      attrs  = Transfer::Archive.sanitize(Folder, f)
      old_id = f["id"]
      is_root = root_data && (old_id == root_data["id"])

      new_folder = Folder.create!(attrs.merge(
        "project_id" => @project.id,
        "parent_id"  => is_root ? @parent_folder&.id : nil
      ))
      folder_map[old_id] = new_folder

      import_folder_glossary(new_folder, f["glossary_entries"] || [])
      import_folder_taggings(new_folder, f["tag_ids"] || [], tag_map)
    end

    @root_folder = folder_map[root_data["id"]] if root_data

    # Pass 2: export 세트 내 parent_id 만 리맵
    folders_data.each do |f|
      old_parent = f["parent_id"]
      next unless exported_ids.include?(old_parent)

      child  = folder_map[f["id"]]
      parent = folder_map[old_parent]
      child.update_column(:parent_id, parent.id) if child && parent
    end

    folder_map
  end

  # 폴더 소유 오타사전 재생성 (owner=새 folder, created_by=범위 밖 유저 참조 제거).
  def import_folder_glossary(folder, entries)
    entries.each do |g|
      attrs = Transfer::Archive.sanitize(GlossaryEntry, g)
      attrs["owner_type"]    = "Folder"
      attrs["owner_id"]      = folder.id
      attrs["created_by_id"] = nil
      GlossaryEntry.create!(attrs)
    end
  end

  # 폴더 태그 재생성 (taggable=새 folder, tag=리맵).
  def import_folder_taggings(folder, tag_ids, tag_map)
    tag_ids.each do |old_tag_id|
      tag = tag_map[old_tag_id]
      next unless tag
      Tagging.find_or_create_by!(tag: tag, taggable: folder)
    end
  end

  # ── 회의 (2-pass) ──

  # 1패스: 각 회의를 MeetingRestorer 로 복원 (previous_meeting_id=nil).
  #         restorer.copied_paths 를 @all_copied_paths 에 누적.
  # 2패스: previous_meeting_id 를 서브트리 내에서만 리맵
  #         (범위 밖이면 nil 유지).
  def import_meetings(manifest, folder_map, tag_map)
    meetings_data = manifest["meetings"] || []
    meeting_map   = {}
    new_meetings  = []
    tag_resolver  = ->(old_tag_id) { tag_map[old_tag_id] }

    # Pass 1
    meetings_data.each do |m|
      restorer = Transfer::MeetingRestorer.new(
        m,
        user:                @user,
        project:             @project,
        file_lookup:         @staged_paths,
        folder_id:           folder_map[m["folder_id"]]&.id,
        previous_meeting_id: nil,
        tag_resolver:        tag_resolver
      )
      new_meeting = restorer.restore!
      @all_copied_paths.concat(restorer.copied_paths)
      meeting_map[m["id"]] = new_meeting
      new_meetings << new_meeting
    end

    # Pass 2: 서브트리 내 previous_meeting_id 리맵 (범위 밖이면 nil 유지)
    meetings_data.each do |m|
      old_prev = m["previous_meeting_id"]
      next if old_prev.nil?

      new_prev = meeting_map[old_prev]
      next unless new_prev

      meeting_map[m["id"]].update_column(:previous_meeting_id, new_prev.id)
    end

    new_meetings
  end

  # ── GZip 열기 ──

  # IO 또는 경로 양쪽 허용.
  def open_gz(&block)
    if @io_or_path.respond_to?(:read)
      @io_or_path.rewind if @io_or_path.respond_to?(:rewind)
      gz = Zlib::GzipReader.new(@io_or_path)
      begin
        yield gz
      ensure
        gz.finish rescue nil
      end
    else
      Zlib::GzipReader.open(@io_or_path) { |gz| yield gz }
    end
  end

  # ── 정리 ──

  def cleanup_staged_files
    @staged_files.each do |tmp|
      tmp.close! if tmp.respond_to?(:close!) rescue nil
    end
    @staged_files.clear
  end
end
