require "rails_helper"

RSpec.describe "Api::V1::ChatMessages", type: :request do
  let(:owner) { create(:user) }
  let(:meeting) { create(:meeting, creator: owner) }

  context "as the meeting owner" do
    before { login_as(owner) }

    it "creates user + pending assistant message and enqueues job" do
      expect {
        post "/api/v1/meetings/#{meeting.id}/chat_messages",
             params: { content: "결정 뭐야?" },
             as: :json
      }.to have_enqueued_job(MeetingChatJob)

      expect(response).to have_http_status(:created)
      body = response.parsed_body
      expect(body["user_message"]["content"]).to eq("결정 뭐야?")
      expect(body["assistant_message"]["status"]).to eq("pending")
    end

    it "index returns only current user's messages" do
      create(:chat_message, meeting: meeting, user: owner, role: "user", content: "mine")
      create(:chat_message, meeting: meeting, user: create(:user), role: "user", content: "theirs")

      get "/api/v1/meetings/#{meeting.id}/chat_messages", as: :json

      contents = response.parsed_body.map { |m| m["content"] }
      expect(contents).to include("mine")
      expect(contents).not_to include("theirs")
    end
  end

  context "as a user without meeting read access" do
    # 비공개(shared:false) 회의여야 타인이 읽기 인가에서 막힌다.
    # (기본 meeting 팩토리는 shared:true 라 임의 로그인 유저가 열람 가능.)
    let(:private_meeting) { create(:meeting, :private_meeting, creator: owner) }
    let(:other) { create(:user) }

    before { login_as(other) }

    it "rejects the request" do
      post "/api/v1/meetings/#{private_meeting.id}/chat_messages",
           params: { content: "x" },
           as: :json

      expect(response).to have_http_status(:forbidden)
    end
  end
end
