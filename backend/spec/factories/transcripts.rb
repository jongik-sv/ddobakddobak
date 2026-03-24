FactoryBot.define do
  factory :transcript do
    sequence(:content) { |n| "Transcript content #{n}" }
    speaker_label { "SPEAKER_00" }
    started_at_ms { 0 }
    ended_at_ms { 3000 }
    sequence(:sequence_number) { |n| n }
    association :meeting
  end
end
