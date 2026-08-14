class StakeholderReferenceJob < ApplicationJob
  queue_as :default

  # stakeholder 카테고리의 텍스트 첨부(.md/.txt)를 모아 LLM 으로 8000자 미만으로 압축해
  # meeting.stakeholder_reference 에 캐시한다. 회의록 요약 잡이 이 값을 참고자료로 주입한다.
  # 이해관계자 자료가 바뀔 때마다(업로드/카테고리변경/삭제) enqueue 되며, 갱신 시 1회주입 플래그를
  # 리셋해 realtime 경로가 새 자료를 한 번 더 주입하게 한다. AgendaReferenceJob 미러.
  STAKEHOLDER_TEXT_TYPES = %w[text/markdown text/plain].freeze
  MAX_STAKEHOLDER_CHARS  = 8000

  def perform(meeting_id)
    meeting = Meeting.find_by(id: meeting_id)
    return unless meeting

    combined = collect_stakeholder_text(meeting)

    if combined.blank?
      meeting.update_columns(stakeholder_reference: nil, stakeholder_reference_applied_at: nil)
      broadcast(meeting)
      return
    end

    compressed = LlmService.new(llm_config: meeting.creator&.effective_llm_config)
                           .compress_stakeholder(combined, max_chars: MAX_STAKEHOLDER_CHARS)

    meeting.update_columns(
      stakeholder_reference: compressed.presence,
      stakeholder_reference_applied_at: nil
    )
    broadcast(meeting)
  rescue => e
    Rails.logger.error "[StakeholderReferenceJob] meeting=#{meeting_id} error=#{e.class}: #{e.message}"
  end

  private

  # 이해관계자 텍스트: 업로드 .md/.txt 원본 + 모든 stakeholder 파일 첨부의 추출폴더(.extracted/*.md) 를 합친다.
  def collect_stakeholder_text(meeting)
    atts = meeting.meeting_attachments
                  .where(category: "stakeholder", kind: "file")
                  .order(:position)

    parts = atts.flat_map do |att|
      pieces = []
      # 업로드된 텍스트 원본
      pieces << read_file(att.file_path) if STAKEHOLDER_TEXT_TYPES.include?(att.content_type)
      # 비-텍스트 추출물
      if att.extraction_dir && File.directory?(att.extraction_dir)
        Dir.glob(File.join(att.extraction_dir, "*.md")).sort.each { |p| pieces << read_file(p) }
      end
      pieces
    end

    parts.compact_blank.join("\n\n---\n\n")
  end

  def read_file(path)
    return nil unless path.present? && File.exist?(path)
    File.read(path)
  rescue => e
    Rails.logger.warn "[StakeholderReferenceJob] read failed #{path}: #{e.message}"
    nil
  end

  def broadcast(meeting)
    ActionCable.server.broadcast(
      meeting.transcription_stream,
      { type: "stakeholder_reference_updated", meeting_id: meeting.id }
    )
  end
end
