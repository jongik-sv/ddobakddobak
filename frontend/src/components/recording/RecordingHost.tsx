import { useRecordingStore } from '../../stores/recordingStore'
import { RecordingSession } from './RecordingSession'

/** activeMeetingId가 설정되면 헤드리스 세션을 마운트한다. GatedApp(영속)에 마운트되어
 *  라우트가 바뀌어도 언마운트되지 않으므로 녹음이 페이지 이탈에도 계속된다. */
export function RecordingHost() {
  const activeMeetingId = useRecordingStore((s) => s.activeMeetingId)
  const pendingStart = useRecordingStore((s) => s.pendingStart)
  if (activeMeetingId == null) return null
  return <RecordingSession key={activeMeetingId} meetingId={activeMeetingId} startOnMount={pendingStart} />
}
