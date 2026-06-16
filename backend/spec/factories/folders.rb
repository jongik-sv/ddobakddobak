FactoryBot.define do
  factory :folder do
    sequence(:name) { |n| "Folder #{n}" }
    association :project
  end
end
