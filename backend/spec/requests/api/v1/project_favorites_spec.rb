require "rails_helper"

RSpec.describe "Api::V1::Projects favorite", type: :request do
  let(:user) { create(:user) }
  let(:other_user) { create(:user) }
  let(:project) { create(:project, creator: user) }

  before do
    create(:project_membership, user: user, project: project, role: "member")
    login_as(user)
  end

  describe "PUT /api/v1/projects/:id/favorite" do
    it "즐겨찾기를 켠다" do
      expect {
        put "/api/v1/projects/#{project.id}/favorite", params: { favorite: true }, as: :json
      }.to change(ProjectFavorite, :count).by(1)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["favorite"]).to be true
      expect(ProjectFavorite.exists?(user_id: user.id, project_id: project.id)).to be true
    end

    it "즐겨찾기를 끈다" do
      create(:project_favorite, user: user, project: project)

      expect {
        put "/api/v1/projects/#{project.id}/favorite", params: { favorite: false }, as: :json
      }.to change(ProjectFavorite, :count).by(-1)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["favorite"]).to be false
    end

    it "중복 on 토글은 멱등(레코드 1개 유지, 에러 없음)" do
      put "/api/v1/projects/#{project.id}/favorite", params: { favorite: true }, as: :json
      expect(response).to have_http_status(:ok)

      expect {
        put "/api/v1/projects/#{project.id}/favorite", params: { favorite: true }, as: :json
      }.not_to change(ProjectFavorite, :count)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["favorite"]).to be true
    end

    it "중복 off 토글은 멱등(에러 없음)" do
      expect {
        put "/api/v1/projects/#{project.id}/favorite", params: { favorite: false }, as: :json
      }.not_to change(ProjectFavorite, :count)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["favorite"]).to be false
    end

    it "비멤버라도 시스템 admin이면(볼 수 있는 프로젝트) 토글 가능" do
      admin = create(:user, :admin)
      login_as(admin)

      put "/api/v1/projects/#{project.id}/favorite", params: { favorite: true }, as: :json

      expect(response).to have_http_status(:ok)
      expect(ProjectFavorite.exists?(user_id: admin.id, project_id: project.id)).to be true
    end

    it "볼 수 없는 프로젝트(비멤버·비admin)는 403" do
      stranger = create(:user)
      login_as(stranger)

      put "/api/v1/projects/#{project.id}/favorite", params: { favorite: true }, as: :json

      expect(response).to have_http_status(:forbidden)
      expect(ProjectFavorite.exists?(user_id: stranger.id, project_id: project.id)).to be false
    end

    it "타 사용자의 즐겨찾기 상태에 영향을 주지 않는다" do
      create(:project_membership, user: other_user, project: project, role: "member")
      create(:project_favorite, user: other_user, project: project)

      put "/api/v1/projects/#{project.id}/favorite", params: { favorite: true }, as: :json

      expect(response).to have_http_status(:ok)
      expect(ProjectFavorite.exists?(user_id: user.id, project_id: project.id)).to be true
      expect(ProjectFavorite.exists?(user_id: other_user.id, project_id: project.id)).to be true

      put "/api/v1/projects/#{project.id}/favorite", params: { favorite: false }, as: :json

      expect(response).to have_http_status(:ok)
      expect(ProjectFavorite.exists?(user_id: user.id, project_id: project.id)).to be false
      expect(ProjectFavorite.exists?(user_id: other_user.id, project_id: project.id)).to be true
    end
  end

  describe "GET /api/v1/projects — favorite 필드" do
    it "index 응답에 즐겨찾기 여부가 반영된다" do
      other_project = create(:project, creator: user)
      create(:project_membership, user: user, project: other_project, role: "member")
      create(:project_favorite, user: user, project: project)

      get "/api/v1/projects"

      expect(response).to have_http_status(:ok)
      json = response.parsed_body["projects"].index_by { |p| p["id"] }
      expect(json[project.id]["favorite"]).to be true
      expect(json[other_project.id]["favorite"]).to be false
    end

    it "GET /api/v1/projects/:id 에도 favorite 필드가 포함된다" do
      create(:project_favorite, user: user, project: project)

      get "/api/v1/projects/#{project.id}"

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["project"]["favorite"]).to be true
    end
  end
end
