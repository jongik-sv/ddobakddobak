require "rails_helper"
require "tmpdir"

# 안건 첨부 변경 시 AgendaReferenceJob 재계산 트리거:
# agenda 카테고리의 텍스트 파일이 생성/카테고리변경/삭제되면 압축 잡을 enqueue 한다.
RSpec.describe "Api::V1::MeetingAttachments agenda reference hook", type: :request do
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

  def md_upload(filename: "agenda.md", content: "# 안건\n1. 항목")
    Rack::Test::UploadedFile.new(StringIO.new(content), "text/markdown", true, original_filename: filename)
  end

  it "enqueues AgendaReferenceJob when an agenda markdown file is uploaded" do
    expect(AgendaReferenceJob).to receive(:perform_later).with(meeting.id)
    post "/api/v1/meetings/#{meeting.id}/attachments",
         params: { category: "agenda", file: md_upload }
    expect(response).to have_http_status(:created)
  end

  it "does not enqueue for a non-agenda upload" do
    expect(AgendaReferenceJob).not_to receive(:perform_later)
    post "/api/v1/meetings/#{meeting.id}/attachments",
         params: { category: "reference", file: md_upload }
    expect(response).to have_http_status(:created)
  end

  it "enqueues when an agenda attachment is destroyed" do
    att = meeting.meeting_attachments.create!(
      kind: "file", category: "agenda", display_name: "a.md", original_filename: "a.md",
      content_type: "text/markdown", file_size: 3, file_path: "/tmp/none.md",
      uploaded_by_id: user.id, position: 1
    )
    expect(AgendaReferenceJob).to receive(:perform_later).with(meeting.id)
    delete "/api/v1/meetings/#{meeting.id}/attachments/#{att.id}"
    expect(response).to have_http_status(:no_content)
  end

  it "enqueues when an attachment's category changes to agenda" do
    att = meeting.meeting_attachments.create!(
      kind: "file", category: "reference", display_name: "r.md", original_filename: "r.md",
      content_type: "text/markdown", file_size: 3, file_path: "/tmp/none.md",
      uploaded_by_id: user.id, position: 1
    )
    expect(AgendaReferenceJob).to receive(:perform_later).with(meeting.id)
    patch "/api/v1/meetings/#{meeting.id}/attachments/#{att.id}",
          params: { category: "agenda" }
    expect(response).to have_http_status(:ok)
  end
end
