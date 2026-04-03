require "rails_helper"

RSpec.describe "Api::V1::MeetingTemplates", type: :request do
  let(:user) { create(:user) }
  let(:other_user) { create(:user) }

  before { login_as(user) }

  describe "GET /api/v1/meeting_templates" do
    it "returns only current user's templates" do
      create(:meeting_template, user: user, name: "My Template")
      create(:meeting_template, user: other_user, name: "Other Template")

      get "/api/v1/meeting_templates"

      expect(response).to have_http_status(:ok)
      json = response.parsed_body
      expect(json.length).to eq(1)
      expect(json.first["name"]).to eq("My Template")
    end

    it "returns empty array when no templates" do
      get "/api/v1/meeting_templates"

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq([])
    end
  end

  describe "POST /api/v1/meeting_templates" do
    it "creates a template" do
      expect {
        post "/api/v1/meeting_templates",
             params: { name: "스탠드업", meeting_type: "standup", settings_json: { language: "ko" } },
             as: :json
      }.to change(MeetingTemplate, :count).by(1)

      expect(response).to have_http_status(:created)
      json = response.parsed_body
      expect(json["name"]).to eq("스탠드업")
      expect(json["meeting_type"]).to eq("standup")
      expect(json["settings_json"]).to eq({ "language" => "ko" })
    end

    it "returns errors for invalid params" do
      post "/api/v1/meeting_templates", params: { name: "" }, as: :json

      expect(response).to have_http_status(:unprocessable_entity)
      expect(response.parsed_body["errors"]).to be_present
    end
  end

  describe "PUT /api/v1/meeting_templates/:id" do
    let!(:template) { create(:meeting_template, user: user, name: "Old Name") }

    it "updates the template" do
      put "/api/v1/meeting_templates/#{template.id}",
          params: { name: "New Name" },
          as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["name"]).to eq("New Name")
    end

    it "returns 404 for other user's template" do
      other_template = create(:meeting_template, user: other_user)

      put "/api/v1/meeting_templates/#{other_template.id}",
          params: { name: "Hacked" },
          as: :json

      expect(response).to have_http_status(:not_found)
    end
  end

  describe "DELETE /api/v1/meeting_templates/:id" do
    let!(:template) { create(:meeting_template, user: user) }

    it "deletes the template" do
      expect {
        delete "/api/v1/meeting_templates/#{template.id}"
      }.to change(MeetingTemplate, :count).by(-1)

      expect(response).to have_http_status(:no_content)
    end

    it "returns 404 for other user's template" do
      other_template = create(:meeting_template, user: other_user)

      delete "/api/v1/meeting_templates/#{other_template.id}"

      expect(response).to have_http_status(:not_found)
    end
  end
end
