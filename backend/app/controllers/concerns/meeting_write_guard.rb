module MeetingWriteGuard
  extend ActiveSupport::Concern

  private

  # 잠긴(locked) 회의에 대한 모든 변조(mutate) 요청을 403으로 차단한다.
  # 대상 회의는 컨트롤러가 정의한 locked_meeting(자식-id 스코프) 또는 @meeting(회의 스코프).
  # 회의가 없거나 잠기지 않았으면 통과한다. (set_meeting/authorize 다음 before_action으로 배선)
  def reject_if_locked!
    meeting = respond_to?(:locked_meeting, true) ? locked_meeting : @meeting
    return if meeting.nil? || !meeting.locked?

    render json: { error: "잠긴 회의입니다. 잠금을 해제한 뒤 다시 시도하세요." }, status: :forbidden
  end

  # 기밀 구간 절단(transcripts#redact)이 적용된 회의에 **콘텐츠를 되돌리는** 요청을 409로 차단한다.
  # 대상은 절단 후에도 파기한 기밀을 복원할 수 있는 writer 뿐이다:
  #   transcripts#bulk_create, meetings_audio#create/#chunk/#finalize
  # transcripts#redact 자체와 destroy_batch/update_content/split 에는 걸지 않는다 —
  # 재절단은 잔존 기밀 행을 마저 지우는 유일한 경로이고, 나머지는 콘텐츠를 되돌리지 않는다.
  #
  # ⭐ status(409)만으로는 부족하다. 이 API 의 409 는 전부 **재시도 가능**한 상태다
  # (녹음/전사/요약 중, recorder 기기 충돌, stale expected_bounds, AudioUploadJob in-flight).
  # 온디바이스 STT 동기 큐는 pendingSync 를 IndexedDB 에 영속하고 flush 마다 보유 세그먼트
  # 전체를 재전송하므로, "영구 거부"를 구분할 안정된 코드가 없으면 무한 재시도에 갇혀
  # 파기한 기밀 전사를 계속 밀어올린다. code 로 판정하게 한다.
  REDACTED_ERROR_CODE = "meeting_redacted".freeze

  def reject_if_redacted!
    meeting = respond_to?(:locked_meeting, true) ? locked_meeting : @meeting
    return if meeting.nil? || meeting.transcripts_redacted_at.nil?

    render json: {
      error: "기밀 절단이 적용된 회의입니다. 추가 녹음·전사 동기화를 받지 않습니다.",
      code: REDACTED_ERROR_CODE,
      transcripts_redacted_at: meeting.transcripts_redacted_at&.iso8601
    }, status: :conflict
  end
end
