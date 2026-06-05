require "rails_helper"
require "tmpdir"

# 첨부 파일 업로드 (추가요청 #1)
#
# 핵심 회귀: 일부 클라이언트(Tauri readFile로 만든 File 등)는 업로드 part에 MIME이 없어
# content_type이 비거나 application/octet-stream 으로 도착한다. 그대로면 ALLOWED_CONTENT_TYPES
# 검사에서 거부(422)되어 사용자에게는 "첨부된 항목이 없습니다"만 보였다.
# 컨트롤러가 확장자로 content_type을 보정해 정상 저장(201)되고 목록에 나타나야 한다.
RSpec.describe "Api::V1::MeetingAttachments", type: :request do
  let(:user)    { create(:user) }
  let(:meeting) { create(:meeting, creator: user) }

  before { login_as(user) }

  # 실제 backend/storage/attachments 오염 방지 — 업로드 파일을 임시 디렉터리에 쓰고 자동 정리.
  around do |example|
    Dir.mktmpdir do |dir|
      prev = ENV["ATTACHMENTS_DIR"]
      ENV["ATTACHMENTS_DIR"] = dir
      example.run
      ENV["ATTACHMENTS_DIR"] = prev
    end
  end

  def uploaded_file(content_type:, filename:, content: "%PDF-1.4 fake-bytes")
    Rack::Test::UploadedFile.new(
      StringIO.new(content),
      content_type,
      true,
      original_filename: filename
    )
  end

  describe "POST /api/v1/meetings/:id/attachments (파일)" do
    it "content_type이 application/octet-stream 으로 와도 확장자로 보정해 201 저장하고 GET 목록에 나타난다" do
      post "/api/v1/meetings/#{meeting.id}/attachments",
           params: { category: "reference", file: uploaded_file(content_type: "application/octet-stream", filename: "spec.pdf") }

      expect(response).to have_http_status(:created)
      expect(response.parsed_body["attachment"]["content_type"]).to eq("application/pdf")

      get "/api/v1/meetings/#{meeting.id}/attachments"
      names = response.parsed_body["attachments"].map { |a| a["original_filename"] }
      expect(names).to include("spec.pdf")
    end

    it "content_type이 비어 있어도 확장자(.hwp)로 보정한다" do
      post "/api/v1/meetings/#{meeting.id}/attachments",
           params: { category: "minutes", file: uploaded_file(content_type: "", filename: "회의록.hwp") }

      expect(response).to have_http_status(:created)
      expect(response.parsed_body["attachment"]["content_type"]).to eq("application/x-hwp")
    end

    it "정상 MIME(application/pdf)은 그대로 통과한다" do
      post "/api/v1/meetings/#{meeting.id}/attachments",
           params: { category: "agenda", file: uploaded_file(content_type: "application/pdf", filename: "a.pdf") }

      expect(response).to have_http_status(:created)
      expect(response.parsed_body["attachment"]["content_type"]).to eq("application/pdf")
    end

    it "확장자도 허용목록에 없으면 422(보정 후에도 거부)" do
      post "/api/v1/meetings/#{meeting.id}/attachments",
           params: { category: "reference", file: uploaded_file(content_type: "application/octet-stream", filename: "bad.exe") }

      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  describe "MeetingAttachment.content_type_for_filename" do
    it "확장자를 MIME으로 매핑(대소문자 무시), 미지원은 nil" do
      expect(MeetingAttachment.content_type_for_filename("A.PDF")).to eq("application/pdf")
      expect(MeetingAttachment.content_type_for_filename("b.hwp")).to eq("application/x-hwp")
      expect(MeetingAttachment.content_type_for_filename("c.exe")).to be_nil
    end
  end

  it "enqueues CardExtractionJob when category is business_card" do
    f = Tempfile.new(["card", ".jpg"])
    f.binmode
    f.write("\xFF\xD8\xFF\x00fakejpeg")
    f.rewind
    file = Rack::Test::UploadedFile.new(f.path, "image/jpeg", original_filename: "card.jpg")

    expect {
      post "/api/v1/meetings/#{meeting.id}/attachments",
           params: { category: "business_card", file: file }
    }.to have_enqueued_job(CardExtractionJob)
    expect(response).to have_http_status(:created)
    expect(response.parsed_body["attachment"]["category"]).to eq("business_card")
  ensure
    f.close
    f.unlink
  end
end
