require "rails_helper"

RSpec.describe "Api::V1::Auth", type: :request do
  describe "POST /api/v1/signup" do
    let(:valid_params) do
      { email: "test@example.com", password: "password123", name: "Test User" }
    end

    context "with valid params" do
      it "creates a user and returns token" do
        post "/api/v1/signup", params: valid_params, as: :json

        expect(response).to have_http_status(:created)
        json = response.parsed_body
        expect(json["token"]).to be_present
        expect(json["user"]["email"]).to eq("test@example.com")
        expect(json["user"]["name"]).to eq("Test User")
        expect(json["user"]).not_to have_key("encrypted_password")
      end

      it "creates a user in the database" do
        expect {
          post "/api/v1/signup", params: valid_params, as: :json
        }.to change(User, :count).by(1)
      end
    end

    context "with invalid params" do
      it "returns 422 when email is blank" do
        post "/api/v1/signup", params: { email: "", password: "password123", name: "Test" }, as: :json
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "returns 422 when password is too short" do
        post "/api/v1/signup", params: { email: "test@example.com", password: "short", name: "Test" }, as: :json
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "returns 422 when email is already taken" do
        create(:user, email: "test@example.com")
        post "/api/v1/signup", params: valid_params, as: :json
        expect(response).to have_http_status(:unprocessable_entity)
      end
    end
  end

  describe "POST /api/v1/login" do
    let!(:user) { create(:user, email: "test@example.com", password: "password123") }

    context "with valid credentials" do
      it "returns token and user" do
        post "/api/v1/login", params: { email: "test@example.com", password: "password123" }, as: :json

        expect(response).to have_http_status(:ok)
        json = response.parsed_body
        expect(json["token"]).to be_present
        expect(json["user"]["email"]).to eq("test@example.com")
      end
    end

    context "with invalid credentials" do
      it "returns 401 for wrong password" do
        post "/api/v1/login", params: { email: "test@example.com", password: "wrongpassword" }, as: :json
        expect(response).to have_http_status(:unauthorized)
      end

      it "returns 401 for non-existent email" do
        post "/api/v1/login", params: { email: "nobody@example.com", password: "password123" }, as: :json
        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe "DELETE /api/v1/logout" do
    let(:user) { create(:user) }

    context "with valid token" do
      it "invalidates the token and returns 204" do
        token = login_token(user)
        old_jti = user.jti

        delete "/api/v1/logout", headers: auth_headers(token)

        expect(response).to have_http_status(:no_content)
        user.reload
        expect(user.jti).not_to eq(old_jti)
      end

      it "rejects subsequent requests with the old token" do
        token = login_token(user)
        delete "/api/v1/logout", headers: auth_headers(token)

        delete "/api/v1/logout", headers: auth_headers(token)
        expect(response).to have_http_status(:unauthorized)
      end
    end

    context "without token" do
      it "returns 401" do
        delete "/api/v1/logout"
        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  private

  def login_token(user)
    post "/api/v1/login", params: { email: user.email, password: "password123" }, as: :json
    response.parsed_body["token"]
  end

  def auth_headers(token)
    { "Authorization" => "Bearer #{token}" }
  end
end
