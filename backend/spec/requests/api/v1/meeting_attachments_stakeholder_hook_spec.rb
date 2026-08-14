require "rails_helper"
require "tmpdir"

# 이해관계자 첨부 변경 시 StakeholderReferenceJob/StakeholderExtractionJob 재계산 트리거:
# meeting_attachments_agenda_hook_spec.rb 미러.
RSpec.describe "Api::V1::MeetingAttachments stakeholder reference hook", type: :request do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user) }

  before { login_as(user) }

  around do |example|
    Dir.mktmpdir do |dir|
      prev = ENV["ATTACHMENTS_DIR"]
      ENV["ATTACHMENTS_DIR"] = dir
      example.run
      ENV["ATTACHMENTS_DIR"] = prev
    end
  end

  def md_upload(filename: "stakeholder.md", content: "# 이해관계자\n- 김철수 / 기획팀")
    Rack::Test::UploadedFile.new(StringIO.new(content), "text/markdown", true, original_filename: filename)
  end

  def pptx_upload(filename: "org.pptx", content: "binary")
    Rack::Test::UploadedFile.new(StringIO.new(content),
      "application/vnd.openxmlformats-officedocument.presentationml.presentation", true,
      original_filename: filename)
  end

  it "enqueues StakeholderReferenceJob when a stakeholder markdown file is uploaded" do
    expect(StakeholderReferenceJob).to receive(:perform_later).with(meeting.id)
    post "/api/v1/meetings/#{meeting.id}/attachments",
         params: { category: "stakeholder", file: md_upload }
    expect(response).to have_http_status(:created)
  end

  it "enqueues StakeholderExtractionJob when a non-text stakeholder file is uploaded" do
    expect(StakeholderExtractionJob).to receive(:perform_later)
    post "/api/v1/meetings/#{meeting.id}/attachments",
         params: { category: "stakeholder", file: pptx_upload }
    expect(response).to have_http_status(:created)
  end

  it "does not enqueue for a non-stakeholder upload" do
    expect(StakeholderReferenceJob).not_to receive(:perform_later)
    expect(StakeholderExtractionJob).not_to receive(:perform_later)
    post "/api/v1/meetings/#{meeting.id}/attachments",
         params: { category: "reference", file: md_upload }
    expect(response).to have_http_status(:created)
  end

  it "enqueues when a stakeholder attachment is destroyed" do
    att = meeting.meeting_attachments.create!(
      kind: "file", category: "stakeholder", display_name: "a.md", original_filename: "a.md",
      content_type: "text/markdown", file_size: 3, file_path: "/tmp/none.md",
      uploaded_by_id: user.id, position: 1
    )
    expect(StakeholderReferenceJob).to receive(:perform_later).with(meeting.id)
    delete "/api/v1/meetings/#{meeting.id}/attachments/#{att.id}"
    expect(response).to have_http_status(:no_content)
  end

  it "enqueues when an attachment's category changes to stakeholder" do
    att = meeting.meeting_attachments.create!(
      kind: "file", category: "reference", display_name: "r.md", original_filename: "r.md",
      content_type: "text/markdown", file_size: 3, file_path: "/tmp/none.md",
      uploaded_by_id: user.id, position: 1
    )
    expect(StakeholderReferenceJob).to receive(:perform_later).with(meeting.id)
    patch "/api/v1/meetings/#{meeting.id}/attachments/#{att.id}",
          params: { category: "stakeholder" }
    expect(response).to have_http_status(:ok)
  end

  it "enqueues when an attachment's category changes away from stakeholder" do
    att = meeting.meeting_attachments.create!(
      kind: "file", category: "stakeholder", display_name: "a.md", original_filename: "a.md",
      content_type: "text/markdown", file_size: 3, file_path: "/tmp/none.md",
      uploaded_by_id: user.id, position: 1
    )
    expect(StakeholderReferenceJob).to receive(:perform_later).with(meeting.id)
    patch "/api/v1/meetings/#{meeting.id}/attachments/#{att.id}",
          params: { category: "reference" }
    expect(response).to have_http_status(:ok)
  end
end
