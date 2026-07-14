/** 녹음 세션 스토어 타입 — 순환 import 회피용 별도 파일. */

export type RecStatus = 'idle' | 'recording' | 'stopped'

export interface RecHandlers {
  onPause: () => void
  onResume: () => void
  onStop: (skipSummary: boolean) => void
  onManualSummary: () => void
  onToggleSystemAudio: (next: boolean) => void
  onSetSummaryInterval: (sec: number) => void
  onReset: () => Promise<void> | void
}

export interface RecordingState {
  // 세션 식별 / 부트
  activeMeetingId: number | null
  pendingStart: boolean
  // 세션이 publish하는 상태
  status: RecStatus
  meetingApiStatus: 'pending' | 'recording' | 'completed' | null
  isPaused: boolean
  elapsedSeconds: number
  summaryCountdown: number
  summaryIntervalSec: number
  canManualSummary: boolean
  systemAudioEnabled: boolean
  isResetting: boolean
  isStopping: boolean
  error: string | null
  sttEngine: string | null
  activeSttMode: 'server' | 'local'
  isApplyingCorrections: boolean
  showStopConfirm: boolean
  _handlers: RecHandlers | null
  // 인텐트(페이지·바 공용)
  start: (meetingId: number) => void
  pause: () => void
  resume: () => void
  requestStop: () => void
  cancelStop: () => void
  confirmStop: (skipSummary: boolean) => void
  manualSummary: () => void
  toggleSystemAudio: (next: boolean) => void
  setSummaryInterval: (sec: number) => void
  resetMeeting: () => Promise<void> | void
  setApplyingCorrections: (v: boolean) => void
  // 세션 발행/등록/종료
  publish: (partial: Partial<RecordingState>) => void
  registerHandlers: (h: RecHandlers) => void
  consumePendingStart: () => void
  endSession: () => void
}
