require "rails_helper"

# 이전 회의 참고: create/update 가 previous_meeting_id 를 (접근 가능한 회의만) 수용하고
# show(full) 가 배지용 id·제목을 내려주는지 검증.
RSpec.describe "Api::V1::Meetings previous meeting reference", type: :request do
  let(:user)  { create(:user) }
  let(:other) { create(:user) }
  let(:team)  { create(:team, creator: user) }

  before { login_as(user) }

  describe "POST /api/v1/meetings" do
    it "persists an accessible previous_meeting_id" do
      prev = create(:meeting, team: team, creator: user, title: "지난 회의")

      post "/api/v1/meetings", params: { title: "이어가는 회의", previous_meeting_id: prev.id }

      expect(response).to have_http_status(:created)
      expect(Meeting.find_by(title: "이어가는 회의").previous_meeting_id).to eq(prev.id)
    end

    it "drops a non-accessible previous_meeting_id (위변조 방어)" do
      foreign = create(:meeting, creator: other, shared: false) # 비공개 타인 회의

      post "/api/v1/meetings", params: { title: "회의X", previous_meeting_id: foreign.id }

      expect(response).to have_http_status(:created)
      expect(Meeting.find_by(title: "회의X").previous_meeting_id).to be_nil
    end

    it "creates fine without previous_meeting_id" do
      post "/api/v1/meetings", params: { title: "단독 회의" }
      expect(response).to have_http_status(:created)
      expect(Meeting.find_by(title: "단독 회의").previous_meeting_id).to be_nil
    end
  end

  describe "PATCH /api/v1/meetings/:id" do
    it "updates previous_meeting_id" do
      prev = create(:meeting, team: team, creator: user)
      m = create(:meeting, team: team, creator: user)

      patch "/api/v1/meetings/#{m.id}", params: { previous_meeting_id: prev.id }

      expect(response).to have_http_status(:ok)
      expect(m.reload.previous_meeting_id).to eq(prev.id)
    end

    it "clears previous_meeting_id when sent blank" do
      prev = create(:meeting, team: team, creator: user)
      m = create(:meeting, team: team, creator: user, previous_meeting: prev)

      patch "/api/v1/meetings/#{m.id}", params: { previous_meeting_id: "" }

      expect(m.reload.previous_meeting_id).to be_nil
    end
  end

  describe "GET /api/v1/meetings/:id (show)" do
    it "includes previous_meeting_id and title for the badge" do
      prev = create(:meeting, team: team, creator: user, title: "지난 회의")
      m = create(:meeting, team: team, creator: user, previous_meeting: prev)

      get "/api/v1/meetings/#{m.id}"

      json = response.parsed_body
      expect(json["meeting"]["previous_meeting_id"]).to eq(prev.id)
      expect(json["meeting"]["previous_meeting_title"]).to eq("지난 회의")
    end
  end
end
