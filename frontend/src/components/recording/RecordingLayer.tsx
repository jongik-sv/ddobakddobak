import { RecordingHost } from './RecordingHost'
import { RecordingBar } from './RecordingBar'
import { StopMeetingDialog } from '../meeting/StopMeetingDialog'
import { useRecordingStore } from '../../stores/recordingStore'

/** 앱 레벨 녹음 레이어 — GatedApp에 단일 마운트. 영속 세션 호스트 + 떠다니는 바 +
 *  전역 종료확인 다이얼로그(어느 라우트서든 바의 [종료]가 띄움). */
export function RecordingLayer() {
  const showStopConfirm = useRecordingStore((s) => s.showStopConfirm)
  const confirmStop = useRecordingStore((s) => s.confirmStop)
  const cancelStop = useRecordingStore((s) => s.cancelStop)
  return (
    <>
      <RecordingHost />
      <RecordingBar />
      {showStopConfirm && (
        <StopMeetingDialog
          onSummarize={() => confirmStop(false)}
          onSkip={() => confirmStop(true)}
          onCancel={cancelStop}
        />
      )}
    </>
  )
}
