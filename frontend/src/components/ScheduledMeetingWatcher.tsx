import { useScheduledMeetings } from '../hooks/useScheduledMeetings'

/**
 * 예약 회의 전역 워처. UI를 렌더하지 않고(useScheduledMeetings의 부수효과만 구동) GatedApp
 * 안에 마운트되어 인증된 앱이 열려 있는 동안 예약 시각 도달 회의를 시작한다.
 * RecordingRecovery와 동일한 return-null 패턴.
 */
export function ScheduledMeetingWatcher() {
  useScheduledMeetings()
  return null
}
