module MeetingLookup
  extend ActiveSupport::Concern

  private

  def set_meeting
    @meeting = Meeting.find(params[:meeting_id] || params[:id])
    authorize_meeting_read!
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Meeting not found" }, status: :not_found
  end

  # 읽기 인가: admin / 소유자 / active participant 만 허용
  def authorize_meeting_read!
    return if meeting_admin?
    return if @meeting.owner?(current_user)
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
