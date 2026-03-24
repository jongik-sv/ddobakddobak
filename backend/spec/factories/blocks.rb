FactoryBot.define do
  factory :block do
    block_type { "text" }
    content { "Sample block content" }
    sequence(:position) { |n| n * 1000.0 }
    association :meeting
    parent_block_id { nil }
  end
end
