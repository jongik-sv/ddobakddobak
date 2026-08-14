import { Dialog } from '../ui/Dialog'

interface AudioAppendChoiceDialogProps {
  fileCount: number
  onAppend: () => void
  onNewMeeting: () => void
  onCancel: () => void
}

/**
 * 이미 오디오가 있는 회의에 오디오 파일이 드롭됐을 때 "기존 녹음 뒤에 연결" / "새 회의로 생성" /
 * "취소" 중 하나를 고르는 작은 확인 다이얼로그. Tauri WKWebView에서 window.confirm이
 * non-blocking이라 즉시 다음 코드가 실행돼버리는 함정이 있어(설계 §D-4) window.confirm 대신
 * 기존 Dialog 셸을 재사용한다.
 */
export function AudioAppendChoiceDialog({ fileCount, onAppend, onNewMeeting, onCancel }: AudioAppendChoiceDialogProps) {
  return (
    <Dialog
      onClose={onCancel}
      closeOnBackdrop={false}
      closeOnEsc={false}
      className="bg-card rounded-xl shadow-lg p-6 max-w-sm w-full mx-4"
    >
      <h3 className="text-base font-semibold text-foreground mb-2">오디오 파일 {fileCount}개 감지</h3>
      <p className="text-sm text-muted-foreground mb-4">
        이 회의에는 이미 오디오가 있습니다. 기존 녹음 뒤에 이어붙이거나, 새 회의로 만들 수 있습니다.
      </p>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onAppend}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          기존 녹음 뒤에 연결
        </button>
        <button
          type="button"
          onClick={onNewMeeting}
          className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          새 회의로 생성
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          취소
        </button>
      </div>
    </Dialog>
  )
}
