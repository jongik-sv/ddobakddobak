# 서버 모드 화이트보드 생성(design.md §11.4). claude CLI 직접 호출 → 보드 JSON 검증 → 저장 → broadcast.
class WhiteboardExportJob < ApplicationJob
  # claude 호출은 최대 6분 걸릴 수 있어 기본 큐를 점유하지 않도록 전용 큐(config/queue.yml: threads 1)를 쓴다.
  queue_as :whiteboard

  # run_token: 컨트롤러가 enqueue 때 발급한 실행 세대 토큰. row 의 토큰과 다르면(재enqueue로 대체됨) 즉시 종료하고,
  # 결과 쓰기는 토큰이 같을 때만 반영한다(CAS).
  def perform(meeting_id, digest, user_id = nil, run_token = nil)
    meeting = Meeting.find_by(id: meeting_id)
    return unless meeting

    wb = MeetingWhiteboard.find_by(meeting_id: meeting.id)
    return unless wb
    return if wb.run_token != run_token

    @wb_id = wb.id
    @run_token = run_token

    material = Whiteboard::Material.build(meeting)
    return fail!(meeting, Whiteboard::Failure::Result.new("unknown", "화이트보드를 만들지 못했습니다: AI 회의록이 없습니다")) unless material

    # 그사이 재요약되었으면 현재 material 의 digest 로 진행한다.
    current_digest = material.digest

    unless LlmService.claude_cli_available?
      return fail!(meeting, Whiteboard::Failure::Result.new("not_found", Whiteboard::Failure::MESSAGES["not_found"]))
    end

    board = generate_board(material)
    applied = cas_update(status: "done", digest: current_digest, prompt_version: Whiteboard::Prompt::PROMPT_VERSION,
                         board_json: board.to_json, error_kind: nil, error_message: nil)
    return unless applied

    ActionCable.server.broadcast(
      meeting.transcription_stream,
      { type: "whiteboard_ready", meeting_id: meeting.id, digest: current_digest }
    )
  rescue Whiteboard::OutputFailure => e
    fail!(meeting, e.result)
  rescue => e
    Rails.logger.error "[WhiteboardExportJob] meeting=#{meeting_id} error=#{e.class}: #{e.message}"
    fail!(meeting, Whiteboard::Failure.classify(e)) if meeting && @wb_id
  end

  private

  # 1회 재요청. exit 0 출력이 로그인/한도 안내면 재요청 없이 즉시 해당 kind 로 실패.
  def generate_board(material)
    base = Whiteboard::Prompt.user_content(material)
    output = run_claude(base)
    begin
      parse_output(output)
    rescue Whiteboard::ValidationError => e
      output = run_claude(base + Whiteboard::Prompt.retry_suffix(e.message))
      parse_output(output)
    end
  end

  def parse_output(output)
    Whiteboard::Board.parse_response(output)
  rescue Whiteboard::ValidationError
    classified = Whiteboard::Failure.classify_output(output)
    raise Whiteboard::OutputFailure.new(classified) if classified
    raise
  end

  def run_claude(user_content)
    LlmService.run_claude_whiteboard(
      system_prompt: Whiteboard::Prompt::SYSTEM_PROMPT, user_content: user_content, timeout: 180
    )
  end

  # id + run_token 이 모두 일치하는 row 만 갱신한다. 대체된 실행(토큰 불일치)이면 false.
  def cas_update(attrs)
    MeetingWhiteboard.where(id: @wb_id, run_token: @run_token).update_all(attrs.merge(updated_at: Time.current)) > 0
  end

  def fail!(meeting, result)
    return unless cas_update(status: "error", error_kind: result.kind, error_message: result.message)

    ActionCable.server.broadcast(
      meeting.transcription_stream,
      { type: "whiteboard_failed", meeting_id: meeting.id, error_kind: result.kind, message: result.message }
    )
  end
end
