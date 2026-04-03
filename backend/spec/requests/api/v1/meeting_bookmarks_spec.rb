require "rails_helper"

RSpec.describe "Api::V1::MeetingBookmarks", type: :request do
  let(:user)        { create(:user) }
  let(:team)        { create(:team, creator: user) }
  let!(:membership) { create(:team_membership, user: user, team: team, role: "member") }
  let(:meeting)     { create(:meeting, team: team, creator: user) }

  before { login_as(user) }

  describe "GET /api/v1/meetings/:meeting_id/bookmarks" do
    it "200과 빈 배열 반환 (북마크 없을 때)" do
      get "/api/v1/meetings/#{meeting.id}/bookmarks"

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq([])
    end

    it "timestamp_ms 순으로 정렬된 북마크 목록 반환" do
      b2 = create(:meeting_bookmark, meeting: meeting, timestamp_ms: 10000, label: "두 번째")
      b1 = create(:meeting_bookmark, meeting: meeting, timestamp_ms: 3000, label: "첫 번째")

      get "/api/v1/meetings/#{meeting.id}/bookmarks"

      expect(response).to have_http_status(:ok)
      json = response.parsed_body
      expect(json.length).to eq(2)
      expect(json[0]["id"]).to eq(b1.id)
      expect(json[1]["id"]).to eq(b2.id)
      expect(json[0]).to have_key("timestamp_ms")
      expect(json[0]).to have_key("label")
      expect(json[0]).to have_key("created_at")
    end
  end

  describe "POST /api/v1/meetings/:meeting_id/bookmarks" do
    it "201과 생성된 북마크 반환" do
      expect {
        post "/api/v1/meetings/#{meeting.id}/bookmarks",
             params: { timestamp_ms: 5000, label: "중요 포인트" },
             as: :json
      }.to change(MeetingBookmark, :count).by(1)

      expect(response).to have_http_status(:created)
      json = response.parsed_body
      expect(json["timestamp_ms"]).to eq(5000)
      expect(json["label"]).to eq("중요 포인트")
      expect(json["meeting_id"]).to eq(meeting.id)
    end

    it "label 없이도 생성 가능" do
      post "/api/v1/meetings/#{meeting.id}/bookmarks",
           params: { timestamp_ms: 3000 },
           as: :json

      expect(response).to have_http_status(:created)
      expect(response.parsed_body["label"]).to be_nil
    end

    it "422 반환 (timestamp_ms 없음)" do
      post "/api/v1/meetings/#{meeting.id}/bookmarks",
           params: { label: "라벨만" },
           as: :json

      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["errors"]).to be_present
    end

    it "422 반환 (음수 timestamp_ms)" do
      post "/api/v1/meetings/#{meeting.id}/bookmarks",
           params: { timestamp_ms: -100 },
           as: :json

      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  describe "DELETE /api/v1/meetings/:meeting_id/bookmarks/:id" do
    it "204 반환하고 북마크 삭제" do
      bookmark = create(:meeting_bookmark, meeting: meeting)

      expect {
        delete "/api/v1/meetings/#{meeting.id}/bookmarks/#{bookmark.id}"
      }.to change(MeetingBookmark, :count).by(-1)

      expect(response).to have_http_status(:no_content)
    end

    it "404 반환 (존재하지 않는 북마크)" do
      delete "/api/v1/meetings/#{meeting.id}/bookmarks/99999"

      expect(response).to have_http_status(:not_found)
    end
  end
end
