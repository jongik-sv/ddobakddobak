require "rails_helper"

RSpec.describe "Trash API", type: :request do
  let(:user)  { create(:user) }
  let(:other) { create(:user) }
  let(:project) { create(:project, creator: user) }

  describe "GET /api/v1/trash" do
    it "lists only my root trashed items" do
      login_as(user)
      m = create(:meeting, title: "Mine", project: project, creator: user)
      Trash::SoftDeleter.call(m, by: user)

      get "/api/v1/trash"

      expect(response).to have_http_status(:ok)
      items = response.parsed_body["items"]
      expect(items.map { |i| i["title"] || i["name"] }).to include("Mine")
    end

    it "admin 목록에 남의 개인 프로젝트 회의는 노출되지 않는다" do
      other_personal = other.projects.find_by(personal: true)
      hidden = create(:meeting, title: "Others Personal", project: other_personal, creator: other)
      Trash::SoftDeleter.call(hidden, by: other)

      login_as(create(:user, :admin))
      get "/api/v1/trash"

      expect(response).to have_http_status(:ok)
      items = response.parsed_body["items"]
      expect(items.map { |i| i["title"] || i["name"] }).not_to include("Others Personal")
    end
  end

  describe "POST /api/v1/trash/:type/:id/restore" do
    it "brings the meeting back" do
      login_as(user)
      m = create(:meeting, title: "M", project: project, creator: user)
      Trash::SoftDeleter.call(m, by: user)

      post "/api/v1/trash/meeting/#{m.id}/restore"

      expect(response).to have_http_status(:ok).or have_http_status(:no_content)
      expect(m.reload.trashed?).to be false
    end
  end

  describe "DELETE /api/v1/trash/:type/:id" do
    it "permanently removes the meeting" do
      login_as(user)
      m = create(:meeting, title: "M", project: project, creator: user)
      Trash::SoftDeleter.call(m, by: user)

      delete "/api/v1/trash/meeting/#{m.id}"

      expect(Meeting.exists?(m.id)).to be false
    end

    it "forbids a non-owner non-admin from purging" do
      m = create(:meeting, title: "M", project: project, creator: user)
      Trash::SoftDeleter.call(m, by: user)

      login_as(other)
      delete "/api/v1/trash/meeting/#{m.id}"

      expect(response).to have_http_status(:forbidden)
      expect(Meeting.exists?(m.id)).to be true
    end
  end

  describe "DELETE /api/v1/trash" do
    it "empties my trash" do
      login_as(user)
      m = create(:meeting, title: "M", project: project, creator: user)
      Trash::SoftDeleter.call(m, by: user)

      delete "/api/v1/trash"

      expect(Meeting.exists?(m.id)).to be false
    end
  end
end
