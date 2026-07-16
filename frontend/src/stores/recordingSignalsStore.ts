import { create } from 'zustand'

// 단일 녹음 세션 신호 스토어.
// TranscriptionChannel의 recording_* broadcast를 받아 페이지/훅이 구독한다.
// - recordingDenied: 다른 세션이 이미 녹음 중 → 이 세션은 캡처 폐기 + 읽기전용 뷰어로 라우팅
// - recordingStopped: 녹음 세션 종료됨 → 뷰어에 "종료됨" 안내
// - recordingPaused: 녹음 기기의 일시정지/재개 신호. null=신호 미수신(REST 초기값으로 폴백).
//   신호는 전역 싱글턴이므로 meetingId를 함께 담아 회의별로 스코프한다 — 백그라운드로
//   회의 A를 일시정지 중인 기기가 회의 B 뷰어로 진입해도 A의 신호가 누수되지 않게 한다.
export interface RecordingPausedSignal {
  meetingId: number
  paused: boolean
}

interface RecordingSignalsState {
  recordingStopped: boolean
  recordingDenied: boolean
  recordingPaused: RecordingPausedSignal | null

  setRecordingStopped: (stopped: boolean) => void
  setRecordingDenied: (denied: boolean) => void
  setRecordingPaused: (meetingId: number, paused: boolean) => void
  reset: () => void
}

const initialState = {
  recordingStopped: false,
  recordingDenied: false,
  recordingPaused: null,
}

export const useRecordingSignalsStore = create<RecordingSignalsState>()((set) => ({
  ...initialState,

  setRecordingStopped: (stopped) => set({ recordingStopped: stopped }),

  setRecordingDenied: (denied) => set({ recordingDenied: denied }),

  setRecordingPaused: (meetingId, paused) => set({ recordingPaused: { meetingId, paused } }),

  reset: () => set(initialState),
}))
