FactoryBot.define do
  factory :domain_file do
    sequence(:name) { |n| "도메인 파일 #{n}" }
    content { "" }
    association :creator, factory: :user

    trait :with_project do
      association :project
    end
  end
end
