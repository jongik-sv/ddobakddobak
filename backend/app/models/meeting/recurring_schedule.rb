# 반복 예약 회의(recurrence_rule) 관련 동작. app/services/recurrence.rb(순수 계산 모듈)와
# 이름이 겹치면 위험해(Meeting 네임스페이스 하위 상수가 bare `Recurrence` 조회를 가로챌 수 있음)
# 의도적으로 RecurringSchedule 로 이름을 다르게 둔다.
module Meeting::RecurringSchedule
  extend ActiveSupport::Concern

  # 반복 예약 회의 여부. recurrence_rule(JSON)이 있으면 반복 시리즈.
  def recurring?
    recurrence_rule.present?
  end

  # recurrence_rule(JSON 텍스트)을 파싱한 해시. 비반복/파싱불가면 nil.
  def parsed_recurrence_rule
    return nil if recurrence_rule.blank?
    JSON.parse(recurrence_rule)
  rescue JSON::ParserError
    nil
  end

  # 반복 시리즈의 다음 occurrence(미래) pending 회의를 복제 생성한다.
  # - 비반복이면 no-op(nil).
  # - 멱등: 이미 이 회의를 시드로 한 예약(scheduled) successor 가 있으면 중복 생성하지 않는다.
  # - 다음 occurrence 가 없으면(규칙 불완전 등) no-op(nil).
  # title/유형/폴더/프로젝트/공유/중요/모드/규칙·요약옵션만 승계하고, started_at·ended_at·locked_at·
  # 오디오·dismiss 같은 상태 필드는 깨끗하게 둔다(새 pending 회의). previous_meeting_id 로 체이닝해
  # "이전 회의 참고" 시드가 시리즈를 따라 이어진다.
  # 중요(important)는 원본값을 명시 승계한다 — important_explicitly_set=true 로 표시해
  # before_create :seed_importance_from_folder 가 폴더값으로 덮어쓰지 않게 한다(컨트롤러
  # apply_explicit_importance! 와 동일 패턴). 그래야 중요한 반복 시리즈의 후속 occurrence 가
  # important=true 를 유지해 기본(important 필터) 회의 목록에서 사라지지 않는다.
  def materialize_next_occurrence!
    return unless recurring?
    # 이미 미래 형제(이 회의를 시드로 한 예약 successor)가 있으면 중복 방지(every-minute 롤오버 멱등).
    return if Meeting.where(previous_meeting_id: id).scheduled.exists?

    next_time = Recurrence.next_occurrence(parsed_recurrence_rule, after: Time.current)
    return if next_time.nil?

    successor = Meeting.new(
      title: title,
      meeting_type: meeting_type,
      folder_id: folder_id,
      project_id: project_id,
      shared: shared,
      important: important,
      created_by_id: created_by_id,
      summary_verbosity: summary_verbosity,
      summary_restructure: summary_restructure,
      summary_custom_prompt: summary_custom_prompt,
      auto_start_mode: auto_start_mode,
      recurrence_rule: recurrence_rule,
      previous_meeting_id: id,
      scheduled_start_time: next_time
    )
    successor.important_explicitly_set = true # 폴더값 override 방지(중요 플래그 명시 승계)
    successor.save!
    successor
  end
end
