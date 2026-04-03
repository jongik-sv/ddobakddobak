class MeetingFinalizerService
  def initialize(meeting)
    @meeting = meeting
    @client  = SidecarClient.new
  end

  def call
    transcripts = @meeting.transcripts.order(:sequence_number)
    return if transcripts.empty?

    payload = Transcript.to_sidecar_payload(transcripts)

    # Action Items 추출 (structured JSON)
    items_result = @client.summarize_action_items(payload)
    save_action_items(items_result["action_items"] || [])

    # Decisions 추출 (summarize 엔드포인트에서 decisions 가져오기)
    summary_result = @client.summarize(payload, type: "final")
    save_decisions(summary_result["decisions"] || [])
  rescue SidecarClient::SidecarError => e
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
