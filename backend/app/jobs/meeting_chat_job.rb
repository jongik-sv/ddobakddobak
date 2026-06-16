class MeetingChatJob < ApplicationJob
  queue_as :default

  FOLLOWUPS_SENTINEL = "<<<FOLLOWUPS>>>".freeze

  def perform(assistant_message_id)
    answer = ChatMessage.find_by(id: assistant_message_id)
    return unless answer

    meeting = answer.meeting
    user = answer.user
    question = meeting.chat_messages.for_user(user).where(role: "user")
                      .where("created_at <= ?", answer.created_at).order(:created_at).last

    ctx = MeetingChatContext.build(meeting: meeting, user: user, question: question&.content.to_s)
    config = meeting.creator&.effective_chat_llm_config
    raise "이 회의의 LLM이 설정되어 있지 않습니다." if config.blank?

    raw = LlmService.new(llm_config: config).answer_question(ctx[:system_prompt], ctx[:user_content])
    content, suggestions = split_followups(raw.to_s)
    answer.update!(content: content, suggestions: suggestions, status: "complete")
  rescue => e
    answer&.update(status: "error", error_message: e.message)
  ensure
    broadcast(answer) if answer
  end

  private

  # 답변 원문에서 센티넬 뒤의 예상질문 JSON 배열을 분리한다.
  # 센티넬 없음·JSON 파싱 실패 시 원문 전체를 답변으로, suggestions 는 빈 배열로 폴백(graceful).
  def split_followups(raw)
    return [raw.strip, []] unless raw.include?(FOLLOWUPS_SENTINEL)

    body, _, tail = raw.partition(FOLLOWUPS_SENTINEL)
    parsed = JSON.parse(tail.strip)
    suggestions = parsed.is_a?(Array) ? parsed.first(3).map(&:to_s) : []
    [body.strip, suggestions]
  rescue JSON::ParserError
    [body.to_s.strip, []]
  end

  def broadcast(msg)
    ActionCable.server.broadcast(
      "meeting_#{msg.meeting_id}_chat_#{msg.user_id}",
      { type: "chat_message_update", id: msg.id, role: msg.role,
        content: msg.content, status: msg.status,
        suggestions: msg.suggestions,
        error_message: msg.error_message, created_at: msg.created_at }
    )
  end
end
