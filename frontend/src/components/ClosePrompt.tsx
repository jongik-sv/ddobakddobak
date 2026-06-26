import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { IS_TAURI, getMode } from '../config'
import { getCloseAction, setCloseAction, type CloseAction } from '../lib/closeAction'

/**
 * 데스크톱 로컬 앱에서 창 닫기(빨간 X)를 가로채 백그라운드/완전종료를 묻는다.
 * 기억된 선택이 있으면 모달 없이 즉시 수행. cmd+Q는 가로채지 않음(자연 종료).
 * RecordingRecovery/ScheduledMeetingWatcher와 같은 전역 마운트, 평소 null 렌더.
 */
export function ClosePrompt() {
  const [open, setOpen] = useState(false)
  const [remember, setRemember] = useState(false)

  useEffect(() => {
    if (!IS_TAURI || getMode() !== 'local') return
    let unlisten: (() => void) | undefined
    let disposed = false
    ;(async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      const un = await win.onCloseRequested(async (event) => {
        event.preventDefault()
        const saved = getCloseAction()
        if (saved === 'hide') return void win.hide()
        if (saved === 'quit') {
          const { invoke } = await import('@tauri-apps/api/core')
          return void invoke('quit_app')
        }
        setOpen(true)
      })
      if (disposed) un()
      else unlisten = un
    })()
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  const cancel = () => setOpen(false)

  const choose = async (action: CloseAction) => {
    if (remember) setCloseAction(action)
    setOpen(false)
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    if (action === 'hide') await getCurrentWindow().hide()
    else {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('quit_app')
    }
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="창 닫기"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) cancel()
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-2xl border border-border">
        <h2 className="text-lg font-semibold">또박또박을 어떻게 할까요?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          백그라운드로 두면 예약 회의가 시각에 맞춰 자동 시작됩니다.
        </p>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          다음부터 묻지 않기
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <button
            className="rounded-lg border px-4 py-2 text-sm"
            onClick={cancel}
          >
            취소
          </button>
          <button
            className="rounded-lg border px-4 py-2 text-sm"
            onClick={() => void choose('quit')}
          >
            완전 종료
          </button>
          <button
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white"
            onClick={() => void choose('hide')}
          >
            백그라운드 유지
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
