FactoryBot.define do
  factory :meeting do
    sequence(:title) { |n| "Meeting #{n}" }
    status { "pending" }
    association :team
    association :creator, factory: :user
  end
end
