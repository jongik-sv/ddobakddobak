FactoryBot.define do
  factory :project do
    sequence(:name) { |n| "Project #{n}" }
    association :creator, factory: :user
  end
end
