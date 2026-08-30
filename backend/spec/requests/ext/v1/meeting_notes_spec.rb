require "rails_helper"

RSpec.describe "Ext::V1::MeetingNotes", type: :request do
  let(:owner)    { create(:user) }
  let(:outsider) { create(:user) }
  let(:project)  { create(:project, creator: owner) }
  # meeting 팩토리의 after(:create)가 creator(owner)를 프로젝트 멤버로 자동 등록한다.
  let!(:meeting) { create(:meeting, project: project, creator: owner, status: "completed") }

  def issue_token(user, scopes: %w[meetings:read meetings:write], **attrs)
    ApiToken.issue!(user: user, name: "테스트", scopes: scopes, expires_at: 1.day.from_now, **attrs)
  end

  def auth(plaintext)
    { "Authorization" => "Bearer #{plaintext}" }
  end

  describe "POST /api/ext/v1/meetings/:id/notes" do
    it "회의 블록 목록 말미에 source: ext_api로 append한다" do
      existing = FractionalIndexing.position_for(nil, nil, meeting)
      meeting.blocks.create!(block_type: "text", content: "사용자가 쓴 노트", position: existing, source: "user")

      _token, plaintext = issue_token(owner)
      post "/api/ext/v1/meetings/#{meeting.id}/notes", params: { content: "에이전트 노트" }, headers: auth(plaintext), as: :json

      expect(response).to have_http_status(:created)
      note = response.parsed_body["note"]
      expect(note["content"]).to eq("에이전트 노트")

      block = Block.find(note["id"])
      expect(block.source).to eq("ext_api")
      expect(block.position).to be > meeting.blocks.where(source: "user").first.position
    end

    it "content가 없으면 422" do
      _token, plaintext = issue_token(owner)
      post "/api/ext/v1/meetings/#{meeting.id}/notes", params: { content: "" }, headers: auth(plaintext), as: :json
      expect(response).to have_http_status(:unprocessable_entity)
    end

    it "meetings:write 스코프가 없으면 403" do
      _token, plaintext = issue_token(owner, scopes: %w[meetings:read])
      post "/api/ext/v1/meetings/#{meeting.id}/notes", params: { content: "노트" }, headers: auth(plaintext), as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "무관한 사용자는 404" do
      _token, plaintext = issue_token(outsider)
      post "/api/ext/v1/meetings/#{meeting.id}/notes", params: { content: "노트" }, headers: auth(plaintext), as: :json
      expect(response).to have_http_status(:not_found)
    end

    it "잠긴 회의는 409 (code: meeting_locked)" do
      meeting.update!(locked_at: Time.current)
      _token, plaintext = issue_token(owner)
      post "/api/ext/v1/meetings/#{meeting.id}/notes", params: { content: "노트" }, headers: auth(plaintext), as: :json
      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body["error"]["code"]).to eq("meeting_locked")
    end

    it "절단된 회의는 409 (code: meeting_redacted)" do
      meeting.update!(transcripts_redacted_at: Time.current)
      _token, plaintext = issue_token(owner)
      post "/api/ext/v1/meetings/#{meeting.id}/notes", params: { content: "노트" }, headers: auth(plaintext), as: :json
      expect(response).to have_http_status(:conflict)
      expect(response.parsed_body["error"]["code"]).to eq("meeting_redacted")
    end
  end

  describe "GET /api/ext/v1/meetings/:id/notes" do
    it "source: ext_api 블록만 반환하고 user 블록은 제외한다" do
      pos1 = FractionalIndexing.position_for(nil, nil, meeting)
      meeting.blocks.create!(block_type: "text", content: "사용자 노트", position: pos1, source: "user")
      ext_block = meeting.blocks.create!(
        block_type: "text", content: "에이전트 노트",
        position: FractionalIndexing.position_for(nil, nil, meeting), source: "ext_api"
      )

      _token, plaintext = issue_token(owner)
      get "/api/ext/v1/meetings/#{meeting.id}/notes", headers: auth(plaintext)

      expect(response).to have_http_status(:ok)
      notes = response.parsed_body["notes"]
      expect(notes.length).to eq(1)
      expect(notes.first["id"]).to eq(ext_block.id)
      expect(notes.first["content"]).to eq("에이전트 노트")
    end

    it "meetings:read 스코프가 없으면 403" do
      _token, plaintext = issue_token(owner, scopes: %w[meetings:write])
      get "/api/ext/v1/meetings/#{meeting.id}/notes", headers: auth(plaintext)
      expect(response).to have_http_status(:forbidden)
    end

    it "무관한 사용자는 404" do
      _token, plaintext = issue_token(outsider)
      get "/api/ext/v1/meetings/#{meeting.id}/notes", headers: auth(plaintext)
      expect(response).to have_http_status(:not_found)
    end
  end
end
