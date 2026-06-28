require "rubygems/package"
require "zlib"

# 폴더 1개(서브트리 전체)를 .ddobak-folder.tgz(tar.gz, stdlib only)로 내보낸다.
#
# 엔트리:
#   manifest.json                              필수. scope:"folder" + 폴더 서브트리·회의 목록·태그
#   audio/<원본meeting_id>.<ext>              include_audio=true & 실제 파일 존재 시
#   attachments/<basename>                     첨부 파일이 실제 존재 시
#   attachments/<basename>.extracted/<rel>     .extracted 디렉토리가 존재 시 재귀 번들
#
# 사용법:
#   exporter = FolderExporter.new(folder, include_audio: true)
#   exporter.write_to(io)   # StringIO / File 등 write 가능한 IO
#   exporter.filename       # 다운로드 파일명
class FolderExporter
  FORMAT_VERSION = 1

  # @param folder [Folder]
  # @param include_audio [Boolean] 오디오 파일 동봉 여부
  def initialize(folder, include_audio: true)
    @folder        = folder
    @include_audio = include_audio
  end

  # tar.gz 스트림을 io 에 작성한다.
  # @param io [IO] write 가능한 IO
  def write_to(io)
    gz  = Zlib::GzipWriter.new(io)
    tar = Gem::Package::TarWriter.new(gz)

    add_manifest(tar)
    add_files(tar)
  ensure
    tar&.close
    gz&.finish
  end

  # 다운로드 파일명. <slug>-folder-YYYYMMDD.ddobak-folder.tgz
  # slug blank 시 "folder" 폴백 (meeting_exporter 패턴 동일).
  # @return [String]
  def filename
    slug = @folder.name.to_s.parameterize
    slug = "folder" if slug.blank?
    "#{slug}-folder-#{Date.current.strftime('%Y%m%d')}.ddobak-folder.tgz"
  end

  private

  # 폴더 서브트리: 인자 folder + 모든 하위 폴더(재귀 children).
  # 사이클은 Folder#children 이 DB FK로 보장하므로 단순 재귀로 충분.
  def folders
    @folders ||= collect_subtree(@folder)
  end

  def collect_subtree(folder)
    [folder] + folder.children.flat_map { |c| collect_subtree(c) }
  end

  # 서브트리 내 전 폴더에 속한 회의들.
  def meetings
    @meetings ||= Meeting.where(folder_id: folders.map(&:id)).to_a
  end

  # 각 회의의 Transfer::MeetingSerializer 인스턴스.
  def serializers
    @serializers ||= meetings.map { |m| Transfer::MeetingSerializer.new(m) }
  end

  # 폴더들 tag_ids + 회의들 tag_ids 합집합의 Tag 레코드(중복 제거).
  def tags
    @tags ||= begin
      folder_tag_ids  = folders.flat_map { |f| f.taggings.map(&:tag_id) }
      meeting_tag_ids = serializers.flat_map { |s| s.tags.map(&:id) }
      tag_ids = (folder_tag_ids + meeting_tag_ids).uniq
      Tag.where(id: tag_ids).to_a
    end
  end

  # 매니페스트 Hash. 파일 바이너리는 포함하지 않는다(파일은 tar 엔트리).
  def manifest
    {
      format_version: FORMAT_VERSION,
      scope:          "folder",
      exported_at:    Time.current.iso8601,
      app_version:    app_version,
      include_audio:  @include_audio,
      folders:        folders.map { |f| serialize_folder(f) },
      meetings:       serializers.map(&:as_hash),
      tags:           tags.map(&:attributes)
    }
  end

  # 폴더 1건 + 소유 자식(glossary_entries · taggings). parent_id 원본 보존.
  def serialize_folder(folder)
    folder.attributes.merge(
      "glossary_entries" => folder.glossary_entries.map(&:attributes),
      "tag_ids"          => folder.taggings.map(&:tag_id)
    )
  end

  def add_manifest(tar)
    json  = JSON.pretty_generate(manifest)
    bytes = json.b
    tar.add_file_simple("manifest.json", 0o644, bytes.bytesize) do |entry|
      entry.write(bytes)
    end
  end

  # include_audio=false 면 audio/ エントリを건너뛴다 (meeting_exporter 패턴 동일).
  def add_files(tar)
    serializers.each do |serializer|
      serializer.files.each do |file_entry|
        next if !@include_audio && file_entry[:tar_entry].start_with?("audio/")

        Transfer::Archive.add_file_streamed(tar, file_entry[:tar_entry], file_entry[:path])
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
