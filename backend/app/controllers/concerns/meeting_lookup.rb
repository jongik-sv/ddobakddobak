module MeetingLookup
  extend ActiveSupport::Concern

  private

  def set_meeting
    @meeting = Meeting.find(params[:meeting_id] || params[:id])
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Meeting not found" }, status: :not_found
  else
    authorize_meeting_read!
  end

  # 읽기 인가: admin / 소유자 / 공유(shared) 회의 / active participant 만 허용
  def authorize_meeting_read!
    return if meeting_admin?
    return if @meeting.owner?(current_user)
    # shared=true 회의는 임의의 로그인 사용자가 열람 가능
    return if @meeting.shared?
    # 떠난 참여자(left_at 설정)는 제외 — 재접근하려면 공유코드로 다시 참여해야 함
    return if @meeting.active_participants.exists?(user_id: current_user.id)

    render json: { error: "이 회의에 접근할 권한이 없습니다" }, status: :forbidden
  end

  # 제어 인가: admin / 소유자 / 현재 host participant 만 허용
  def authorize_meeting_control!
    return if meeting_admin?
    return if @meeting.owner?(current_user)
    return if @meeting.host_participant&.user_id == current_user.id

    render json: { error: "회의를 제어할 권한이 없습니다" }, status: :forbidden
  end

  def meeting_admin?
    current_user.respond_to?(:admin?) && current_user.admin?
  end
end
