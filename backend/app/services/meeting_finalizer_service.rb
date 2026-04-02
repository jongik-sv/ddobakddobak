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

end
