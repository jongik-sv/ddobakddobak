module MeetingWriteGuard
  extend ActiveSupport::Concern

  private

  # 잠긴(locked) 회의에 대한 모든 변조(mutate) 요청을 403으로 차단한다.
  # 대상 회의는 컨트롤러가 정의한 locked_meeting(자식-id 스코프) 또는 @meeting(회의 스코프).
  # 회의가 없거나 잠기지 않았으면 통과한다. (set_meeting/authorize 다음 before_action으로 배선)
  def reject_if_locked!
    meeting = respond_to?(:locked_meeting, true) ? locked_meeting : @meeting
    return if meeting.nil? || !meeting.locked?

    render json: { error: "잠긴 회의입니다. 잠금을 해제한 뒤 다시 시도하세요." }, status: :forbidden
  end
end
