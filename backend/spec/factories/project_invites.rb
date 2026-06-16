FactoryBot.define do
  factory :project_invite do
    association :project
    association :creator, factory: :user
    sequence(:code) { |n| format("c%05d", n)[0, 6] }
  end
end
