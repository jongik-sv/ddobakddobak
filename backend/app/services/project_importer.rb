require "rubygems/package"
require "zlib"
require "json"
require "fileutils"
require "tempfile"

# ProjectExporter 가 만든 .tar.gz 를 읽어 **새 Project** 로 복원한다(stdlib only).
#
# 입력: tar.gz IO 또는 파일 경로, import 실행자(User)
# 출력: 새로 만든 Project 레코드
#
# 복원 규칙(설계문서 §Import 흐름):
#   - 새 Project: name = "원본명 (가져옴 YYYY-MM-DD)", creator = 실행자
#   - ProjectMembership(실행자, role: admin) 1건
#   - old_id → new 맵으로 FK 리맵 (folders 2-pass · tags dedupe · meetings · 자식)
#   - 소유권은 전부 실행자로 재지정(회의 created_by · 챗/북마크 user · 첨부 uploaded_by)
#   - previous_meeting_id 는 범위 안만 리맵(밖이면 nil)
#   - 오디오/첨부 파일은 tar 에서 꺼내 storage/ 로 복사 후 절대경로로 file_path 재작성
#   - 전체를 단일 DB 트랜잭션으로 감싸고, 실패 시 복사한 파일을 정리한다.
#
# 보안: tar 엔트리명에 ".." 또는 절대경로가 있으면 UnsafeEntryError.
class ProjectImporter
  # path-traversal(zip-slip) 등 안전하지 않은 tar 엔트리 거부 시 발생.
  class UnsafeEntryError < StandardError; end
  # 매니페스트 누락·포맷 불일치 시 발생.
  class InvalidArchiveError < StandardError; end

  SUPPORTED_FORMAT_VERSION = 1
  CHUNK_SIZE = 64 * 1024

  # 복원 경고 메시지 배열(예: public_uid 충돌로 D'Flow 연결 해제됨, T7). run! 이후 조회.
  attr_reader :warnings
  # 압축해제 누적 바이트 상한(zip-bomb 가드). 컨트롤러 업로드 상한과 동일 수준(3GB).
  MAX_DECOMPRESSED_BYTES = 3 * 1024 * 1024 * 1024
  # 전사는 회의당 수만 건까지 갈 수 있어 건당 insert 는 SQLite 변수 상한
  # (32766)을 넘길 수 없다. 11컬럼 기준 한 배치가 상한을 넘지 않도록 보수적으로 둔다.
  TRANSCRIPT_INSERT_BATCH_SIZE = 1000

  # @param io_or_path [IO, String] tar.gz 스트림 또는 파일 경로
  # @param user [User] import 실행자(=새 콘텐츠 소유자)
  def initialize(io_or_path, user)
    @io_or_path     = io_or_path
    @user           = user
    @copied_files   = [] # 롤백 시 정리할 storage/ 복사 파일
    @staged_files   = [] # 추출 단계 Tempfile **객체**(GC unlink 방지로 참조 유지 + 종료 시 정리)
    @audio_paths    = {} # "audio/<old_id>.<ext>" => staged temp 경로
    @attach_paths   = {} # "<basename>"          => staged temp 경로
    @decompressed_bytes = 0
    @warnings       = [] # 복원 경고(예: public_uid 충돌, T7)
  end

  # tar.gz 를 읽어 새 Project 로 복원하고 그 Project 를 반환한다.
  # 실패 시 DB 트랜잭션 롤백 + 복사한 파일 제거.
  # @return [Project]
  def run!
    manifest = read_archive
    validate_manifest!(manifest)

    project = nil
    meeting_map = {}
    ActiveRecord::Base.transaction do
      project = build_project(manifest)
      create_membership(project)

      tag_map    = import_tags(project, manifest["tags"] || [])
      folder_map = import_folders(project, manifest["folders"] || [], tag_map)
      meeting_map = import_meetings(project, manifest["meetings"] || [], folder_map, tag_map)
    end

    # 트랜잭션 커밋 후 임베딩 reconcile — 인-트랜잭션 enqueue(롤백 시 유령 잡) 회피.
    # 임포트 전사는 인라인 임베딩이 없으므로(라이브 끊김 방지 정책) 회의별로 배치 흡수.
    meeting_map.each_value do |mtg|
      mtg.reconcile_embeddings! if mtg.transcripts.exists?
    end

    project
  rescue StandardError
    cleanup_copied_files
    raise
  ensure
    cleanup_staged_files
  end

  private

  # ── 아카이브 읽기 ──

  # tar.gz 를 1패스로 순회하며 manifest.json 만 파싱하고, audio/·attachments/ 엔트리는
  # 메모리에 버퍼하지 않고 각각 디스크 Tempfile 로 청크 스트리밍 추출한다(메모리 폭발 방지).
  # 엔트리명 안전성 검사 + 압축해제 누적 바이트 상한(zip-bomb 가드).
  def read_archive
    manifest = nil
    open_gz do |gz|
      Gem::Package::TarReader.new(gz) do |tar|
        tar.each do |entry|
          next unless entry.file?
          name = entry.full_name
          guard_entry_name!(name)

          if name == "manifest.json"
            manifest = JSON.parse(read_capped(entry))
          elsif name.start_with?("audio/")
            @audio_paths[name] = stage_entry(entry)
          elsif name.start_with?("attachments/")
            @attach_paths[File.basename(name)] = stage_entry(entry)
          end
        end
      end
    end
    manifest
  end

  # manifest.json 은 작아야 한다 → 메모리에 읽되 누적 상한도 함께 적용.
  def read_capped(entry)
    bytes = entry.read.to_s
    account_bytes!(bytes.bytesize)
    bytes
  end

  # tar 엔트리를 디스크 Tempfile 로 청크 스트리밍 추출하고 그 경로를 반환한다.
  # 추출 바이트는 누적 상한에 합산.
  # 중요: Tempfile **객체**를 @staged_files 에 보관해 import 수명 동안 참조를 유지한다.
  # 경로 문자열만 들면 객체가 미참조가 되어 GC finalizer 가 파일을 unlink → 이후
  # copy_staged 가 ENOENT 로 실패한다(실앱 500). 종료 시 cleanup_staged_files 가 정리.
  def stage_entry(entry)
    tmp = Tempfile.new([ "ddobak-import", File.extname(entry.full_name) ])
    tmp.binmode
    @staged_files << tmp
    begin
      while (chunk = entry.read(CHUNK_SIZE))
        account_bytes!(chunk.bytesize)
        tmp.write(chunk)
      end
    ensure
      tmp.close # flush + fd 반납. 파일은 남김(close! 가 아님) → copy 가 읽을 수 있음.
    end
    tmp.path
  end

  def account_bytes!(n)
    @decompressed_bytes += n
    return unless @decompressed_bytes > MAX_DECOMPRESSED_BYTES

    raise InvalidArchiveError,
          "압축 해제 크기가 상한(#{MAX_DECOMPRESSED_BYTES} bytes)을 초과했습니다"
  end

  def open_gz
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

  # zip-slip 가드: 절대경로·".." 세그먼트·역슬래시 우회를 모두 거부한다.
  def guard_entry_name!(name)
    normalized = name.to_s.tr("\\", "/")
    if normalized.start_with?("/") ||
       normalized.split("/").include?("..") ||
       normalized.match?(/\A[A-Za-z]:/) # 윈도우 드라이브 절대경로
      raise UnsafeEntryError, "unsafe tar entry name: #{name.inspect}"
    end
  end

  def validate_manifest!(manifest)
    raise InvalidArchiveError, "manifest.json missing" if manifest.nil?
    version = manifest["format_version"]
    unless version == SUPPORTED_FORMAT_VERSION
      raise InvalidArchiveError, "unsupported format_version: #{version.inspect}"
    end
  end

  # ── Project / Membership ──

  def build_project(manifest)
    attrs = sanitize(manifest["project"], Project)
    attrs["name"] = imported_name(attrs["name"])
    Project.create!(attrs.merge("created_by_id" => @user.id))
  end

  def imported_name(original)
    base = original.presence || "프로젝트"
    "#{base} (가져옴 #{Date.current.strftime('%Y-%m-%d')})"
  end

  def create_membership(project)
    ProjectMembership.create!(project: project, user: @user, role: "admin")
  end

  # ── folders (2-pass) ──

  # 1패스: parent 없이 전부 생성하며 old_id → new folder 맵 작성.
  # 2패스: parent_id 를 새 맵으로 리맵해 계층 연결.
  # 폴더 소유 glossary_entries(polymorphic owner) · taggings(taggable)도 함께 복원.
  def import_folders(project, folders, tag_map)
    map = {}
    folders.each do |f|
      attrs = sanitize(f, Folder)
      old_id = f["id"]
      new_folder = Folder.create!(attrs.merge(
        "project_id" => project.id,
        "parent_id"  => nil
      ))
      map[old_id] = new_folder
      import_folder_glossary(new_folder, f["glossary_entries"] || [])
      import_folder_taggings(new_folder, f["tag_ids"] || [], tag_map)
    end

    folders.each do |f|
      old_parent = f["parent_id"]
      next if old_parent.nil?
      child = map[f["id"]]
      parent = map[old_parent]
      child.update_column(:parent_id, parent.id) if child && parent
    end

    map
  end

  # 폴더 소유 오타사전 재생성(owner = 새 folder, created_by 는 범위 밖 유저 참조 제거).
  def import_folder_glossary(folder, entries)
    entries.each do |g|
      attrs = sanitize(g, GlossaryEntry)
      attrs["owner_type"]    = "Folder"
      attrs["owner_id"]      = folder.id
      attrs["created_by_id"] = nil
      GlossaryEntry.create!(attrs)
    end
  end

  # 폴더 태그 재생성(taggable = 새 folder, tag = 리맵).
  def import_folder_taggings(folder, tag_ids, tag_map)
    tag_ids.each do |old_tag_id|
      tag = tag_map[old_tag_id]
      next unless tag
      Tagging.find_or_create_by!(tag: tag, taggable: folder)
    end
  end

  # ── tags (dedupe by name) ──

  # Tag.name 은 전역 unique → find_or_create_by(name:) 로 dedupe.
  # 새로 만들 때만 매니페스트 color·새 project_id 채움. old_tag_id → Tag 맵 반환.
  def import_tags(project, tags)
    map = {}
    tags.each do |t|
      old_id = t["id"]
      tag = Tag.find_or_create_by!(name: t["name"]) do |new_tag|
        new_tag.color = t["color"].presence || "#6b7280"
        new_tag.project_id = project.id
      end
      map[old_id] = tag
    end
    map
  end

  # ── meetings + 자식 ──

  def import_meetings(project, meetings, folder_map, tag_map)
    meeting_map = {}

    # 1패스: 회의 본체 생성(previous_meeting_id 는 일단 nil — 범위 내 리맵은 2패스).
    meetings.each do |m|
      attrs = sanitize(m, Meeting)
      old_id = m["id"]

      attrs["project_id"]    = project.id
      attrs["created_by_id"] = @user.id
      attrs["folder_id"]     = remap_id(folder_map, m["folder_id"])
      attrs["previous_meeting_id"] = nil
      attrs["audio_file_path"]     = nil
      # public_uid unique 충돌 가드(T7) — MeetingRestorer 와 공유(Transfer::Archive).
      if Transfer::Archive.guard_public_uid_conflict!(attrs)
        @warnings << Transfer::Archive::PUBLIC_UID_CONFLICT_WARNING
      end

      new_meeting = Meeting.new(attrs)
      new_meeting.important_explicitly_set = true # 폴더값 상속 콜백이 매니페스트값을 덮지 않게
      new_meeting.save!
      meeting_map[old_id] = new_meeting

      copy_audio(new_meeting, m) if @audio_paths.any? || m["audio_file_path"].present?
      import_meeting_children(new_meeting, m, tag_map)
    end

    # 2패스: previous_meeting_id 를 범위 내에서만 리맵(밖이면 nil 유지).
    meetings.each do |m|
      old_prev = m["previous_meeting_id"]
      next if old_prev.nil?
      new_prev = meeting_map[old_prev]
      next unless new_prev
      meeting_map[m["id"]].update_column(:previous_meeting_id, new_prev.id)
    end

    meeting_map
  end

  def import_meeting_children(meeting, m, tag_map)
    import_transcripts(meeting, m)
    (m["summaries"] || []).each do |s|
      meeting.summaries.create!(sanitize(s, Summary).merge("meeting_id" => meeting.id))
    end
    (m["action_items"] || []).each do |a|
      attrs = sanitize(a, ActionItem)
      attrs["assignee_id"] = nil # 범위 밖 유저 참조 제거
      meeting.action_items.create!(attrs.merge("meeting_id" => meeting.id))
    end
    (m["decisions"] || []).each do |d|
      meeting.decisions.create!(sanitize(d, Decision).merge("meeting_id" => meeting.id))
    end
    import_blocks(meeting, m["blocks"] || [])
    (m["contacts"] || []).each do |c|
      attrs = sanitize(c, MeetingContact)
      attrs["created_by_id"] = @user.id
      attrs["source_attachment_id"] = nil # 첨부 리맵 복잡도 회피(메타 보존이 목적 아님)
      meeting.meeting_contacts.create!(attrs.merge("meeting_id" => meeting.id))
    end
    (m["bookmarks"] || []).each do |b|
      meeting.meeting_bookmarks.create!(sanitize(b, MeetingBookmark).merge("meeting_id" => meeting.id))
    end
    (m["chat_messages"] || []).each do |cm|
      attrs = sanitize(cm, ChatMessage)
      attrs["user_id"] = @user.id
      meeting.chat_messages.create!(attrs.merge("meeting_id" => meeting.id))
    end
    (m["glossary_entries"] || []).each do |g|
      attrs = sanitize(g, GlossaryEntry)
      attrs["owner_type"]    = "Meeting"
      attrs["owner_id"]      = meeting.id
      attrs["created_by_id"] = nil # 범위 밖 유저 참조 제거
      GlossaryEntry.create!(attrs)
    end
    import_attachments(meeting, m["attachments"] || [])
    import_taggings(meeting, m["tag_ids"] || [], tag_map)
  end

  # 전사 복원: 건당 create! (35k건 ≈ 73k쿼리·117s) → 배치 insert_all 로 전환.
  # Transfer::MeetingRestorer#restore_transcripts 와 동일한 접근(주석 참고).
  # insert_all 주의점:
  #   - 검증·콜백·타임스탬프를 건너뛴다. created_at 을 직접 세팅한다
  #     (transcripts 에는 updated_at 컬럼이 없다 → column_names 로 방어).
  #   - 단일 insert_all 은 SQLite 변수 상한을 넘길 수 있어 배치로 분할한다.
  #   - after_save :fts_upsert 콜백이 건너뛰어지므로 FTS 색인을 벌크로 재구축한다.
  #   - meeting_id 는 새 회의 id 로, id 는 sanitize 가 제거해 DB 가 채운다(create! 와 동일).
  def import_transcripts(meeting, m)
    now     = Time.current
    ts_cols = Transcript.column_names
    rows = (m["transcripts"] || []).map do |t|
      row = sanitize(t, Transcript)
      row["meeting_id"]   = meeting.id
      row["created_at"] ||= now if ts_cols.include?("created_at")
      row["updated_at"] ||= now if ts_cols.include?("updated_at")
      row
    end
    return if rows.empty?

    rows.each_slice(TRANSCRIPT_INSERT_BATCH_SIZE) do |batch|
      Transcript.insert_all(batch)
    end

    reindex_transcripts_fts(meeting)
  end

  # insert_all 은 after_save :fts_upsert 콜백을 건너뛰므로 전사 FTS 색인을 벌크로 재구축.
  # 새로 삽입된 id 라 기존 FTS 행이 없으므로 DELETE 없이 INSERT…SELECT 한 번.
  # fts_upsert 와 동일하게, 색인 실패가 데이터 복원 자체를 중단시키지 않도록 경고만 남긴다.
  def reindex_transcripts_fts(meeting)
    conn = ActiveRecord::Base.connection
    conn.execute(ActiveRecord::Base.sanitize_sql_array([
      "INSERT INTO transcripts_fts(content, speaker_label, speaker_name, source_id) " \
      "SELECT content, speaker_label, speaker_name, id FROM transcripts WHERE meeting_id = ?",
      meeting.id
    ]))
  rescue => e
    Rails.logger.warn("ProjectImporter: transcripts_fts reindex failed for meeting##{meeting.id}: #{e.message}")
  end

  # blocks: parent_block_id 자기참조 → 2-pass 로 계층 보존.
  def import_blocks(meeting, blocks)
    map = {}
    blocks.each do |b|
      attrs = sanitize(b, Block)
      new_block = meeting.blocks.create!(attrs.merge(
        "meeting_id" => meeting.id,
        "parent_block_id" => nil
      ))
      map[b["id"]] = new_block
    end
    blocks.each do |b|
      old_parent = b["parent_block_id"]
      next if old_parent.nil?
      child = map[b["id"]]
      parent = map[old_parent]
      child.update_column(:parent_block_id, parent.id) if child && parent
    end
  end

  def import_taggings(meeting, tag_ids, tag_map)
    tag_ids.each do |old_tag_id|
      tag = tag_map[old_tag_id]
      next unless tag
      Tagging.find_or_create_by!(tag: tag, taggable: meeting)
    end
  end

  def import_attachments(meeting, attachments)
    attachments.each do |a|
      attrs = sanitize(a, MeetingAttachment)
      attrs["uploaded_by_id"] = @user.id
      attrs["file_path"] = resolve_attachment_path(meeting, a)
      meeting.meeting_attachments.create!(attrs.merge("meeting_id" => meeting.id))
    end
  end

  # 첨부 file_path 결정:
  #   - kind=="link"  : 파일 바이트가 없는 게 정상 → 원본 file_path(없으면 nil) 보존.
  #   - kind=="file"  : staged 파일을 storage/ 로 복사한 절대경로. staged 가 없으면
  #                     조용한 손상 대신 InvalidArchiveError 로 트랜잭션 롤백.
  def resolve_attachment_path(meeting, attr_hash)
    basename = attr_hash["file_path"] # exporter 가 basename 으로 치환해 둠
    if attr_hash["kind"] == "link"
      return basename
    end

    staged = basename.present? ? @attach_paths[File.basename(basename)] : nil
    if staged.nil?
      raise InvalidArchiveError,
            "첨부 파일 바이트가 아카이브에 없습니다: #{basename.inspect}"
    end

    copy_attachment(meeting, basename, staged)
  end

  # ── 파일 복사 ──

  # 오디오: staged 파일을 storage/audio/<새id><ext> 로 복사.
  # staged 가 없으면(파일 미동봉·include_audio=false) audio_file_path=nil 유지.
  def copy_audio(meeting, m)
    old_id = m["id"]
    entry_name = @audio_paths.keys.find { |k| k.start_with?("audio/#{old_id}.") }
    return unless entry_name

    ext = File.extname(entry_name)
    ext = ".mp3" if ext.blank?
    FileUtils.mkdir_p(audio_dir)
    dest = File.join(audio_dir, "#{meeting.id}#{ext}")
    copy_staged(@audio_paths[entry_name], dest)
    meeting.update_column(:audio_file_path, dest)
  end

  # 첨부: staged 파일을 storage/attachments/<새meetingid>_<hash>_<basename> 로 복사하고
  # 절대경로를 반환한다.
  def copy_attachment(meeting, basename, staged_path)
    sanitized = File.basename(basename).gsub(/[^\w.\-]/, "_").slice(0, 200)
    FileUtils.mkdir_p(attachments_dir)
    filename = "#{meeting.id}_#{SecureRandom.hex(8)}_#{sanitized}"
    dest = File.join(attachments_dir, filename)
    copy_staged(staged_path, dest)
    dest
  end

  # staged Tempfile 을 최종 storage/ 경로로 디스크 복사(스트리밍, RAM 버퍼 없음).
  def copy_staged(src, dest)
    FileUtils.cp(src, dest)
    @copied_files << dest
  end

  def cleanup_copied_files
    @copied_files.each { |path| FileUtils.rm_f(path) }
    @copied_files.clear
  end

  # 추출 단계 Tempfile 은 import 성공/실패와 무관하게 항상 제거.
  # @staged_files 에는 Tempfile 객체만 담는다 → close!(파일 unlink + fd 정리)로 정리.
  def cleanup_staged_files
    @staged_files.each do |tmp|
      tmp.close! if tmp.respond_to?(:close!)
    rescue StandardError
      nil
    end
    @staged_files.clear
  end

  def audio_dir
    @audio_dir ||= ENV.fetch("AUDIO_DIR") { Rails.root.join("storage", "audio").to_s }
  end

  def attachments_dir
    @attachments_dir ||= ENV.fetch("ATTACHMENTS_DIR") { Rails.root.join("storage", "attachments").to_s }
  end

  # ── 유틸 ──

  # 매니페스트 해시에서 모델의 실제 컬럼만 남긴다(원본 PK·미존재 키 제거 → mass-assign 안전).
  # 중첩 컬렉션 키(transcripts 등)와 id/created_at/updated_at 도 함께 제거.
  def sanitize(attrs, model)
    cols = model.column_names - %w[id created_at updated_at]
    (attrs || {}).slice(*cols)
  end

  def remap_id(map, old_id)
    return nil if old_id.nil?
    mapped = map[old_id]
    mapped&.id
  end
end
