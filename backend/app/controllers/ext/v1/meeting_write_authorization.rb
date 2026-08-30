# /api/ext/v1 쓰기 액션(meeting_writes, meeting_notes) 공통 인가·가드.
#
# 내부 API의 MeetingLookup#authorize_meeting_control!/#meeting_collaborator?/#meeting_admin!
# (app/controllers/concerns/meeting_lookup.rb)와 MeetingWriteGuard#reject_if_locked!/
# #reject_if_redacted!(app/controllers/concerns/meeting_write_guard.rb)의 의미론과 동치이되,
# 두 concern 모두 ApplicationController(current_user, before_action 렌더 관례)에 의존하므로
# 그대로 include할 수 없다 — PAT 인증 경로(Ext::V1::BaseController, current_api_user)에
# 맞춰 독립적으로 재구현한다. locked/redacted 응답은 내부 API와 status·문구가 다르다(§18) —
# ext API는 안정된 code로 재시도 가능 여부를 클라이언트가 판별해야 하므로 둘 다 409로 통일한다.
module Ext::V1::MeetingWriteAuthorization
  extend ActiveSupport::Concern

  LOCKED_ERROR_CODE = "meeting_locked".freeze
  REDACTED_ERROR_CODE = "meeting_redacted".freeze

  private

  # 대상 회의를 scoped_meetings(토큰 범위: ext_accessible_by ∩ project_ids ∩ folder_ids) 안에서
  # 찾고, 쓰기 티어(admin/소유자/협업자)인지 확인한다. 범위 밖·존재하지 않음은 404(존재 은폐 —
  # base_controller#render_not_found와 동일 원칙), 범위 안이지만 쓰기 티어가 아니면(예: "공유로만
  # 보이는" 프로젝트 멤버) 403.
  def set_writable_meeting!
    @meeting = scoped_meetings.find_by(id: params[:id])
    return render_not_found unless @meeting
    return if writable_meeting?(@meeting, current_api_user)

    render_error(:forbidden, "insufficient_permission", "이 회의를 수정할 권한이 없습니다")
  end

  # meeting_lookup.rb#authorize_meeting_control! 동치: admin(단 blocks_admin_override? 예외) /
  # 소유자 / 협업자(직접·폴더상속)만 허용. "공유 가시성" 멤버는 여기 포함되지 않는다(제어 불가).
  def writable_meeting?(meeting, user)
    ext_meeting_admin?(meeting, user) || meeting.owner?(user) || ext_meeting_collaborator?(meeting, user)
  end

  def ext_meeting_admin?(meeting, user)
    return false unless user.respond_to?(:admin?) && user.admin?
    !meeting.project&.blocks_admin_override?(user)
  end

  def ext_meeting_collaborator?(meeting, user)
    MeetingCollaborator.exists?(meeting_id: meeting.id, user_id: user.id) ||
      (meeting.folder&.collaborator?(user) || false)
  end

  # meeting_write_guard.rb#reject_if_locked! 동치(안정 code 부여).
  def reject_if_meeting_locked!
    return if @meeting.nil? || !@meeting.locked?

    render_error(:conflict, LOCKED_ERROR_CODE, "잠긴 회의입니다. 잠금을 해제한 뒤 다시 시도하세요.")
  end

  # meeting_write_guard.rb#reject_if_redacted! 동치(안정 code 부여).
  def reject_if_meeting_redacted!
    return if @meeting.nil? || @meeting.transcripts_redacted_at.nil?

    render_error(:conflict, REDACTED_ERROR_CODE, "기밀 절단이 적용된 회의입니다. 추가 처리를 받지 않습니다.")
  end
end
