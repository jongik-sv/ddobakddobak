class CardExtractionJob < ApplicationJob
  queue_as :card_extraction

  def perform(attachment_id)
    attachment = MeetingAttachment.find_by(id: attachment_id)
    return unless attachment&.category == "business_card"

    meeting  = attachment.meeting
    contacts = CardExtractionService.new(attachment).call

    contacts.each do |c|
      mc = meeting.meeting_contacts.create!(
        name: c[:name], company: c[:company], department: c[:department],
        title: c[:title], mobile: c[:mobile], phone: c[:phone], fax: c[:fax],
        email: c[:email], website: c[:website], address: c[:address],
        extra: c[:extra] || {}, raw_text: c[:raw_text],
        source_attachment_id: attachment.id, created_by_id: attachment.uploaded_by_id
      )
      meeting.append_attendee!(mc.name, mc.company)
    end

    ActionCable.server.broadcast(
      meeting.transcription_stream,
      { type: "contacts_updated", meeting_id: meeting.id }
    )
  rescue => e
    Rails.logger.error "[CardExtractionJob] attachment=#{attachment_id} error=#{e.class}: #{e.message}"
    if attachment&.meeting
      ActionCable.server.broadcast(
        attachment.meeting.transcription_stream,
        { type: "card_extraction_failed", attachment_id: attachment_id, error: e.message }
      )
    end
  end
end
