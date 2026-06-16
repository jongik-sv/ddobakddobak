FactoryBot.define do
  factory :meeting do
    sequence(:title) { |n| "Meeting #{n}" }
    status { "pending" }
    association :project
    association :creator, factory: :user

    # 목록은 important=true 만 노출. 프로덕션 백필로 기존 회의는 전부 true 이고
    # 기존 테스트는 "만든 회의가 목록에 보인다"를 전제하므로 팩토리 기본을 true 로 둔다.
    # important_explicitly_set=true 를 켜야 before_create :seed_importance_from_folder 가
    # 폴더값으로 덮어쓰지 않고 지정값(important: ...)을 보존한다.
    important { true }
    important_explicitly_set { true }

    trait :private_meeting do
      shared { false }
    end
  end
end
