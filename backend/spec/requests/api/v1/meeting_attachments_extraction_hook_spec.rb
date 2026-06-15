require "rails_helper"
require "tmpdir"

RSpec.describe "Api::V1::MeetingAttachments extraction hook", type: :request do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user) }
  before { login_as(user) }

  around do |example|
    Dir.mktmpdir do |dir|
      prev = ENV["ATTACHMENTS_DIR"]; ENV["ATTACHMENTS_DIR"] = dir
      example.run
      ENV["ATTACHMENTS_DIR"] = prev
    end
  end

  def upload(content_type:, filename:, content: "bytes")
    Rack::Test::UploadedFile.new(StringIO.new(content), content_type, true, original_filename: filename)
  end

  it "enqueues AgendaExtractionJob (not RefJob directly) for a non-text agenda upload" do
    expect(AgendaExtractionJob).to receive(:perform_later)
    expect(AgendaReferenceJob).not_to receive(:perform_later)
    post "/api/v1/meetings/#{meeting.id}/attachments",
         params: { category: "agenda",
                   file: upload(content_type: "application/pdf", filename: "a.pdf", content: "%PDF-1.4") }
    expect(response).to have_http_status(:created)
  end

  it "enqueues AgendaReferenceJob directly for a text agenda upload" do
    expect(AgendaReferenceJob).to receive(:perform_later)
    expect(AgendaExtractionJob).not_to receive(:perform_later)
    post "/api/v1/meetings/#{meeting.id}/attachments",
         params: { category: "agenda", file: upload(content_type: "text/markdown", filename: "a.md") }
    expect(response).to have_http_status(:created)
  end
end
