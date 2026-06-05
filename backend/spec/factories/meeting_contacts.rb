FactoryBot.define do
  factory :meeting_contact do
    association :meeting
    name { "홍길동" }
    company { "또박" }
    created_by_id { meeting.created_by_id }
  end
end
