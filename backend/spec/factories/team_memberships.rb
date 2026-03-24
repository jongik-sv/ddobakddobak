FactoryBot.define do
  factory :team_membership do
    association :user
    association :team
    role { "member" }
  end
end
