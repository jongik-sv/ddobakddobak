class MeetingChatJob < ApplicationJob
  include ChatFollowups
  include ChatStreaming
  queue_as :default

  def perform(assistant_message_id)
    answer = ChatMessage.find_by(id: assistant_message_id)
    return unless answer

    meeting = answer.meeting
    user = answer.user
    question = meeting.chat_messages.for_user(user).where(role: "user")
                      .where("created_at <= ?", answer.created_at).order(:created_at).last

    ctx = MeetingChatContext.build(meeting: meeting, user: user, question: question&.content.to_s)
    # 회의 챗도 질문자(answer.user) 본인의 개인 챗 LLM 설정을 쓴다 — 폴더 챗(FolderChatJob)과 동일.
    # (이전엔 meeting.creator 설정을 써서, 남이 만든 회의에서 챗하면 참가자 개인 모델이 무시됐다.)
    # 개인 설정이 없으면 effective_chat_llm_config 가 서버 기본으로 폴백한다.
    config = user&.effective_chat_llm_config
    raise "LLM이 설정되어 있지 않습니다." if config.blank?

    model_name = LlmModelName.humanize(config[:model])
    raw = stream_answer(answer, config, ctx[:system_prompt], ctx[:user_content], model_name)
    content, suggestions = split_followups(raw)
    content = LlmService::TextFormatter.fix_mermaid_quotes(content)
    answer.update!(content: content, suggestions: suggestions, model_name: model_name, status: "complete")
  rescue => e
    answer&.update(status: "error", error_message: e.message)
  ensure
    broadcast(answer) if answer
  end

  private

  def broadcast_topic(msg)
    "meeting_#{msg.meeting_id}_chat_#{msg.user_id}"
  end

  def broadcast(msg)
    broadcast_chat(msg, model_name: msg.model_name)
  end
end
