require "rubygems/package"
require "zlib"

# 프로젝트 1개를 통째로 .tar.gz(stdlib only)로 직렬화한다.
#
# 엔트리:
#   manifest.json                         (필수) 프로젝트+전 자식 메타데이터(원본 PK 보존)
#   audio/<원본meeting_id>.<ext>          include_audio=true & 실제 파일 존재 시
#   attachments/<원본첨부 basename>        실제 파일 존재 시 (항상)
#
# 대용량 오디오는 디스크에서 청크로 읽어 메모리 폭발을 막는다.
# import 측이 manifest 의 old_id → new 맵으로 FK 를 리매핑한다.
class ProjectExporter
  FORMAT_VERSION = 1
  CHUNK_SIZE     = 64 * 1024 # 64KB 청크 스트리밍

  # @param project [Project]
  # @param include_audio [Boolean] 오디오 파일 동봉 여부 (끄면 메타데이터만)
  def initialize(project, include_audio: true)
    @project       = project
    @include_audio = include_audio
  end

  # tar.gz 스트림을 io 에 작성한다.
  # @param io [IO] write 가능한 IO (예: 응답 스트림, StringIO, File)
  def write_to(io)
    gz  = Zlib::GzipWriter.new(io)
    tar = Gem::Package::TarWriter.new(gz)

    add_manifest(tar)
    add_audio_files(tar) if @include_audio
    add_attachment_files(tar)

    tar.close
  ensure
    # TarWriter#close 가 gz 를 닫지 않으므로 직접 finish. (io 는 호출자 소유)
    gz.finish if gz
  end

  # 매니페스트 Hash. 파일 바이너리는 포함하지 않는다(파일은 tar 엔트리).
  # @return [Hash]
  def manifest
    {
      format_version: FORMAT_VERSION,
      exported_at:    Time.current.iso8601,
      app_version:    app_version,
      include_audio:  @include_audio,
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
