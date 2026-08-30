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

  # 수정 라운드 1 #2: 토큰별(digest) 버킷은 매 요청 무작위 Bearer 값으로 우회 가능하다
  # (버킷이 매번 분산돼 한도에 도달하지 않음). IP 고정 버킷(300/분)이 그 우회를 잡는다.
  it "요청마다 다른 토큰을 써도 IP 고정 버킷(300/분)에는 걸린다 — 버킷 분산 우회 방지" do
    300.times do
      get "/api/ext/v1/me", headers: { "Authorization" => "Bearer ddbk_#{SecureRandom.alphanumeric(43)}" }
      expect(response).to have_http_status(:unauthorized)
    end

    get "/api/ext/v1/me", headers: { "Authorization" => "Bearer ddbk_#{SecureRandom.alphanumeric(43)}" }
    expect(response).to have_http_status(:too_many_requests)
  end

  # 수정 라운드 1 #2: HEAD가 쓰기 버킷(20/분)으로 잘못 분류되던 문제 회귀 방지.
  it "HEAD 요청은 읽기 버킷(120/분)으로 취급된다(쓰기 버킷 20/분이 아니다)" do
    _token, plaintext = ApiToken.issue!(
      user: user, name: "x", scopes: %w[meetings:read], expires_at: 1.day.from_now
    )
    headers = { "Authorization" => "Bearer #{plaintext}" }

    25.times { head "/api/ext/v1/me", headers: headers }
    expect(response).not_to have_http_status(:too_many_requests)
  end
end
