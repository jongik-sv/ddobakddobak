FactoryBot.define do
  factory :decision do
    association :meeting
    content { "프로젝트 일정을 2주 연장하기로 결정" }
    status { "active" }
    ai_generated { false }

    trait :with_context do
      context { "리소스 부족으로 인해 일정 조정 필요" }
    end

    trait :ai do
      ai_generated { true }
    end
  end
end
