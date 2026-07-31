require "rubygems/package"
require "zlib"

# 회의 1건을 .ddobak-meeting.tgz (tar.gz, stdlib only) 로 내보낸다.
#
# 엔트리:
#   speakers/<meeting_id>.json                 회의별 sidecar SpeakerDB. 로스터가 비었거나 못 읽으면 없음
#   audio/<meeting_id>.<ext>                   include_audio=true & 실제 파일 존재 시
#   attachments/<basename>                     첨부 파일이 실제 존재 시
#   attachments/<basename>.extracted/<rel>     .extracted 디렉토리가 존재 시 재귀 번들
#   manifest.json                              (필수) scope:"meeting" + 회의 메타·자식 컬렉션·태그
#
# ⚠️ manifest.json 은 **마지막** 엔트리다(ProjectExporter/FolderExporter 와 동일). tar 는
# append-only 라 이미 쓴 엔트리를 되돌아가 고칠 수 없는데, manifest 의 speaker_db_degraded
# 표식은 로스터 수집이 끝나야 값이 정해지기 때문. MeetingImporter 는 tar 를 끝까지 읽고
# 엔트리 **이름**으로 고르므로 순서에 의존하지 않는다.
#
# 사용법:
#   exporter = MeetingExporter.new(meeting, include_audio: true)
#   exporter.write_to(io)   # StringIO / File 등 write 가능한 IO
#   exporter.filename       # 다운로드 파일명
class MeetingExporter
  FORMAT_VERSION = 1

  # @param meeting [Meeting]
  # @param include_audio [Boolean] 오디오 파일 동봉 여부
  def initialize(meeting, include_audio: true)
    @meeting             = meeting
    @include_audio       = include_audio
    @serializer          = Transfer::MeetingSerializer.new(meeting)
    @speaker_db_degraded = false # 로스터를 놓쳤는가(§H1 아카이브 수준 표식)
  end

  # tar.gz 스트림을 io 에 작성한다.
  # @param io [IO] write 가능한 IO
  def write_to(io)
    gz  = Zlib::GzipWriter.new(io)
    tar = Gem::Package::TarWriter.new(gz)

    begin
      # 순서 고정: 로스터 → 오디오/첨부 → manifest.
      # manifest 가 마지막인 이유는 클래스 주석 참고(열화 표식은 로스터 수집 후에 확정).
      add_speaker_db(tar)
      add_files(tar)
      add_manifest(tar)
    ensure
      close_tar_then_gz(tar, gz, pending_error: $!)
    end
  end

  # 다운로드 파일명. <slug>-meeting-YYYYMMDD.ddobak-meeting.tgz
  # @return [String]
  def filename
    slug = @meeting.title.to_s.parameterize
    slug = "meeting" if slug.blank?
    "#{slug}-meeting-#{Date.current.strftime('%Y%m%d')}.ddobak-meeting.tgz"
  end

  private

  # 매니페스트 Hash. 파일 바이너리는 포함하지 않는다(파일은 tar 엔트리).
  #
  # speaker_db_degraded: 이 아카이브를 만들 때 화자 로스터를 놓쳤는가.
  # import 가 이 표식을 보고 사용자 경고를 올린다(§H1) — 표식이 없으면 사이드카 문제로
  # 로스터가 빠진 아카이브가 정상처럼 보이고 import 도 조용히 넘어간다.
  # write_to 를 거치지 않고 #manifest 만 호출하면 로스터 수집 자체가 없으므로 false.
  # @return [Hash]
  def manifest
    {
      format_version: FORMAT_VERSION,
      scope:          "meeting",
      exported_at:    Time.current.iso8601,
      app_version:    app_version,
      include_audio:  @include_audio,
      # 키 문자열은 Transfer::SpeakerDbTransfer::DEGRADED_MANIFEST_KEY 와 같아야 한다.
      speaker_db_degraded: @speaker_db_degraded,
      meeting:        @serializer.as_hash,
      tags:           @serializer.tags.map(&:attributes)
    }
  end

  def add_manifest(tar)
    json  = JSON.pretty_generate(manifest)
    bytes = json.b
    tar.add_file_simple("manifest.json", 0o644, bytes.bytesize) do |entry|
      entry.write(bytes)
    end
  end

  # include_audio=false 면 audio/ 엔트리를 건너뛴다.
  def add_files(tar)
    @serializer.files.each do |file_entry|
      next if !@include_audio && file_entry[:tar_entry].start_with?("audio/")

      Transfer::Archive.add_file_streamed(tar, file_entry[:tar_entry], file_entry[:path])
    end
  end

  # sidecar 의 SpeakerDB(화자 임베딩·이름·next_num) 를 speakers/<meeting_id>.json 으로 번들.
  # sidecar 다운/에러 시 스킵(export 전체를 실패시키지 않음, Transfer::SpeakerDbTransfer 가
  # 흡수) — 단 **조용히**는 아니다. 놓치면 @speaker_db_degraded 로 기록해 manifest 표식 →
  # import 경고까지 이어진다(§H1, ProjectExporter/FolderExporter 와 동일).
  def add_speaker_db(tar)
    speaker_exporter = Transfer::SpeakerDbTransfer::Exporter.new

    bytes = speaker_exporter.bytes_for(@meeting.id)
    unless bytes.nil?
      entry_name = Transfer::SpeakerDbTransfer.entry_name(@meeting.id)
      tar.add_file_simple(entry_name, 0o644, bytes.bytesize) { |entry| entry.write(bytes) }
    end

    @speaker_db_degraded = speaker_exporter.any_roster_dropped?
  end

  # tar 끝 마커(1024 zero bytes)와 gzip 트레일러(CRC+ISIZE)를 **둘 다** 남긴다
  # (ProjectExporter#close_tar_then_gz 와 동일한 형태 — §H2).
  #
  # ⚠️ tar.close 가 raise 하면 같은 ensure 안의 gz.finish 가 건너뛰어져 gzip 트레일러
  # 없는 스트림이 남는다(GzipReader 가 "unexpected end of file"). 그래서 close 실패를
  # 일단 잡아 gz.finish 를 보장한 뒤 다시 올린다. 다만 이미 진행 중인 예외가 있으면
  # 그쪽이 원인이므로 덮어쓰지 않는다(삼키면 잘린 아카이브가 200 으로 나간다).
  def close_tar_then_gz(tar, gz, pending_error: nil)
    close_error = nil
    begin
      # TarWriter#close 는 idempotent 하지 않다(check_closed → IOError) → closed? 가드.
      tar.close if tar && !tar.closed?
    rescue StandardError => e
      close_error = e
      Rails.logger.warn("MeetingExporter: tar close failed: #{e.class}: #{e.message}")
    end

    # TarWriter#close 가 gz 를 닫지 않으므로 직접 finish. (io 는 호출자 소유)
    gz.finish if gz

    raise close_error if close_error && pending_error.nil?
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
