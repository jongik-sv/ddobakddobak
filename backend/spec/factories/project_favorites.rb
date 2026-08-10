FactoryBot.define do
  factory :project_favorite do
    association :user
    association :project
  end
end
