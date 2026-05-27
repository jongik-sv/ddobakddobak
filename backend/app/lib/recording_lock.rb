# 회의별 "단일 녹음 스트림" 락 (인프로세스).
#
# 같은 owner 유저가 여러 기기/커넥션에서 같은 회의에 붙어 동시에 오디오를
# 밀어넣는 것을 막는다. 락은 회의당 하나, 보유자는 커넥션별 토큰으로 식별한다.
#
# 단일 Puma 워커 전제(현 배포). 멀티 워커/멀티 서버로 확장하면 프로세스마다
# 메모리가 분리되어 락이 공유되지 않으므로 Redis/DB 백엔드로 교체해야 한다.
module RecordingLock
  MAP = Concurrent::Map.new

  module_function

  # 락 획득 시도. 비어 있거나 이미 같은 token이 보유 중이면 true,
  # 다른 token이 보유 중이면 false. (check-and-set 원자적)
  def acquire(meeting_id, token)
    MAP.compute_if_absent(meeting_id) { token } == token
  end

  # 해당 token이 보유 중일 때만 락 해제. (값 동등 비교)
  def release(meeting_id, token)
    MAP.compute_if_present(meeting_id) { |current| current == token ? nil : current }
  end

  # 토큰과 무관하게 강제 해제(회의 종료 시 등).
  def clear(meeting_id)
    MAP.delete(meeting_id)
  end

  def holder(meeting_id)
    MAP[meeting_id]
  end

  # 테스트용 전체 초기화.
  def reset!
    MAP.clear
  end
end
