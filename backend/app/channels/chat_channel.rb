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
  def scope_readable?(project)
    return false unless project
    return true if current_user.respond_to?(:admin?) && current_user.admin?

    project.member?(current_user)
  end

  # MeetingLookup#authorize_meeting_read! 와 동일 규칙:
  # admin / 소유자(created_by_id) / 공유 가시(shared_visible?) / active participant.
  # 채널엔 controller 헬퍼가 없으므로 모델 메서드로 동일 판정을 표현한다.
  def meeting_readable?(meeting)
    return true if current_user.respond_to?(:admin?) && current_user.admin?
    return true if meeting.owner?(current_user)
    return true if meeting.shared_visible?

    meeting.active_participants.exists?(user_id: current_user.id)
  end
end
