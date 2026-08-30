FactoryBot.define do
  factory :api_token do
    association :user
    sequence(:name) { |n| "Token #{n}" }
    scopes { %w[meetings:read] }
    expires_at { 30.days.from_now }
    token_digest { SecureRandom.hex(32) } # issue!를 거치지 않는 팩토리 기본값 — 유일성만 필요
    token_prefix { "ddbk_test123" }
  end
end
