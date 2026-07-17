class ChatChannel < ApplicationCable::Channel
  def subscribed
    if params[:scope_type].present?
      subscribe_scope(params[:scope_type], params[:scope_id])
    else
      subscribe_meeting(params[:meeting_id])
    end
  end

  private

  def subscribe_meeting(meeting_id)
    meeting = Meeting.find_by(id: meeting_id)
    return reject unless meeting && meeting_readable?(meeting)

    stream_from "meeting_#{meeting.id}_chat_#{current_user.id}"
  end

  # scope(폴더/프로젝트) 구독. FolderChatJob 의 broadcast 대상
  # "chat_#{scope_type}_#{scope_id}_#{user_id}" 과 정확히 일치해야 한다.
  def subscribe_scope(scope_type, scope_id)
    project = case scope_type
    when "folder"  then Folder.find_by(id: scope_id)&.project
    when "project" then Project.find_by(id: scope_id)
    end
    return reject unless scope_readable?(project)

    stream_from "chat_#{scope_type}_#{scope_id.to_i}_#{current_user.id}"
  end

  # 컨트롤러(ScopedChatMessagesController#authorize_scope!)와 동일 규칙:
  # 전역 admin 또는 project.member? 만 허용. 비멤버는 거부.
  # admin override는 남의 개인 프로젝트(personal=true, 소유자 ≠ current_user)에는 적용되지 않는다.
  def scope_readable?(project)
    return false unless project
    return true if current_user.respond_to?(:admin?) && current_user.admin? && !project.blocks_admin_override?(current_user)

    project.member?(current_user)
  end

  # MeetingLookup#authorize_meeting_read! 와 동일 규칙:
  # admin / 소유자(created_by_id) / (프로젝트 멤버 && 공유 가시). 공유 가시성은 프로젝트
  # 멤버십 뒤에 게이트된다 — 비멤버는 shared 회의라도 못 본다(REST·transcription_channel 정합).
  # 채널엔 controller 헬퍼가 없으므로 모델 메서드로 동일 판정을 표현한다.
  # admin override는 남의 개인 프로젝트 소속 회의에는 적용되지 않는다(project_id 없으면 override 유지).
  def meeting_readable?(meeting)
    return true if current_user.respond_to?(:admin?) && current_user.admin? && !meeting.project&.blocks_admin_override?(current_user)
    return true if meeting.owner?(current_user)

    meeting.project&.member?(current_user) && meeting.shared_visible?
  end
end
