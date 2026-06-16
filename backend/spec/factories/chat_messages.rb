FactoryBot.define do
  factory :chat_message do
    association :meeting
    association :user
    role { "user" }
    content { "이번 회의에서 결정된 게 뭐야?" }
    status { "complete" }
  end
end
