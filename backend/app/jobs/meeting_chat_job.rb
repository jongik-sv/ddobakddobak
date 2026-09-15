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
    # 챗 저장 경로에도 인용 마커 정규화를 적용한다 — 요약 저장(LlmService#refine_notes)만
    # normalize를 타고 챗은 안 타서 실서버 챗 마커 106건(밀리초 접미사·구분자 소실 등)이 방치된
    # 결함 수정. 스트리밍 중 부분 저장(ChatStreaming#stream_answer 의 update_column)은 이 최종
    # update! 이전 별도 경로라 여기 정규화를 거치지 않는다 — 아직 닫히지 않은 마커 델타를
    # 성급히 지우는 사고 없이, 완결된 답변 전체에 대해서만 1회 적용된다.
    content = LlmPrompts::CitationMarkers.normalize(content)
    # suggestions(후속 질문)는 시스템 프롬프트가 마커 삽입을 지시하지 않는 순수 질문 문장이라
    # 위험은 낮지만, LLM이 답변 본문의 마커 습관을 후속 질문에도 새어들일 가능성을 방어한다.
    # normalize는 '⟦'가 없는 일반 텍스트에는 무변형이라 비용이 없다.
    suggestions = suggestions.map { |s| LlmPrompts::CitationMarkers.normalize(s) }
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
