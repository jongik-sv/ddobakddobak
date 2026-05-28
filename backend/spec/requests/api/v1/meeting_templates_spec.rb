require "rails_helper"

RSpec.describe "Api::V1::MeetingTemplates", type: :request do
  let(:admin)  { create(:user, :admin) }
  let(:member) { create(:user) }

  describe "server mode" do
    before do
      allow_any_instance_of(ApplicationController).to receive(:server_mode?).and_return(true)
    end

    describe "GET /api/v1/meeting_templates (any user)" do
      it "returns all global templates" do
        create(:meeting_template, name: "A")
        create(:meeting_template, name: "B")
        login_as(member)

        get "/api/v1/meeting_templates"

        expect(response).to have_http_status(:ok)
        expect(response.parsed_body.length).to eq(2)
      end
    end

    describe "writes by member" do
      before { login_as(member) }

      it "POST returns 403" do
        post "/api/v1/meeting_templates", params: { name: "X" }, as: :json
        expect(response).to have_http_status(:forbidden)
      end

      it "PUT returns 403" do
        tpl = create(:meeting_template)
        put "/api/v1/meeting_templates/#{tpl.id}", params: { name: "X" }, as: :json
        expect(response).to have_http_status(:forbidden)
      end

      it "DELETE returns 403" do
        tpl = create(:meeting_template)
        delete "/api/v1/meeting_templates/#{tpl.id}"
        expect(response).to have_http_status(:forbidden)
      end
    end

    describe "writes by admin" do
      before { login_as(admin) }

      it "POST creates a template" do
        expect {
          post "/api/v1/meeting_templates",
               params: { name: "스탠드업", meeting_type: "standup", settings_json: { language: "ko" } },
               as: :json
        }.to change(MeetingTemplate, :count).by(1)
        expect(response).to have_http_status(:created)
        expect(response.parsed_body["name"]).to eq("스탠드업")
      end

      it "PUT updates a template" do
        tpl = create(:meeting_template, name: "Old")
        put "/api/v1/meeting_templates/#{tpl.id}", params: { name: "New" }, as: :json
        expect(response).to have_http_status(:ok)
        expect(response.parsed_body["name"]).to eq("New")
      end

      it "DELETE removes a template" do
        tpl = create(:meeting_template)
        expect { delete "/api/v1/meeting_templates/#{tpl.id}" }
          .to change(MeetingTemplate, :count).by(-1)
        expect(response).to have_http_status(:no_content)
      end

      it "POST with invalid params returns 422" do
        post "/api/v1/meeting_templates", params: { name: "" }, as: :json
        expect(response).to have_http_status(:unprocessable_entity)
      end
    end
  end

  describe "local mode (admin check bypassed)" do
    before do
      allow_any_instance_of(ApplicationController).to receive(:server_mode?).and_return(false)
      login_as(member)
    end

    it "member can create" do
      expect {
        post "/api/v1/meeting_templates", params: { name: "Y" }, as: :json
      }.to change(MeetingTemplate, :count).by(1)
      expect(response).to have_http_status(:created)
    end
  end
end
