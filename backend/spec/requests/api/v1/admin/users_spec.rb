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

      it "updates email" do
        put "/api/v1/admin/users/#{member.id}", params: { email: "renamed@example.com" }, as: :json

        expect(response).to have_http_status(:ok)
        expect(response.parsed_body["user"]["email"]).to eq("renamed@example.com")
      end

      it "refuses to demote the local account" do
        local = User.find_or_create_by!(email: User::LOCAL_EMAIL) { |u| u.name = "사용자"; u.role = "admin" }
        put "/api/v1/admin/users/#{local.id}", params: { role: "member" }, as: :json

        expect(response).to have_http_status(:forbidden)
        expect(local.reload.role).to eq("admin")
      end

      it "refuses to change the local account email" do
        local = User.find_or_create_by!(email: User::LOCAL_EMAIL) { |u| u.name = "사용자"; u.role = "admin" }
        put "/api/v1/admin/users/#{local.id}", params: { email: "x@example.com" }, as: :json

        expect(response).to have_http_status(:forbidden)
        expect(local.reload.email).to eq(User::LOCAL_EMAIL)
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

      it "refuses to delete the local account" do
        local = User.find_or_create_by!(email: User::LOCAL_EMAIL) { |u| u.name = "사용자"; u.role = "admin" }
        expect {
          delete "/api/v1/admin/users/#{local.id}"
        }.not_to change(User, :count)

        expect(response).to have_http_status(:forbidden)
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

  describe "POST /api/v1/admin/users/:id/reset_password" do
    include_context "server mode"
    let(:remote) { { "REMOTE_ADDR" => "192.168.1.50" } }

    def login(user, password = "password123")
      post "/auth/login", params: { user: { email: user.email, password: password } }, as: :json
      response.parsed_body["access_token"]
    end

    it "resets password, returns temp, and invalidates the target's sessions" do
      admin_pw = create(:user, :admin, password: "password123")
      member_pw = create(:user, password: "password123")
      member_token = login(member_pw)
      admin_token = login(admin_pw)

      post "/api/v1/admin/users/#{member_pw.id}/reset_password",
        headers: remote.merge("Authorization" => "Bearer #{admin_token}"), as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["temp_password"]).to be_present
      expect(response.parsed_body["temp_password"].length).to be >= 12

      get "/api/v1/meetings",
        headers: remote.merge("Authorization" => "Bearer #{member_token}"), as: :json
      expect(response).to have_http_status(:unauthorized)
    end

    it "lets the target log in with the temp password" do
      admin_pw = create(:user, :admin, password: "password123")
      member_pw = create(:user, password: "password123")
      admin_token = login(admin_pw)

      post "/api/v1/admin/users/#{member_pw.id}/reset_password",
        headers: remote.merge("Authorization" => "Bearer #{admin_token}"), as: :json
      temp = response.parsed_body["temp_password"]

      post "/auth/login", params: { user: { email: member_pw.email, password: temp } }, as: :json
      expect(response).to have_http_status(:ok)
    end

    it "returns 403 for a member caller" do
      member_pw = create(:user, password: "password123")
      target = create(:user)
      member_token = login(member_pw)

      post "/api/v1/admin/users/#{target.id}/reset_password",
        headers: remote.merge("Authorization" => "Bearer #{member_token}"), as: :json
      expect(response).to have_http_status(:forbidden)
    end
  end
end
