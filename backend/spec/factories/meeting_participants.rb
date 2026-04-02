FactoryBot.define do
  factory :meeting_participant do
    association :meeting
    association :user
    role { "viewer" }
    joined_at { Time.current }
    left_at { nil }

    trait :host do
      role { "host" }
    end

    trait :left do
      left_at { Time.current }
    end
  end
end
