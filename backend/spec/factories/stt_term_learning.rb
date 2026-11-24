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
    # 여러 건 만들어도 (project, wrong_key, correct_key) 유니크에 걸리지 않게 시퀀스. key 는 표기에서 파생.
    sequence(:wrong) { |n| "우판#{n}" }
    sequence(:correct) { |n| "후판#{n}" }
    wrong_key { DomainFile.normalize_key(wrong) }
    correct_key { DomainFile.normalize_key(correct) }
    status { "undecided" }
    hit_count { 0 }
  end
end
