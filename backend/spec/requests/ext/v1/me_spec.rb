require "rails_helper"

RSpec.describe "GET /api/ext/v1/me", type: :request do
  let(:user) { create(:user) }

  def issue_token(**attrs)
    ApiToken.issue!(
      user: user, name: "테스트", scopes: %w[meetings:read], expires_at: 1.day.from_now, **attrs
    )
  end

  it "Authorization 헤더가 없으면 401" do
    get "/api/ext/v1/me"
    expect(response).to have_http_status(:unauthorized)
    expect(response.parsed_body["error"]["code"]).to eq("unauthorized")
  end

  it "무효한 토큰이면 401" do
    get "/api/ext/v1/me", headers: { "Authorization" => "Bearer ddbk_#{'x' * 43}" }
    expect(response).to have_http_status(:unauthorized)
  end

  it "만료된 토큰이면 401" do
    token, plaintext = issue_token
    token.update_column(:expires_at, 1.hour.ago)
    get "/api/ext/v1/me", headers: { "Authorization" => "Bearer #{plaintext}" }
    expect(response).to have_http_status(:unauthorized)
  end

  it "폐기된 토큰이면 401" do
    token, plaintext = issue_token
    token.revoke!
    get "/api/ext/v1/me", headers: { "Authorization" => "Bearer #{plaintext}" }
    expect(response).to have_http_status(:unauthorized)
  end

  it "정상 토큰이면 200 + 토큰/사용자 정보 + 감사 로그" do
    _token, plaintext = issue_token
    expect {
      get "/api/ext/v1/me", headers: { "Authorization" => "Bearer #{plaintext}" }
    }.to change(ApiTokenAuditLog, :count).by(1)

    expect(response).to have_http_status(:ok)
    body = response.parsed_body
    expect(body["token"]["scopes"]).to eq(%w[meetings:read])
    expect(body["user"]["id"]).to eq(user.id)
    expect(body["user"]["email"]).to eq(user.email)

    log = ApiTokenAuditLog.last
    expect(log.action).to eq("me.show")
    expect(log.path).to eq("/api/ext/v1/me")
  end

  it "last_used_at을 갱신한다" do
    token, plaintext = issue_token
    expect(token.last_used_at).to be_nil
    get "/api/ext/v1/me", headers: { "Authorization" => "Bearer #{plaintext}" }
    expect(token.reload.last_used_at).to be_present
  end
end
