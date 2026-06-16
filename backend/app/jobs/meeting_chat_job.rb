class MeetingChatJob < ApplicationJob
  queue_as :default

  def perform(assistant_message_id)
    answer = ChatMessage.find_by(id: assistant_message_id)
    return unless answer

    meeting = answer.meeting
    user = answer.user
    question = meeting.chat_messages.for_user(user).where(role: "user")
                      .where("created_at <= ?", answer.created_at).order(:created_at).last

    ctx = MeetingChatContext.build(meeting: meeting, user: user, question: question&.content.to_s)
    config = meeting.creator&.effective_llm_config
    raise "이 회의의 LLM이 설정되어 있지 않습니다." if config.blank?

    text = LlmService.new(llm_config: config).answer_question(ctx[:system_prompt], ctx[:user_content])
    answer.update!(content: text.to_s, status: "complete")
  rescue => e
    answer&.update(status: "error", error_message: e.message)
  ensure
    broadcast(answer) if answer
  end

  private

  def broadcast(msg)
    ActionCable.server.broadcast(
      "meeting_#{msg.meeting_id}_chat_#{msg.user_id}",
      { type: "chat_message_update", id: msg.id, role: msg.role,
        content: msg.content, status: msg.status,
        error_message: msg.error_message, created_at: msg.created_at }
    )
  end
end
