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

  # 읽기 인가: admin / 소유자 / (프로젝트 멤버 && 공유) / active participant(공유코드 게스트) 만 허용.
  # 공유 가시성은 이제 프로젝트 멤버십 뒤에 게이트된다 — 비멤버는 shared 회의라도 못 본다(프로젝트 격리).
  def authorize_meeting_read!
    return if meeting_admin?
    return if @meeting.owner?(current_user)
    # shared=true 회의는 같은 프로젝트 멤버에게만(폴더 비공개면 shared_visible?가 가림). 비멤버 차단.
    return if project_member?(@meeting) && @meeting.shared_visible?
    # 떠난 참여자(left_at 설정)는 제외 — 재접근하려면 공유코드로 다시 참여해야 함.
    # 공유코드 게스트는 멤버십과 무관하게 READ 만 허용(외부 공유 링크 경로 유지).
    return if @meeting.active_participants.exists?(user_id: current_user.id)

    render json: { error: "이 회의에 접근할 권한이 없습니다" }, status: :forbidden
  end

  # 제어 인가: admin / 소유자 / (프로젝트 멤버 && 현재 host participant) 만 허용.
  # 게스트(비멤버)는 host 라도 제어 불가 — 제어는 멤버십 뒤에 게이트된다.
  def authorize_meeting_control!
    return if meeting_admin?
    return if @meeting.owner?(current_user)
    # host 제어도 프로젝트 멤버 한정 — 공유코드 게스트(비멤버)는 host라도 제어 불가.
    return if project_member?(@meeting) && @meeting.host_participant&.user_id == current_user.id

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
