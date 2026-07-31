require "rubygems/package"
require "zlib"

# 프로젝트 1개를 통째로 .tar.gz(stdlib only)로 직렬화한다.
#
# 엔트리:
#   speakers/<원본meeting_id>.json        회의별 sidecar SpeakerDB. 로스터가 비었거나 못 읽으면 없음
#   audio/<원본meeting_id>.<ext>          include_audio=true & 실제 파일 존재 시
#   attachments/<원본첨부 basename>        실제 파일 존재 시 (항상)
#   manifest.json                         (필수) 프로젝트+전 자식 메타데이터(원본 PK 보존)
#
# ⚠️ manifest.json 은 **마지막** 엔트리다. tar 는 append-only 라 이미 쓴 엔트리를
# 되돌아가 고칠 수 없는데, manifest 의 speaker_db_degraded 표식(§R3)은 로스터 수집이
# 끝나야 값이 정해지기 때문. 모든 importer(Project/Meeting/Folder)는 tar 를 끝까지 읽고
# 엔트리 **이름**으로 고르므로 순서에 의존하지 않는다.
#
# 대용량 오디오는 디스크에서 청크로 읽어 메모리 폭발을 막는다.
# import 측이 manifest 의 old_id → new 맵으로 FK 를 리매핑한다.
class ProjectExporter
  FORMAT_VERSION = 1
  CHUNK_SIZE     = 64 * 1024 # 64KB 청크 스트리밍

  # @param project [Project]
  # @param include_audio [Boolean] 오디오 파일 동봉 여부 (끄면 메타데이터만)
  def initialize(project, include_audio: true)
    @project             = project
    @include_audio       = include_audio
    @speaker_db_degraded = false # 로스터를 하나라도 놓쳤는가(§R3 아카이브 수준 표식)
  end

  # tar.gz 스트림을 io 에 작성한다.
  # @param io [IO] write 가능한 IO (예: 응답 스트림, StringIO, File)
  def write_to(io)
    gz  = Zlib::GzipWriter.new(io)
    tar = Gem::Package::TarWriter.new(gz)

    begin
      # 순서 고정: 로스터 → 오디오/첨부 → manifest.
      # manifest 가 마지막인 이유는 클래스 주석 참고(열화 표식은 로스터 수집 후에 확정).
      add_speaker_db_files(tar)
      add_audio_files(tar) if @include_audio
      add_attachment_files(tar)
      add_manifest(tar)
    ensure
      close_tar_then_gz(tar, gz, pending_error: $!)
    end
  end

  # 매니페스트 Hash. 파일 바이너리는 포함하지 않는다(파일은 tar 엔트리).
  #
  # speaker_db_degraded: 이 아카이브를 만들 때 화자 로스터를 하나라도 놓쳤는가.
  # import 가 이 표식을 보고 사용자 경고를 올린다 — 표식이 없으면 사이드카 문제로
  # 로스터가 통째로 빠진 아카이브가 정상처럼 보이고 import 도 조용히 넘어간다(§R3).
  # write_to 를 거치지 않고 #manifest 만 호출하면 로스터 수집 자체가 없으므로 false.
  # @return [Hash]
  def manifest
    {
      format_version: FORMAT_VERSION,
      exported_at:    Time.current.iso8601,
      app_version:    app_version,
      include_audio:  @include_audio,
      # 키 문자열은 Transfer::SpeakerDbTransfer::DEGRADED_MANIFEST_KEY 와 같아야 한다
      # (importer 가 그 상수로 읽는다). 스펙이 둘의 일치를 검증한다.
      speaker_db_degraded: @speaker_db_degraded,
      project:        @project.attributes,
      folders:        folders.map { |f| serialize_folder(f) },
      tags:           tags.map(&:attributes),
      meetings:       meetings.map { |m| serialize_meeting(m) }
    }
  end

  private

  def folders
    @folders ||= @project.folders.to_a
  end

  # 폴더 1건 + 폴더 소유 자식(glossary_entries · taggings)을 직렬화. 원본 PK 보존.
  # Folder 는 GlossaryEntry 의 polymorphic owner 이자 Tagging 의 taggable.
  def serialize_folder(folder)
    folder.attributes.merge(
      glossary_entries: folder.glossary_entries.map(&:attributes),
      tag_ids:          folder.taggings.map(&:tag_id)
    )
  end

  # Project 에는 tags 연관이 없으므로 project_id 로 직접 조회(tag.project_id 보유).
  def tags
    @tags ||= Tag.where(project_id: @project.id).to_a
  end

  def meetings
    @meetings ||= @project.meetings.to_a
  end

  # 회의 1건 + 모든 자식 컬렉션을 중첩 직렬화. 원본 PK 보존.
  def serialize_meeting(meeting)
    meeting.attributes.merge(
      transcripts:      meeting.transcripts.map(&:attributes),
      summaries:        meeting.summaries.map(&:attributes),
      action_items:     meeting.action_items.map(&:attributes),
      decisions:        meeting.decisions.map(&:attributes),
      blocks:           meeting.blocks.map(&:attributes),
      attachments:      meeting.meeting_attachments.map { |a| serialize_attachment(a) },
      contacts:         meeting.meeting_contacts.map(&:attributes),
      bookmarks:        meeting.meeting_bookmarks.map(&:attributes),
      chat_messages:    meeting.chat_messages.map(&:attributes),
      tag_ids:          meeting.taggings.map(&:tag_id),
      glossary_entries: meeting.glossary_entries.map(&:attributes)
    )
  end

  # 첨부 메타: file_path 는 원본 basename 으로 치환(import 가 tar 의 attachments/<basename> 를 찾는다).
  def serialize_attachment(attachment)
    attrs = attachment.attributes
    if attachment.file_path.present?
      attrs["file_path"] = File.basename(attachment.file_path)
    end
    attrs
  end

  def add_manifest(tar)
    json = JSON.pretty_generate(manifest)
    bytes = json.b
    tar.add_file_simple("manifest.json", 0o644, bytes.bytesize) do |entry|
      entry.write(bytes)
    end
  end

  # 오디오: 실제 파일이 존재하면 audio/<meeting_id><ext> 로 추가. 없으면 스킵.
  def add_audio_files(tar)
    meetings.each do |meeting|
      path = meeting.audio_file_path
      next if path.blank? || !File.file?(path)

      ext   = File.extname(path)
      ext   = ".mp3" if ext.blank?
      entry = "audio/#{meeting.id}#{ext}"
      add_file_streamed(tar, entry, path)
    end
  end

  # 첨부: 실제 파일이 존재하면 attachments/<basename> 로 추가. 없으면 스킵.
  def add_attachment_files(tar)
    meetings.each do |meeting|
      meeting.meeting_attachments.each do |attachment|
        path = attachment.file_path
        next if path.blank? || !File.file?(path)

        entry = "attachments/#{File.basename(path)}"
        add_file_streamed(tar, entry, path)
      end
    end
  end

  # 회의별 sidecar SpeakerDB(화자 임베딩·이름·next_num) 를 speakers/<meeting_id>.json 으로 번들.
  # sidecar 다운/에러 시 해당 회의만 스킵(export 전체를 실패시키지 않음,
  # Transfer::SpeakerDbTransfer 가 흡수) — 단 **조용히**는 아니다. 하나라도 놓치면
  # @speaker_db_degraded 로 기록해 manifest 표식 → import 경고까지 이어진다(§R3).
  #
  # Exporter 인스턴스를 한 export 동안 공유해 (1) sidecar 연결 불가를 만나면 이후 회의는
  # 아예 호출하지 않고(circuit-break — 회의 100개 × TIMEOUT 30초 = 50분 방지),
  # (2) 로스터가 빈 회의는 tar 엔트리를 만들지 않는다(import 쪽 하위호환 경로가 처리).
  def add_speaker_db_files(tar)
    speaker_exporter = Transfer::SpeakerDbTransfer::Exporter.new

    meetings.each do |meeting|
      bytes = speaker_exporter.bytes_for(meeting.id)
      next if bytes.nil?

      entry_name = Transfer::SpeakerDbTransfer.entry_name(meeting.id)
      tar.add_file_simple(entry_name, 0o644, bytes.bytesize) { |entry| entry.write(bytes) }
    end

    @speaker_db_degraded = speaker_exporter.any_roster_dropped?
  end

  # tar 끝 마커(1024 zero bytes)와 gzip 트레일러(CRC+ISIZE)를 **둘 다** 남긴다.
  #
  # 두 컨트롤러(Project/MeetingTransfersController)는 write_to 로 Tempfile 을 다 채운 뒤
  # send_file 하므로, write_to 실행 중에 와이어로 나가는 바이트는 없다 — write_to 가
  # raise 하면 send_file 자체가 실행되지 않아 잘린 아카이브가 전송되지 않는다.
  # 그럼에도 닫아 두는 이유는 write_to 의 계약이 "io 에 완결된 tar.gz 를 남긴다"이기
  # 때문이다(StringIO·File 을 직접 넘기는 호출자, 진단용 부분 아카이브).
  #
  # ⚠️ tar.close 가 raise 하면 같은 ensure 안의 gz.finish 가 건너뛰어져 gzip 트레일러
  # 없는 스트림이 남는다(GzipReader 가 "unexpected end of file"). 그래서 close 실패를
  # 일단 잡아 gz.finish 를 보장한 뒤 다시 올린다. 다만 이미 진행 중인 예외가 있으면
  # 그쪽이 원인이므로 덮어쓰지 않는다.
  # (삼키고 끝내면 안 된다 — write_to 가 정상 반환하면 컨트롤러가 잘린 아카이브를 그대로 200 으로 보낸다.)
  def close_tar_then_gz(tar, gz, pending_error: nil)
    close_error = nil
    begin
      # TarWriter#close 는 idempotent 하지 않다(check_closed → IOError) → closed? 가드.
      tar.close if tar && !tar.closed?
    rescue StandardError => e
      close_error = e
      Rails.logger.warn("ProjectExporter: tar close failed: #{e.class}: #{e.message}")
    end

    # TarWriter#close 가 gz 를 닫지 않으므로 직접 finish. (io 는 호출자 소유)
    gz.finish if gz

    raise close_error if close_error && pending_error.nil?
  end

  # 디스크 파일을 청크 스트리밍으로 tar 엔트리에 쓴다(메모리 폭발 방지).
  def add_file_streamed(tar, entry_name, path)
    size = File.size(path)
    tar.add_file_simple(entry_name, 0o644, size) do |entry|
      File.open(path, "rb") do |file|
        while (chunk = file.read(CHUNK_SIZE))
          entry.write(chunk)
        end
      end
    end
  end

  def app_version
    @app_version ||= begin
      file = Rails.root.join("..", "VERSION")
      File.exist?(file) ? File.read(file).strip : nil
    rescue StandardError
      nil
    end
  end
end
