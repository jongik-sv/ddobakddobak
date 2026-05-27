require "rails_helper"

RSpec.describe "Api::V1::User::Passwords", type: :request do
  include_context "server mode"
  let(:remote) { { "REMOTE_ADDR" => "192.168.1.50" } }
  let(:member) { create(:user, password: "password123") }

  def login(user, password = "password123")
    post "/auth/login", params: { user: { email: user.email, password: password } }, as: :json
    response.parsed_body["access_token"]
  end

  it "changes password, reissues working tokens, rejects the old token" do
    token = login(member)

    patch "/api/v1/user/password",
      params: { current_password: "password123", new_password: "newpassword456", new_password_confirmation: "newpassword456" },
      headers: remote.merge("Authorization" => "Bearer #{token}"), as: :json

    expect(response).to have_http_status(:ok)
    new_access = response.parsed_body["access_token"]
    expect(new_access).to be_present
    expect(response.parsed_body["refresh_token"]).to be_present

    get "/api/v1/meetings", headers: remote.merge("Authorization" => "Bearer #{token}"), as: :json
    expect(response).to have_http_status(:unauthorized)

    get "/api/v1/meetings", headers: remote.merge("Authorization" => "Bearer #{new_access}"), as: :json
    expect(response).to have_http_status(:ok)

    post "/auth/login", params: { user: { email: member.email, password: "newpassword456" } }, as: :json
    expect(response).to have_http_status(:ok)
  end

  it "returns 422 when current password is wrong" do
    token = login(member)
    patch "/api/v1/user/password",
      params: { current_password: "wrongpass", new_password: "newpassword456", new_password_confirmation: "newpassword456" },
      headers: remote.merge("Authorization" => "Bearer #{token}"), as: :json
    expect(response).to have_http_status(:unprocessable_entity)
  end

  it "returns 422 when confirmation does not match" do
    token = login(member)
    patch "/api/v1/user/password",
      params: { current_password: "password123", new_password: "newpassword456", new_password_confirmation: "different789" },
      headers: remote.merge("Authorization" => "Bearer #{token}"), as: :json
    expect(response).to have_http_status(:unprocessable_entity)
  end

  it "returns 422 with model errors when the new password is too short" do
    token = login(member)
    patch "/api/v1/user/password",
      params: { current_password: "password123", new_password: "abc", new_password_confirmation: "abc" },
      headers: remote.merge("Authorization" => "Bearer #{token}"), as: :json
    expect(response).to have_http_status(:unprocessable_entity)
    expect(response.parsed_body["errors"]).to be_present
  end

  it "returns 403 for the local account (loopback, no JWT)" do
    patch "/api/v1/user/password",
      params: { current_password: "x", new_password: "newpassword456", new_password_confirmation: "newpassword456" },
      headers: { "REMOTE_ADDR" => "127.0.0.1" }, as: :json
    expect(response).to have_http_status(:forbidden)
  end
end
