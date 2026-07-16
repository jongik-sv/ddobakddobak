module MeetingLookup
  extend ActiveSupport::Concern

  private

  def set_meeting
    @meeting = Meeting.find(params[:meeting_id] || params[:id])
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Meeting not found" }, status: :not_found
  else
    # 휴지통(소프트 삭제)된 회의는 일반 경로에서 존재하지 않는 것으로 취급(404).
    return render(json: { error: "Meeting not found" }, status: :not_found) if @meeting.trashed?
    authorize_meeting_read!
  end

  # 읽기 인가: admin / 소유자 / (프로젝트 멤버 && 공유) 만 허용.
  # 공유 가시성은 프로젝트 멤버십 뒤에 게이트된다 — 비멤버는 shared 회의라도 못 본다(프로젝트 격리).
  def authorize_meeting_read!
    return if meeting_admin?
    return if @meeting.owner?(current_user)
    # shared=true 회의는 같은 프로젝트 멤버에게만(폴더 비공개면 shared_visible?가 가림). 비멤버 차단.
    return if project_member?(@meeting) && @meeting.shared_visible?

    render json: { error: "이 회의에 접근할 권한이 없습니다" }, status: :forbidden
  end

  # 제어 인가: admin / 소유자만 허용. 공유 가시성 멤버는 읽기 전용 — 제어 불가.
  def authorize_meeting_control!
    return if meeting_admin?
    return if @meeting.owner?(current_user)

    render json: { error: "회의를 제어할 권한이 없습니다" }, status: :forbidden
  end

  # 현재 사용자가 이 회의의 프로젝트 멤버인지. project_id 없으면 false(과도기 안전).
  def project_member?(meeting)
    meeting.project_id && ProjectMembership.exists?(project_id: meeting.project_id, user_id: current_user.id)
  end

  def meeting_admin?
    current_user.respond_to?(:admin?) && current_user.admin?
  end
end
