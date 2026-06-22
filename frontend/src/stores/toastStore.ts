import { create } from 'zustand'

interface ToastState {
  message: string
  showStatus: (message: string, durationMs?: number) => void
  clear: () => void
}

let timer: ReturnType<typeof setTimeout> | null = null

/** 전역 상태 토스트. 페이지-로컬 useStatusMessage를 대체 — 백그라운드 녹음 종료 메시지가
 *  라이브 페이지를 떠난 라우트에서도 표시돼야 하므로 전역화한다. */
export const useToastStore = create<ToastState>((set) => ({
  message: '',
  showStatus: (message, durationMs = 3000) => {
    if (timer) clearTimeout(timer)
    set({ message })
    timer = setTimeout(() => { set({ message: '' }); timer = null }, durationMs)
  },
  clear: () => {
    if (timer) { clearTimeout(timer); timer = null }
    set({ message: '' })
  },
}))
