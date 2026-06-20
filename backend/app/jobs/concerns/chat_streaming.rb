# 챗 잡 공통 스트리밍: LlmService 델타를 스로틀하며 assistant 메시지에 누적·broadcast.
# 포함 잡은 broadcast_topic(answer) 를 구현해야 한다.
module ChatStreaming
  THROTTLE_MS = 150
  THROTTLE_CHARS = 80

  private

  def stream_answer(answer, config, system_prompt, user_content, model_name)
    buffer = +""
    last_flush = now_ms
    last_len = 0

    full = LlmService.new(llm_config: config).answer_question(system_prompt, user_content) do |delta|
      buffer << delta
      if (now_ms - last_flush) >= THROTTLE_MS || (buffer.length - last_len) >= THROTTLE_CHARS
        answer.update_column(:content, buffer)
        answer.status = "streaming"
        broadcast_chat(answer, model_name: model_name)
        last_flush = now_ms
        last_len = buffer.length
      end
    end
    # 마지막 미플러시 델타가 있으면 최종 DB 반영
    answer.update_column(:content, buffer) if buffer.length > last_len
    full.to_s
  end

  def broadcast_chat(answer, model_name:)
    ActionCable.server.broadcast(
      broadcast_topic(answer),
      { type: "chat_message_update", id: answer.id, role: answer.role,
        content: answer.content, status: answer.status,
        suggestions: answer.suggestions, model_name: model_name,
        error_message: answer.error_message, created_at: answer.created_at }
    )
  end

  def now_ms
    Process.clock_gettime(Process::CLOCK_MONOTONIC) * 1000
  end
end
