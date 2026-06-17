require "rails_helper"

RSpec.describe "Trash read-path filtering", type: :request do
  let(:user) { create(:user) }
  let(:project) { create(:project, creator: user) }
  let!(:admin_membership) { create(:project_membership, user: user, project: project, role: "admin") }

  before { login_as(user) }

  describe "GET /api/v1/meetings" do
    it "excludes trashed meetings and includes kept ones" do
      kept = create(:meeting, project: project, creator: user, important: true)
      trashed = create(:meeting, project: project, creator: user, important: true)
      Trash::SoftDeleter.call(trashed, by: user)

      get "/api/v1/meetings", params: { show_all: true }

      ids = response.parsed_body["meetings"].map { |m| m["id"] }
      expect(ids).to include(kept.id)
      expect(ids).not_to include(trashed.id)
    end
  end

  describe "GET /api/v1/meetings/:id" do
    it "returns 404 for a trashed meeting" do
      trashed = create(:meeting, project: project, creator: user)
      Trash::SoftDeleter.call(trashed, by: user)

      get "/api/v1/meetings/#{trashed.id}"

      expect(response).to have_http_status(:not_found)
    end
  end

  describe "GET /api/v1/folders" do
    it "excludes trashed folders from the flat list" do
      kept = create(:folder, project: project)
      trashed = create(:folder, project: project)
      Trash::SoftDeleter.call(trashed, by: user)

      get "/api/v1/folders", params: { project_id: project.id, flat: "true" }

      ids = response.parsed_body["folders"].map { |f| f["id"] }
      expect(ids).to include(kept.id)
      expect(ids).not_to include(trashed.id)
    end
  end

  describe "GET /api/v1/projects" do
    it "excludes trashed projects" do
      kept = create(:project, creator: user, personal: false)
      create(:project_membership, user: user, project: kept, role: "admin")
      trashed = create(:project, creator: user, personal: false)
      create(:project_membership, user: user, project: trashed, role: "admin")
      Trash::SoftDeleter.call(trashed, by: user)

      get "/api/v1/projects"

      ids = response.parsed_body["projects"].map { |p| p["id"] }
      expect(ids).to include(kept.id)
      expect(ids).not_to include(trashed.id)
    end
  end
end
