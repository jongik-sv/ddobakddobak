class MeetingFinalizerService
  def initialize(meeting)
    @meeting = meeting
    @llm = LlmService.new(llm_config: meeting.creator&.effective_llm_config)
  end

  def call
    transcripts = @meeting.transcripts.order(:sequence_number)
    return if transcripts.empty?

    payload = Transcript.to_sidecar_payload(transcripts)

    # Action Items 추출 (structured JSON)
    items_result = @llm.summarize_action_items(payload)
    save_action_items(items_result["action_items"] || [])

    # Decisions 추출 (summarize에서 decisions 가져오기)
    summary_result = @llm.summarize(payload, type: "final")
    save_decisions(summary_result["decisions"] || [])
  rescue => e
    Rails.logger.error "[MeetingFinalizerService] meeting=#{@meeting.id} error=#{e.message}"
  end

  private

  def save_action_items(items)
    items.each do |item|
      @meeting.action_items.create!(
        content:      item["content"],
        status:       "todo",
        ai_generated: true
      )
    end
  end

  def save_decisions(decisions)
    decisions.each do |decision_text|
      @meeting.decisions.create!(
        content:      decision_text,
        status:       "active",
        ai_generated: true,
        decided_at:   Time.current
      )
    end
  end

end
