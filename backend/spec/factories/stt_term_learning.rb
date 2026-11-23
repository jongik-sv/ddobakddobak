FactoryBot.define do
  factory :stt_term_learning_run do
    association :meeting
    trigger { "idle" }
    status { "queued" }
  end

  factory :stt_term_learning_item do
    association :run, factory: :stt_term_learning_run
    wrong { "우판" }
    correct { "후판" }
    wrong_key { "우판" }
    correct_key { "후판" }
    source { "llm_diff" }
    verdict { "registered" }
  end

  factory :stt_misrecognition do
    association :project
    wrong { "우판" }
    correct { "후판" }
    wrong_key { "우판" }
    correct_key { "후판" }
    status { "undecided" }
    hit_count { 0 }
  end
end
