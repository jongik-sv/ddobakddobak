FactoryBot.define do
  factory :summary do
    association :meeting
    summary_type { "realtime" }
    key_points { ["Point 1", "Point 2"].to_json }
    decisions { [].to_json }
    discussion_details { "Details".to_json }
    generated_at { Time.current }
  end
end
