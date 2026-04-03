FactoryBot.define do
  factory :meeting_template do
    user
    sequence(:name) { |n| "Template #{n}" }
    meeting_type { "general" }
    settings_json { { language: "ko", diarization: true } }
  end
end
