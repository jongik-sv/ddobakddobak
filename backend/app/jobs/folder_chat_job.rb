class FolderChatJob < ApplicationJob
  include ChatFollowups
  queue_as :default

  def perform(assistant_message_id)
    answer = ChatMessage.find_by(id: assistant_message_id)
    return unless answer

    user = answer.user
    question = ChatMessage.for_scope(answer.scope_type, answer.scope_id).for_user(user)
                          .where(role: "user").where("created_at <= ?", answer.created_at)
                          .order(:created_at).last

    keywords = FolderChatKeywords.extract(question&.content.to_s, user: user)
    ctx = FolderChatContext.build(scope_type: answer.scope_type, scope_id: answer.scope_id, user: user, keywords: keywords)

    config = user.effective_chat_llm_config
    raise "LLM이 설정되어 있지 않습니다." if config.blank?

    raw = LlmService.new(llm_config: config).answer_question(ctx[:system_prompt], ctx[:user_content])
    content, suggestions = split_followups(raw.to_s)
    answer.update!(content: content, suggestions: suggestions, status: "complete")
  rescue => e
    answer&.update(status: "error", error_message: e.message)
  ensure
    broadcast(answer) if answer
  end

  private

  def broadcast(msg)
    ActionCable.server.broadcast(
      "chat_#{msg.scope_type}_#{msg.scope_id}_#{msg.user_id}",
      { type: "chat_message_update", id: msg.id, role: msg.role,
        content: msg.content, status: msg.status,
        suggestions: msg.suggestions,
        error_message: msg.error_message, created_at: msg.created_at }
    )
  end
end
