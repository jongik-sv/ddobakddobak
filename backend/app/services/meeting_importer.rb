require "rubygems/package"
require "zlib"
require "json"
require "fileutils"
require "tempfile"

# .ddobak-meeting.tgz 를 현재 프로젝트의 회의로 가져온다.
#
# 사용법:
#   result = MeetingImporter.new(io_or_path, user: current_user, project: project, folder: nil).run!
#   result[:meeting_id]   # 새 Meeting ID
#   result[:warnings]     # 복원 경고 메시지 배열(예: public_uid 충돌로 D'Flow 연결 해제됨). 보통 빈 배열.
#
# 예외:
#   Transfer::Archive::InvalidArchiveError  — 손상 파일, scope != "meeting", 미지원 버전, zip-bomb
#   Transfer::Archive::UnsafeEntryError     — zip-slip 공격 경로 감지
class MeetingImporter
  CHUNK_SIZE               = 64 * 1024
  SUPPORTED_FORMAT_VERSION = 1

  # @param io_or_path [IO, String]  tar.gz 스트림 또는 파일 경로
  # @param user [User]              새 컨텐츠 소유자
  # @param project [Project]        대상 프로젝트
  # @param folder [Folder, nil]     대상 폴더 (nil=루트)
  def initialize(io_or_path, user:, project:, folder: nil)
    @io_or_path   = io_or_path
    @user         = user
    @project      = project
    @folder       = folder
    @staged_paths = {}   # tar entry name → staged Tempfile path
    @staged_files = []   # Tempfile 객체 보관(GC 방지)
    @speaker_db_bytes   = nil   # speakers/<meeting_id>.json 엔트리 바이트(있으면)
    @speaker_db_skipped = false # 마지막 speakers/ 엔트리를 상한 초과로 버렸는가(보류 상태)
    @warnings     = []   # restorer.warnings 와 합쳐 result[:warnings] 로 사용자에게 보고
  end

  # @return [Hash] { meeting_id: Integer, warnings: Array<String> }
  def run!
    manifest     = read_archive
    validate_manifest!(manifest)
    # 아카이브가 만들어질 때 이미 로스터가 빠졌다면(사이드카 문제·상한 초과) import 쪽에서는
    # 손쓸 수 없다. "speakers/ 엔트리 없음"은 구버전 하위호환 신호이기도 해서 표식 없이는
    # 조용히 넘어가므로, exporter 가 남긴 표식을 보고 사용자에게 알린다.
    if Transfer::SpeakerDbTransfer.degraded_manifest?(manifest)
      add_warning(Transfer::SpeakerDbTransfer::EXPORT_DEGRADED_WARNING)
    end
    meeting_hash = manifest["meeting"]
    tags_data    = manifest["tags"] || []

    new_meeting = nil
    restorer    = nil

    begin
      ActiveRecord::Base.transaction do
        tag_map = build_tag_map(tags_data)
        restorer = Transfer::MeetingRestorer.new(
          meeting_hash,
          user:                 @user,
          project:              @project,
          file_lookup:          @staged_paths,
          folder_id:            @folder&.id,
          previous_meeting_id:  nil,
          tag_resolver:         ->(old_tag_id) { tag_map[old_tag_id] }
        )
        new_meeting = restorer.restore!
      end
    rescue StandardError
      # 트랜잭션 실패 시에만 복사된 storage/ 파일 롤백
      restorer&.copied_paths&.each { |path| FileUtils.rm_f(path) }
      raise
    ensure
      # 트랜잭션 성공·실패 무관, staged tempfile 은 항상 정리
      cleanup_staged_files
    end

    # ↓ 커밋 확정 후. 여기서 raise 해도 copied_paths 는 절대 삭제 안 됨
    restore_speaker_db(new_meeting.id)
    EmbedBackfillJob.perform_later(meeting_id: new_meeting.id) if new_meeting.transcripts.exists?

    { meeting_id: new_meeting.id, warnings: restorer.warnings + @warnings }
  end

  private

  # ── tar.gz 읽기 ──

  # 아카이브를 스트리밍으로 읽어 manifest.json 을 파싱하고 나머지 엔트리는 Tempfile 에 스테이징.
  # @return [Hash, nil] 파싱된 manifest (없으면 nil)
  def read_archive
    manifest = nil
    counter  = [0]  # zip-bomb 바이트 카운터 (배열 참조)

    open_gz do |gz|
      Gem::Package::TarReader.new(gz) do |tar|
        tar.each do |entry|
          unless entry.file?
            # 파일이 아닌 엔트리(디렉터리 등)도 header.size 를 크게 선언할 수 있고,
            # 소비하지 않으면 TarReader::Entry#close 가 계량 없이 그만큼 압축을 푼다.
            # 정상 디렉터리 엔트리는 size 0 이라 no-op.
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
            # 로스터는 임베딩 때문에 크다 → manifest 처럼 통째로 읽지 않고
            # 선언 크기 대조 + 청크 읽기(청크마다 zip-bomb 카운터 합산).
            # 상한 초과분은 nil → 로스터만 버린다.
            #
            # ⚠️ 여기서 바로 경고를 붙이면 안 된다(R8). speakers/ 엔트리가 여러 개인
            # 아카이브에서 마지막 것이 앞의 것을 덮으므로, 과대 엔트리 뒤에 정상 엔트리가
            # 오면 로스터는 복원되는데 경고만 남아 사용자를 오도한다.
            # 스킵은 **보류 상태**로만 기록하고 판정은 restore_speaker_db 에서 한 번 한다.
            @speaker_db_bytes   = Transfer::SpeakerDbTransfer.read_entry_capped(entry) do |n|
              Transfer::Archive.account_bytes!(n, counter)
            end
            @speaker_db_skipped = @speaker_db_bytes.nil?
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
    tmp = Tempfile.new(["ddobak-meeting-import", File.extname(name)])
    tmp.binmode
    @staged_files << tmp  # GC 방지

    begin
      while (chunk = entry.read(CHUNK_SIZE))
        Transfer::Archive.account_bytes!(chunk.bytesize, counter)
        tmp.write(chunk)
      end
    ensure
      tmp.close
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
    unless scope == "meeting"
      raise Transfer::Archive::InvalidArchiveError,
            "expected scope=meeting, got #{scope.inspect}"
    end
  end

  # ── 태그 맵 ──

  # 태그 이름 기준으로 dedup (이름은 전역 유니크). 없으면 대상 프로젝트에 생성.
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

  # ── 화자 DB(SpeakerDB) 복원 ──

  # 아카이브에 speakers/ 엔트리가 있으면 새 meeting_id 로 sidecar 에 PUT 한다.
  # 구버전 아카이브(엔트리 없음)는 스킵 — 하위호환. 실패해도 raise 하지 않는다
  # (Transfer::SpeakerDbTransfer 가 흡수, import 나머지 결과에 영향 없음).
  # 다만 "나머지는 가져오되 **보고**" — 실패는 result[:warnings] 로 사용자에게 노출한다.
  #
  # 판정은 여기서 **한 번만** 한다(R8) — 읽기 시점에 붙이면 여러 speakers/ 엔트리 중
  # 앞의 과대 엔트리 경고가 뒤의 정상 복원과 함께 남는다. 최종 상태 기준:
  #   bytes 있음        → PUT 시도, 실패 시 경고
  #   bytes 없고 스킵함 → 경고(상한 초과로 버림)
  #   bytes 없고 스킵 X → 엔트리 자체가 없음(구버전 아카이브) → 조용히 통과
  def restore_speaker_db(new_meeting_id)
    if @speaker_db_bytes.nil?
      add_warning(Transfer::SpeakerDbTransfer::RESTORE_FAILED_WARNING) if @speaker_db_skipped
      return
    end

    return if Transfer::SpeakerDbTransfer.import_bytes(new_meeting_id, @speaker_db_bytes)

    add_warning(Transfer::SpeakerDbTransfer::RESTORE_FAILED_WARNING)
  end

  # 같은 경고를 중복해서 보여주지 않는다.
  def add_warning(message)
    @warnings << message unless @warnings.include?(message)
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
