import { useWhiteboardStore } from '../../stores/whiteboardStore'

/** 내보내기 패널이 닫힌 채 화이트보드 생성이 끝났을 때의 전역 토스트. 자동 다운로드는 하지 않는다. */
export function WhiteboardToast() {
  const notice = useWhiteboardStore((s) => s.notice)
  const save = useWhiteboardStore((s) => s.save)
  const dismiss = useWhiteboardStore((s) => s.dismissNotice)
  if (!notice) return null
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="whiteboard-toast"
      className="fixed bottom-4 right-4 z-[80] flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground shadow-2xl"
    >
      <span className={notice.kind === 'error' ? 'text-red-500' : ''}>{notice.message}</span>
      {notice.kind === 'done' && (
        <button
          type="button"
          onClick={() => {
            // 먼저 닫아야 save 실패 시 띄우는 오류 토스트가 같이 지워지지 않는다.
            dismiss()
            void save(notice.meetingId)
          }}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700"
        >
          화이트보드 저장
        </button>
      )}
      <button type="button" onClick={dismiss} className="text-muted-foreground hover:text-foreground">
        닫기
      </button>
    </div>
  )
}
