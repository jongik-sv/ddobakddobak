require "rails_helper"

RSpec.describe "Api::V1::Admin::Users", type: :request do
  let(:admin) { create(:user, :admin) }
  let(:member) { create(:user) }

  describe "as admin" do
    before { login_as(admin) }

    describe "GET /api/v1/admin/users" do
      it "returns all users" do
        create_list(:user, 3)

        get "/api/v1/admin/users"

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["users"].length).to eq(4) # admin + 3 created
        expect(json["users"].first).to include("id", "email", "name", "role", "created_at")
      end
    end

    describe "POST /api/v1/admin/users" do
      it "creates a new user" do
        expect {
          post "/api/v1/admin/users", params: {
            email: "new@example.com", name: "New User",
            password: "password123", role: "member"
          }, as: :json
        }.to change(User, :count).by(1)

        expect(response).to have_http_status(:created)
        json = response.parsed_body
        expect(json["user"]["email"]).to eq("new@example.com")
        expect(json["user"]["role"]).to eq("member")
      end

      it "creates an admin user" do
        post "/api/v1/admin/users", params: {
          email: "admin2@example.com", name: "Admin 2",
          password: "password123", role: "admin"
        }, as: :json

        expect(response).to have_http_status(:created)
        expect(response.parsed_body["user"]["role"]).to eq("admin")
      end

      it "returns 422 for invalid params" do
        post "/api/v1/admin/users", params: { email: "", name: "" }, as: :json
        expect(response).to have_http_status(:unprocessable_entity)
      end
    end

    describe "PUT /api/v1/admin/users/:id" do
      it "updates user name and role" do
        put "/api/v1/admin/users/#{member.id}", params: {
          name: "Updated Name", role: "admin"
        }, as: :json

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["user"]["name"]).to eq("Updated Name")
        expect(json["user"]["role"]).to eq("admin")
      end

      it "returns 404 for non-existent user" do
        put "/api/v1/admin/users/999999", params: { name: "X" }, as: :json
        expect(response).to have_http_status(:not_found)
      end
    end

    describe "DELETE /api/v1/admin/users/:id" do
      it "deletes a member user" do
        member # create
        expect {
          delete "/api/v1/admin/users/#{member.id}"
        }.to change(User, :count).by(-1)

        expect(response).to have_http_status(:no_content)
      end

      it "prevents admin from deleting themselves" do
        delete "/api/v1/admin/users/#{admin.id}"

        expect(response).to have_http_status(:forbidden)
        expect(response.parsed_body["error"]).to eq("Cannot delete yourself")
      end

      it "returns 404 for non-existent user" do
        delete "/api/v1/admin/users/999999"
        expect(response).to have_http_status(:not_found)
      end
    end
  end

  describe "as member" do
    before { login_as(member) }

    it "returns 403 for index" do
      get "/api/v1/admin/users"
      expect(response).to have_http_status(:forbidden)
    end

    it "returns 403 for create" do
      post "/api/v1/admin/users", params: {
        email: "x@x.com", name: "X", password: "p", role: "member"
      }, as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "returns 403 for update" do
      target = create(:user)
      put "/api/v1/admin/users/#{target.id}", params: { name: "X" }, as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "returns 403 for destroy" do
      target = create(:user)
      delete "/api/v1/admin/users/#{target.id}"
      expect(response).to have_http_status(:forbidden)
    end
  end
end
