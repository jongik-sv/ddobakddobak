import { create } from 'zustand'
import { useTranscriptStore } from './transcriptStore'
import { DEFAULT_SUMMARY_INTERVAL_SEC } from '../config'
import type { RecordingState, RecHandlers, RecStatus } from './recordingStore.types'

const initial = {
  activeMeetingId: null as number | null,
  pendingStart: false,
  status: 'idle' as RecStatus,
  meetingApiStatus: null as 'pending' | 'recording' | 'completed' | null,
  isPaused: false,
  elapsedSeconds: 0,
  summaryCountdown: 0,
  summaryIntervalSec: DEFAULT_SUMMARY_INTERVAL_SEC,
  canManualSummary: false,
  systemAudioEnabled: false,
  isResetting: false,
  isStopping: false,
  error: null as string | null,
  sttEngine: null as string | null,
  activeSttMode: 'server' as 'server' | 'local',
  isApplyingCorrections: false,
  showStopConfirm: false,
  _handlers: null as RecHandlers | null,
}

/** 녹음 세션 스토어. 세션-로컬 상태 + 인텐트만 — 전사/요약/공유는 기존 전역 store 직독.
 *  세션(RecordingSession)이 publish()로 상태를 올리고 registerHandlers()로 제어를 등록한다.
 *  페이지·바는 이 스토어를 읽고 인텐트를 호출한다. */
export const useRecordingStore = create<RecordingState>((set, get) => ({
  ...initial,
  start: (meetingId) => {
    if (get().activeMeetingId === meetingId) return
    set({ activeMeetingId: meetingId, pendingStart: true, status: 'idle' })
  },
  pause: () => get()._handlers?.onPause(),
  resume: () => get()._handlers?.onResume(),
  requestStop: () => {
    if (useTranscriptStore.getState().finals.length === 0) {
      get()._handlers?.onStop(true)
      return
    }
    set({ showStopConfirm: true })
  },
  cancelStop: () => set({ showStopConfirm: false }),
  confirmStop: (skipSummary) => { set({ showStopConfirm: false }); get()._handlers?.onStop(skipSummary) },
  manualSummary: () => get()._handlers?.onManualSummary(),
  toggleSystemAudio: (next) => get()._handlers?.onToggleSystemAudio(next),
  setSummaryInterval: (sec) => { set({ summaryIntervalSec: sec }); get()._handlers?.onSetSummaryInterval(sec) },
  resetMeeting: () => get()._handlers?.onReset(),
  setApplyingCorrections: (v) => set({ isApplyingCorrections: v }),
  publish: (partial) => set(partial),
  registerHandlers: (h) => set({ _handlers: h }),
  consumePendingStart: () => set({ pendingStart: false }),
  endSession: () => set({ ...initial }),
}))

export type { RecStatus, RecHandlers, RecordingState }
