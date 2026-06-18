require "rails_helper"

RSpec.describe "Api::V1::ScopedChatMessages", type: :request do
  let(:project) { create(:project) }
  let(:owner) { project.creator }
  let(:folder) { create(:folder, project: project) }
  # 실제 앱에서 프로젝트 생성자는 항상 멤버다(개인 프로젝트=admin 멤버십, Phase 5 강제).
  # 기본 :project 팩토리는 멤버십을 만들지 않으므로 현실 불변식을 명시적으로 재현한다.
  let!(:owner_membership) { create(:project_membership, project: project, user: owner, role: "admin") }

  context "프로젝트 멤버(폴더 챗)" do
    before { login_as(owner) }

    it "user + pending assistant 생성 후 FolderChatJob enqueue" do
      expect {
        post "/api/v1/folders/#{folder.id}/chat_messages", params: { content: "예산?" }, as: :json
      }.to have_enqueued_job(FolderChatJob)
      expect(response).to have_http_status(:created)
      body = response.parsed_body
      expect(body["user_message"]["content"]).to eq("예산?")
      expect(body["assistant_message"]["status"]).to eq("pending")
    end

    it "index는 본인 메시지만(scope 격리) 반환한다" do
      create(:chat_message, meeting: nil, scope_type: "folder", scope_id: folder.id, user: owner, role: "user", content: "mine")
      create(:chat_message, meeting: nil, scope_type: "folder", scope_id: folder.id, user: create(:user), role: "user", content: "theirs")
      get "/api/v1/folders/#{folder.id}/chat_messages", as: :json
      contents = response.parsed_body.map { |m| m["content"] }
      expect(contents).to include("mine")
      expect(contents).not_to include("theirs")
    end

    it "프로젝트 스코프 create" do
      expect {
        post "/api/v1/projects/#{project.id}/chat_messages", params: { content: "전체 예산?" }, as: :json
      }.to have_enqueued_job(FolderChatJob)
      expect(response).to have_http_status(:created)
    end
  end

  context "프로젝트 비멤버" do
    let(:outsider) { create(:user) }
    before { login_as(outsider) }

    it "폴더 챗을 거부한다(403)" do
      post "/api/v1/folders/#{folder.id}/chat_messages", params: { content: "x" }, as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "프로젝트 챗을 거부한다(403)" do
      post "/api/v1/projects/#{project.id}/chat_messages", params: { content: "x" }, as: :json
      expect(response).to have_http_status(:forbidden)
    end
  end
end
