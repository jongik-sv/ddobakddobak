class FolderChatJob < ApplicationJob
  include ChatFollowups
  include ChatStreaming
  queue_as :default

  def perform(assistant_message_id)
    answer = ChatMessage.find_by(id: assistant_message_id)
    return unless answer

    user = answer.user
    question = ChatMessage.for_scope(answer.scope_type, answer.scope_id).for_user(user)
                          .where(role: "user").where("created_at <= ?", answer.created_at)
                          .order(:created_at).last

    expansion = FolderChatQueryExpansion.expand(question&.content.to_s, user: user)
    ctx = FolderChatContext.build(scope_type: answer.scope_type, scope_id: answer.scope_id, user: user,
                                  keywords: expansion.keywords, expansions: expansion.expansions, query_text: question&.content)

    config = user.effective_chat_llm_config
    raise "LLM이 설정되어 있지 않습니다." if config.blank?

    model_name = LlmModelName.humanize(config[:model])
    raw = stream_answer(answer, config, ctx[:system_prompt], ctx[:user_content], model_name)
    content, suggestions = split_followups(raw)
    answer.update!(content: content, suggestions: suggestions, model_name: model_name, status: "complete")
  rescue => e
    answer&.update(status: "error", error_message: e.message)
  ensure
    broadcast(answer) if answer
  end

  private

  def broadcast_topic(msg)
    "chat_#{msg.scope_type}_#{msg.scope_id}_#{msg.user_id}"
  end

  def broadcast(msg)
    broadcast_chat(msg, model_name: msg.model_name)
  end
end
