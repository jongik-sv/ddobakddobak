import { useEffect, useRef } from 'react'
import { useLiveRecording } from '../../hooks/useLiveRecording'
import { useRecordingStore } from '../../stores/recordingStore'
import { useTranscriptStore } from '../../stores/transcriptStore'

/** 헤드리스 라이브 세션. RecordingHost에서만 마운트. useLiveRecording을 유일하게 실행하고
 *  상태를 recordingStore에 publish + 제어 핸들러를 register한다. UI 렌더 없음(null). */
export function RecordingSession({ meetingId, startOnMount }: { meetingId: number; startOnMount: boolean }) {
  const live = useLiveRecording(meetingId, {
    isApplyingCorrections: useRecordingStore((s) => s.isApplyingCorrections),
    clearMemoEditor: () => {/* 리셋 메모clear는 페이지-로컬(Task 8) — 세션에선 noop */},
  })

  // pendingStart 소비 → handleStart 1회
  const startedRef = useRef(false)
  useEffect(() => {
    if (!startOnMount || startedRef.current) return
    startedRef.current = true
    useRecordingStore.getState().consumePendingStart()
    void live.handleStart()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startOnMount])

  // 핸들러 등록(렌더마다 최신 클로저로 갱신)
  useEffect(() => {
    useRecordingStore.getState().registerHandlers({
      onPause: live.handlePause,
      onResume: live.handleResume,
      // 종료 완료 후 endSession() → activeMeetingId=null → 세션 언마운트.
      // 이게 없으면 activeMeetingId가 stuck → start() early-return으로 재개(reopen) 불가.
      // 언마운트로 key(activeMeetingId) 변경 → 다음 start 시 startedRef 초기화된 새 세션 → handleStart 재발화.
      onStop: (skip) => { void Promise.resolve(live.performStop(skip)).then(() => useRecordingStore.getState().endSession()) },
      onManualSummary: live.handleManualSummary,
      onToggleSystemAudio: (next) => { void live.handleToggleSystemAudio(next) },
      onSetSummaryInterval: live.setSummaryIntervalSec,
      onReset: live.handleResetConfirm,
    })
  })

  // 상태 publish
  const finalsCount = useTranscriptStore((s) => s.finals.length)
  const isSummarizing = useTranscriptStore((s) => s.isSummarizing)
  useEffect(() => {
    useRecordingStore.getState().publish({
      status: live.isActive ? 'recording' : (live.meetingApiStatus === 'completed' ? 'stopped' : 'idle'),
      meetingApiStatus: live.meetingApiStatus,
      isPaused: live.isPaused,
      elapsedSeconds: live.elapsedSeconds,
      summaryCountdown: live.summaryCountdown,
      summaryIntervalSec: live.summaryIntervalSec,
      canManualSummary: live.canManualSummary,
      systemAudioEnabled: live.systemAudioEnabled,
      isResetting: live.isResetting,
      isStopping: live.isStopping,
      error: live.error ?? live.systemAudioError ?? null,
      sttEngine: live.sttEngine,
      activeSttMode: live.activeSttMode,
    })
  }, [live.isActive, live.meetingApiStatus, live.isPaused, live.elapsedSeconds,
      live.summaryCountdown, live.summaryIntervalSec, live.canManualSummary,
      live.systemAudioEnabled, live.isResetting, live.isStopping, live.error,
      live.systemAudioError, live.sttEngine, live.activeSttMode, finalsCount, isSummarizing])

  return null
}
