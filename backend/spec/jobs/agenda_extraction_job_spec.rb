require "rails_helper"

RSpec.describe AgendaExtractionJob, type: :job do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user) }
  let(:att) do
    meeting.meeting_attachments.create!(
      kind: "file", category: "agenda", display_name: "d.pptx", original_filename: "d.pptx",
      content_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      file_size: 3, file_path: "/tmp/d.pptx", uploaded_by_id: user.id, position: 1
    )
  end

  it "runs extraction then enqueues AgendaReferenceJob for the meeting" do
    expect_any_instance_of(AgendaExtractionService).to receive(:call).and_return([ "/tmp/d.pptx.extracted/d.pptx.md" ])
    expect(AgendaReferenceJob).to receive(:perform_later).with(meeting.id)

    described_class.perform_now(att.id)
  end

  it "still enqueues AgendaReferenceJob when extraction fails (partial reflect)" do
    allow_any_instance_of(AgendaExtractionService).to receive(:call)
      .and_raise(AgendaExtractionService::ExtractionUnavailable, "boom")
    expect(AgendaReferenceJob).to receive(:perform_later).with(meeting.id)

    expect { described_class.perform_now(att.id) }.not_to raise_error
  end

  it "no-ops for a missing attachment" do
    expect(AgendaReferenceJob).not_to receive(:perform_later)
    expect { described_class.perform_now(-1) }.not_to raise_error
  end
end
