module Transfer
  # 회의 1건을 export 용 Hash + 파일 목록으로 직렬화한다.
  #
  # 사용법:
  #   s = Transfer::MeetingSerializer.new(meeting)
  #   s.as_hash   # → 회의 attrs + 모든 자식 컬렉션(중첩 Hash)
  #   s.files     # → [{tar_entry:, path:}, ...] 실제 파일 목록(audio·첨부·.extracted)
  #   s.tags      # → 회의에 부착된 Tag ActiveRecord 컬렉션
  #
  # 주의:
  #   - audio 파일은 as_hash/files 모두에 포함. include_audio 필터는 MeetingExporter 가 담당.
  #   - attachment 의 as_hash 내 file_path 는 basename 으로 치환(import 가 attachments/<basename> 탐색).
  #   - .extracted 디렉토리(attachment.extraction_dir)가 존재하면 내부 파일을 재귀 포함.
  class MeetingSerializer
    # @param meeting [Meeting]
    def initialize(meeting)
      @meeting = meeting
    end

    # 회의 속성 + 모든 자식 컬렉션을 중첩한 Hash. 원본 PK 보존.
    # @return [Hash]
    def as_hash
      @meeting.attributes.merge(
        transcripts:      @meeting.transcripts.map(&:attributes),
        summaries:        @meeting.summaries.map(&:attributes),
        action_items:     @meeting.action_items.map(&:attributes),
        decisions:        @meeting.decisions.map(&:attributes),
        blocks:           @meeting.blocks.map(&:attributes),
        attachments:      @meeting.meeting_attachments.map { |a| serialize_attachment(a) },
        contacts:         @meeting.meeting_contacts.map(&:attributes),
        bookmarks:        @meeting.meeting_bookmarks.map(&:attributes),
        chat_messages:    @meeting.chat_messages.map(&:attributes),
        tag_ids:          @meeting.taggings.map(&:tag_id),
        glossary_entries: @meeting.glossary_entries.map(&:attributes)
      )
    end

    # 실제 디스크 파일 목록. 없는 파일은 스킵.
    # audio 도 포함하므로 MeetingExporter 가 include_audio 로 필터.
    #
    # @return [Array<Hash>] [{tar_entry: String, path: String}, ...]
    def files
      result = []
      collect_audio(result)
      collect_attachments(result)
      result
    end

    # 회의에 부착된 Tag 레코드. 매니페스트의 "tags" 배열에 사용.
    # @return [ActiveRecord::Relation<Tag>]
    def tags
      Tag.where(id: @meeting.taggings.map(&:tag_id))
    end

    private

    # 오디오 파일이 존재하면 result 에 추가.
    def collect_audio(result)
      path = @meeting.audio_file_path
      return unless path.present? && File.file?(path)

      ext = File.extname(path).presence || ".mp3"
      result << { tar_entry: "audio/#{@meeting.id}#{ext}", path: path }
    end

    # 각 첨부 파일(원본 + .extracted/**) 을 result 에 추가.
    def collect_attachments(result)
      @meeting.meeting_attachments.each do |att|
        next unless att.file? && att.file_path.present? && File.file?(att.file_path)

        basename = File.basename(att.file_path)
        result << { tar_entry: "attachments/#{basename}", path: att.file_path }

        collect_extracted(result, att, basename)
      end
    end

    # .extracted 디렉토리가 있으면 내부 파일을 재귀 수집.
    def collect_extracted(result, attachment, basename)
      extraction_dir = attachment.extraction_dir
      return unless extraction_dir && Dir.exist?(extraction_dir)

      Dir.glob(File.join(extraction_dir, "**", "*")).each do |f|
        next unless File.file?(f)

        rel = f.delete_prefix("#{extraction_dir}/")
        result << { tar_entry: "attachments/#{basename}.extracted/#{rel}", path: f }
      end
    end

    # 첨부 메타: file_path 를 basename 으로 치환.
    def serialize_attachment(attachment)
      attrs = attachment.attributes
      if attachment.file_path.present?
        attrs = attrs.merge("file_path" => File.basename(attachment.file_path))
      end
      attrs
    end
  end
end
