FactoryBot.define do
  factory :team do
    sequence(:name) { |n| "Team #{n}" }
    association :creator, factory: :user
  end
end
