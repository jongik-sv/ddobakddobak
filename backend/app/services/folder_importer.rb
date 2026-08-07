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
#   result[:warnings]     # 복원 경고 메시지 배열(예: public_uid 충돌, 화자 DB 복원 실패). 보통 빈 배열.
#
# speakers/<원본meeting_id>.json 엔트리는 회의별 sidecar SpeakerDB(화자 이름·임베딩)다.
# 디스크에 스테이징해 두었다가 DB 커밋 **후** 각 회의의 **새 id** 로 복원한다.
# 엔트리가 없는 구버전 아카이브는 조용히 통과(하위호환), 실패는 warnings 로 승격한다.
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
    @speaker_paths    = {}   # "speakers/<원본meeting_id>.json" → staged Tempfile 경로(바이트열 아님)
    @speaker_skipped  = []   # 상한 초과로 스테이징하지 않은 speakers/ 엔트리명
    @restorers        = []   # 각 MeetingRestorer 참조 — 롤백 시 copied_paths 수집
    @root_folder      = nil  # import 후 루트 Folder 레코드
    @warnings         = []   # 화자 DB 복원 경고 — restorer.warnings 와 합쳐 노출
  end

  # @return [Hash] { folder_id: Integer, meeting_ids: [Integer, ...], warnings: [String, ...] }
  def run!
    manifest     = read_archive
    validate_manifest!(manifest)
    # 아카이브가 만들어질 때 이미 로스터가 빠졌다면(사이드카 문제·상한 초과) import 쪽에서는
    # 손쓸 수 없다. "speakers/ 엔트리 없음"은 구버전 하위호환 신호이기도 해서 표식 없이는
    # 조용히 넘어가므로, exporter 가 남긴 표식을 보고 사용자에게 알린다.
    if Transfer::SpeakerDbTransfer.degraded_manifest?(manifest)
      add_warning(Transfer::SpeakerDbTransfer::EXPORT_DEGRADED_WARNING)
    end

    meeting_map = {}

    begin
      ActiveRecord::Base.transaction do
        tag_map     = build_tag_map(manifest["tags"] || [])
        folder_map  = import_folders(manifest, tag_map)
        meeting_map = import_meetings(manifest, folder_map, tag_map)
      end
    rescue StandardError
      # 트랜잭션 실패 시에만 복사된 storage/ 파일 롤백
      # @restorers 의 copied_paths 를 flatten — 중간에 raise 된 restorer 의 부분 복사본도 포함
      @restorers.flat_map(&:copied_paths).each { |path| FileUtils.rm_f(path) }
      raise
    end

    # ↓ 커밋 확정 후. 여기서 raise 해도 copied_paths 는 절대 삭제 안 됨.
    #
    # ⚠️ 화자 DB 복원은 스테이징 tempfile 을 읽으므로 cleanup_staged_files 보다 **먼저**
    # 와야 한다. (정리를 트랜잭션 ensure 에 두면 여기서 전부 ENOENT 로 실패해 복원이
    # 조용히 경고로만 떨어진다 — 그래서 정리를 run! 의 ensure 로 올렸다.)
    new_meetings = meeting_map.values
    restore_speaker_dbs(meeting_map)
    new_meetings.each do |mtg|
      EmbedBackfillJob.perform_later(meeting_id: mtg.id) if mtg.transcripts.exists?
    end

    # 내부 MeetingRestorer 들의 warnings 를 수집(T7) — public_uid 충돌 시 사용자에게 노출.
    { folder_id: @root_folder.id, meeting_ids: new_meetings.map(&:id),
      warnings: @restorers.flat_map(&:warnings) + @warnings }
  ensure
    # 성공·실패 무관, staged tempfile 은 항상 정리
    cleanup_staged_files
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
          unless entry.file?
            # 파일이 아닌 엔트리(디렉터리 등)도 header.size 를 크게 선언할 수 있고,
            # 소비하지 않으면 TarReader::Entry#close 가 계량 없이 그만큼 압축을 푼다.
            # 정상 디렉터리 엔트리는 size 0 이라 no-op(§H3, MeetingImporter/ProjectImporter 와 동일).
            Transfer::SpeakerDbTransfer.drain_entry(entry, chunk_size: CHUNK_SIZE) do |n|
              Transfer::Archive.account_bytes!(n, counter)
            end
            next
          end

          name = entry.full_name
          Transfer::Archive.guard_entry_name!(name)

          if name == "manifest.json"
            bytes = entry.read.to_s
            Transfer::Archive.account_bytes!(bytes.bytesize, counter)
            manifest = JSON.parse(bytes)
          elsif name.start_with?("speakers/")
            # generic else 보다 **먼저** 걸러야 한다 — @staged_paths 로 들어가면
            # MeetingRestorer 의 file_lookup 에 로스터가 섞인다.
            stage_speaker_entry(name, entry, counter)
          else
            @staged_paths[name] = stage_entry(name, entry, counter)
          end
        end
      end
    end

    manifest
  end

  # speakers/ 엔트리 스테이징. **선언 크기를 먼저** 상한과 대조한다.
  #
  # 곧장 stage_entry 로 보내면 64MB 상한이 import_file 의 File.size 에서, 즉 디스크에 다 쓴
  # **뒤에야** 걸린다. 초과분은 스테이징하지 않고 보류 상태로만 기록하되(판정은
  # restore_speaker_dbs 에서 한 번), 엔트리는 **계량하며 끝까지 드레인**한다 —
  # 읽지 않고 넘기면 TarReader::Entry#close 가 계량 없이 압축을 다 풀어 zip-bomb 가드가
  # 무력해진다(GzipReader 는 :seek 에 응답하지 않아 read 루프로 떨어진다).
  #
  # 로스터는 임베딩 때문에 크고 복원은 커밋 **후**에 도므로, 전체 바이트를 트랜잭션 내내
  # RAM 에 들지 않도록 audio/attachments 와 같은 방식으로 디스크에 스테이징한다.
  def stage_speaker_entry(name, entry, counter)
    declared = entry.respond_to?(:header) && entry.header ? entry.header.size.to_i : nil
    if declared && declared > Transfer::SpeakerDbTransfer::MAX_ROSTER_BYTES
      Rails.logger.warn(
        "FolderImporter: roster entry #{name} declares #{declared} bytes " \
        "(> #{Transfer::SpeakerDbTransfer::MAX_ROSTER_BYTES}) — 스테이징하지 않고 계량 드레인"
      )
      @speaker_skipped << name
      Transfer::SpeakerDbTransfer.drain_entry(entry, chunk_size: CHUNK_SIZE) do |bytes|
        Transfer::Archive.account_bytes!(bytes, counter)
      end
      return
    end

    @speaker_paths[name] = stage_entry(name, entry, counter)
  end

  # 회의별 sidecar SpeakerDB 복원. old_id → new meeting 맵을 순회해 **각자의** speakers/
  # 엔트리를 **각자의** 새 meeting_id 로 PUT 한다.
  #
  # ⚠️ 폴더 스코프는 회의가 여러 개다 — 엔트리 순서나 인덱스로 짝지으면 남의 로스터가
  # 들어간다. 반드시 old_id 로 키를 만들어 조회할 것. 구버전 아카이브(엔트리 없음)는 스킵.
  #
  # Transfer::SpeakerDbTransfer::Importer 인스턴스를 한 import 동안 **공유**한다
  # (export 의 Exporter 와 대칭). 회의마다 새로 만들면 사이드카가 "붙어는 있는데 응답 없음"
  # 일 때 회의당 TIMEOUT(30초)을 전부 소모한다.
  #
  # import_file 은 sidecar 실패도 파일 I/O 실패도 흡수해 false 만 돌려준다. 여기서 raise 가
  # 새어나가면 커밋 **후**인데도 위 rescue 가 복사 파일을 지운다. 실패는 @warnings 로
  # 승격해 사용자에게 보고한다(로그만으로는 사용자가 못 본다).
  def restore_speaker_dbs(meeting_map)
    speaker_importer = Transfer::SpeakerDbTransfer::Importer.new

    meeting_map.each do |old_id, new_meeting|
      name = Transfer::SpeakerDbTransfer.entry_name(old_id)
      # 상한 초과로 스테이징하지 않은 엔트리 — 읽기 시점이 아니라 여기서 한 번 판정한다.
      if @speaker_skipped.include?(name)
        add_warning(Transfer::SpeakerDbTransfer::RESTORE_FAILED_WARNING)
        next
      end

      path = @speaker_paths[name]
      next if path.nil?
      next if speaker_importer.import_file(new_meeting.id, path)

      add_warning(Transfer::SpeakerDbTransfer::RESTORE_FAILED_WARNING)
    end
  end

  # 같은 경고를 회의 수만큼 반복해서 보여주지 않는다.
  def add_warning(message)
    @warnings << message unless @warnings.include?(message)
  end

  # 엔트리를 Tempfile 에 청크 단위로 쓰고 그 경로를 반환한다.
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

    tmp.path
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

    if (manifest["folders"] || []).empty?
      raise Transfer::Archive::InvalidArchiveError,
            "manifest.json folders is empty or missing"
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
  #         각 restorer 를 @restorers 에 누적 — 롤백 시 copied_paths 수집에 사용.
  # 2패스: previous_meeting_id 를 서브트리 내에서만 리맵
  #         (범위 밖이면 nil 유지).
  #
  # @return [Hash] old meeting id → 새 Meeting (삽입 순서 = 매니페스트 순서).
  #   커밋 후 화자 DB 복원이 이 맵의 **키**로 speakers/ 엔트리를 찾으므로 배열이 아니라
  #   맵을 돌려준다 — 순서로 짝지으면 회의 간 로스터가 섞인다.
  def import_meetings(manifest, folder_map, tag_map)
    meetings_data = manifest["meetings"] || []
    meeting_map   = {}
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
      @restorers << restorer  # restore! 전에 등록 — 중간 raise 시에도 부분 복사본 추적
      meeting_map[m["id"]] = restorer.restore!
    end

    # Pass 2: 서브트리 내 previous_meeting_id 리맵 (범위 밖이면 nil 유지)
    meetings_data.each do |m|
      old_prev = m["previous_meeting_id"]
      next if old_prev.nil?

      new_prev = meeting_map[old_prev]
      next unless new_prev

      meeting_map[m["id"]].update_column(:previous_meeting_id, new_prev.id)
    end

    meeting_map
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
