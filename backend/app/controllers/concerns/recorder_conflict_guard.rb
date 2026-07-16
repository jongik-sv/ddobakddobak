# 단일 녹음 기기 락: 한 회의의 녹음 제어(시작/일시정지/재개/종료/청크 업로드)는 점유 기기
# (meetings.recording_client_id == X-Client-Id)에서만 허용한다. 강제 탈취 경로는 없다 —
# admin 이라도 다른 기기면 거부(정책: 모든 사람에 대해 한 회의는 단 하나의 기기).
module RecorderConflictGuard
  extend ActiveSupport::Concern

  private

  # before_action 가드. @meeting 이 recording 이고 요청 기기가 점유 기기와 다르면:
  # - 점유 하트비트가 stale(90s 초과)이면 자가복구(heal_stale_recording!)로 락을 풀고 통과
  #   — 이후의 상태 검사가 기존 의미(예: completed 라 422)로 응답한다.
  # - 신선하면 409(recorder_conflict). X-Client-Id 미전송(nil)도 점유 기기와 다르므로 거부.
  # recording_client_id 가 nil 인 레거시 recording 회의는 통과(기존 동작 유지).
  def reject_if_recorder_conflict!
    return unless @meeting&.recording?
    return unless recorder_conflict?(@meeting)

    if @meeting.stale_recording?
      @meeting.heal_stale_recording!
      return
    end

    render_recorder_conflict
  end

  # 다른 기기 점유 여부. 점유 id 부재(레거시)면 충돌 아님.
  def recorder_conflict?(meeting)
    meeting.recording_client_id.present? && meeting.recording_client_id != current_client_id
  end

  # 409 본문은 프론트와의 계약 — code 로 분기하고 error 를 그대로 토스트에 쓴다.
  def render_recorder_conflict
    render json: { error: "다른 기기에서 녹음이 진행 중입니다.", code: "recorder_conflict" }, status: :conflict
  end
end
