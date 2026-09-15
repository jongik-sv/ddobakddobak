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
    content = LlmService::TextFormatter.fix_mermaid_quotes(content)
    # 챗 저장 경로에도 인용 마커 정규화를 적용한다 — MeetingChatJob과 동일 사유(요약만 normalize를
    # 타고 챗은 안 타서 실서버 챗 마커 106건이 방치됐던 결함). 폴더 챗은 ⟦m:<회의id>/t:..⟧
    # 형태를 쓰므로 FOLDER_CITATION_FULL_RE 경로로 정상 복구·검증된다(citation_markers_spec 참고).
    # 스트리밍 부분 저장(ChatStreaming#stream_answer)은 이 최종 update! 이전 별도 경로라 안 거친다.
    content = LlmPrompts::CitationMarkers.normalize(content)
    # suggestions(후속 질문) 방어 적용 사유는 MeetingChatJob과 동일 — normalize는 마커 없는
    # 일반 텍스트에 무변형이라 비용 없이 방어할 수 있다.
    suggestions = suggestions.map { |s| LlmPrompts::CitationMarkers.normalize(s) }
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
