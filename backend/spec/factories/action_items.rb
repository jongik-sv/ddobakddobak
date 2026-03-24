FactoryBot.define do
  factory :action_item do
    association :meeting
    content { "Do something" }
    ai_generated { false }
    status { "todo" }

    trait :with_assignee do
      association :assignee, factory: :user
    end
  end
end
