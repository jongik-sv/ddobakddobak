require "rubygems/package"
require "zlib"

# 회의 1건을 .ddobak-meeting.tgz (tar.gz, stdlib only) 로 내보낸다.
#
# 엔트리:
#   manifest.json                              필수. scope:"meeting" + 회의 메타·자식 컬렉션·태그
#   audio/<meeting_id>.<ext>                   include_audio=true & 실제 파일 존재 시
#   attachments/<basename>                     첨부 파일이 실제 존재 시
#   attachments/<basename>.extracted/<rel>     .extracted 디렉토리가 존재 시 재귀 번들
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
    @meeting       = meeting
    @include_audio = include_audio
    @serializer    = Transfer::MeetingSerializer.new(meeting)
  end

  # tar.gz 스트림을 io 에 작성한다.
  # @param io [IO] write 가능한 IO
  def write_to(io)
    gz  = Zlib::GzipWriter.new(io)
    tar = Gem::Package::TarWriter.new(gz)

    add_manifest(tar)
    add_files(tar)

    tar.close
  ensure
    gz.finish if gz
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
  def manifest
    {
      format_version: FORMAT_VERSION,
      scope:          "meeting",
      exported_at:    Time.current.iso8601,
      app_version:    app_version,
      include_audio:  @include_audio,
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

  def app_version
    @app_version ||= begin
      file = Rails.root.join("..", "VERSION")
      File.exist?(file) ? File.read(file).strip : nil
    rescue StandardError
      nil
    end
  end
end
