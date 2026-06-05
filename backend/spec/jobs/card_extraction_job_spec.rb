require "rails_helper"

RSpec.describe CardExtractionJob, type: :job do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user, attendees: nil) }
  let(:attachment) do
    meeting.meeting_attachments.create!(
      kind: "file", category: "business_card", display_name: "card.jpg",
      original_filename: "card.jpg", content_type: "image/jpeg",
      file_size: 3, file_path: "/tmp/x.jpg", uploaded_by_id: user.id, position: 1
    )
  end

  it "creates contacts, syncs attendees, and broadcasts contacts_updated" do
    allow_any_instance_of(CardExtractionService).to receive(:call).and_return([
      { name: "홍길동", company: "또박", title: "팀장", email: "h@x.io",
        extra: { "kakao" => "hong" }, raw_text: "원문" }
    ])
    expect(ActionCable.server).to receive(:broadcast).with(
      meeting.transcription_stream, hash_including(type: "contacts_updated")
    )

    described_class.perform_now(attachment.id)

    c = meeting.meeting_contacts.last
    expect(c.name).to eq("홍길동")
    expect(c.source_attachment_id).to eq(attachment.id)
    expect(c.created_by_id).to eq(user.id)
    expect(meeting.reload.attendees).to eq("홍길동 (또박)")
  end

  it "broadcasts card_extraction_failed and preserves the attachment on error" do
    allow_any_instance_of(CardExtractionService).to receive(:call)
      .and_raise(CardExtractionService::VisionUnavailable, "no key")
    expect(ActionCable.server).to receive(:broadcast).with(
      meeting.transcription_stream, hash_including(type: "card_extraction_failed")
    )

    expect { described_class.perform_now(attachment.id) }.not_to raise_error
    expect(MeetingAttachment.exists?(attachment.id)).to be(true)
    expect(meeting.meeting_contacts.count).to eq(0)
  end

  it "no-ops for non-business_card attachments" do
    other = meeting.meeting_attachments.create!(
      kind: "file", category: "reference", display_name: "d.pdf",
      original_filename: "d.pdf", content_type: "application/pdf",
      file_size: 3, file_path: "/tmp/d.pdf", uploaded_by_id: user.id, position: 2
    )
    expect_any_instance_of(CardExtractionService).not_to receive(:call)
    described_class.perform_now(other.id)
  end
end
