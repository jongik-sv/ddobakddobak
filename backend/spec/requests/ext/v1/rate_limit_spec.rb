require "rails_helper"

# rack-attack 스로틀. test 환경 기본 cache_store는 :null_store(config/environments/test.rb)라
# 카운터가 누적되지 않으므로, 이 스펙에서만 명시적으로 메모리 스토어를 지정한다.
RSpec.describe "rack-attack /api/ext 스로틀", type: :request do
  let(:user) { create(:user) }

  around do |example|
    original_store = Rack::Attack.cache.store
    Rack::Attack.cache.store = ActiveSupport::Cache::MemoryStore.new
    Rack::Attack.enabled = true
    example.run
  ensure
    Rack::Attack.cache.store.clear
    Rack::Attack.cache.store = original_store
  end

  it "읽기 GET이 분당 120회를 초과하면 429" do
    _token, plaintext = ApiToken.issue!(
      user: user, name: "x", scopes: %w[meetings:read], expires_at: 1.day.from_now
    )
    headers = { "Authorization" => "Bearer #{plaintext}" }

    120.times do
      get "/api/ext/v1/me", headers: headers
      expect(response).to have_http_status(:ok)
    end

    get "/api/ext/v1/me", headers: headers
    expect(response).to have_http_status(:too_many_requests)
    expect(response.parsed_body["error"]["code"]).to eq("rate_limited")
  end

  it "/api/ext/ 바깥 경로는 스로틀 대상이 아니다" do
    121.times { get "/api/v1/health" }
    expect(response).not_to have_http_status(:too_many_requests)
  end
end
