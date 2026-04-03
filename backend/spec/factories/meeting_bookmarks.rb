FactoryBot.define do
  factory :meeting_bookmark do
    association :meeting
    timestamp_ms { 5000 }
    label { "중요 구간" }
  end
end
