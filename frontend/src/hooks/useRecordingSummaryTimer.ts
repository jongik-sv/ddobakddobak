import { useState, useRef, useEffect } from 'react'
import { triggerRealtimeSummary } from '../api/meetings'
import { useTranscriptStore } from '../stores/transcriptStore'

interface UseRecordingSummaryTimerOptions {
  isActive: boolean
  isPaused: boolean
  isApplyingCorrections: boolean
  meetingId: number
  summaryIntervalSec: number
  finalsCount: number
  isSummarizing: boolean
  showStatus: (msg: string, durationMs?: number) => void
}

/**
 * 라이브 녹음 중 자동 실시간 요약 타이머 + 수동 "지금 요약".
 *
 * useLiveRecording god 훅에서 분리 — 순수 코드 이동, 동작 무변경.
 * 카운트다운을 1틱당 -1로 누산하면 백그라운드 탭/화면꺼짐 시 setInterval throttle로
 * 어긋난다. Date.now() 기준 deadline(절대 시각)으로 매 틱 남은 시간을 재계산해
 * 벽시계와 일치시킨다. summaryIntervalSec === 0 이면 "안함"(종료 시 final 요약만).
 */
export function useRecordingSummaryTimer({
  isActive,
  isPaused,
  isApplyingCorrections,
  meetingId,
  summaryIntervalSec,
  finalsCount,
  isSummarizing,
  showStatus,
}: UseRecordingSummaryTimerOptions) {
  const [summaryCountdown, setSummaryCountdown] = useState<number>(0)
  // 요약 타이머는 틱 누산이 아니라 Date.now() 기준 deadline으로 동작 (백그라운드 throttle/일시정지에도 정확)
  const summaryDeadlineRef = useRef<number | null>(null)
  const summaryRemainingRef = useRef<number | null>(null)

  // 회의 중 수동 "지금 요약" — realtime 경로(기존 설정 반영). 종료/일시정지/빈기록/요약중엔 호출 안 함.
  const handleManualSummary = () => {
    if (isPaused || finalsCount === 0 || isSummarizing) return
    triggerRealtimeSummary(meetingId).catch(() => {})
    // 다음 자동 주기 deadline 재anchor — 수동 직후 중복 요약 방지.
    summaryDeadlineRef.current = Date.now() + summaryIntervalSec * 1000
    setSummaryCountdown(summaryIntervalSec)
  }

  // 초기화(handleResetConfirm) 시 타이머 완전 리셋
  const resetSummaryTimer = () => {
    summaryDeadlineRef.current = null
    summaryRemainingRef.current = null
    setSummaryCountdown(0)
  }

  // 녹음 중(일시정지 아닌) Date.now() 기준 deadline → 도달 시 AI 요약 트리거
  useEffect(() => {
    if (!isActive || isPaused || summaryIntervalSec === 0) {
      // 일시정지/중지/안함: 타이머 완전 리셋 (재개 시 전체 간격부터 새로 시작)
      summaryDeadlineRef.current = null
      summaryRemainingRef.current = null
      setSummaryCountdown(0)
      return
    }

    // 오타 수정 반영 중이면 타이머 일시정지 — 남은 시간 보존 (deadline → remaining)
    if (isApplyingCorrections) {
      if (summaryDeadlineRef.current !== null) {
        summaryRemainingRef.current = Math.max(
          0,
          Math.ceil((summaryDeadlineRef.current - Date.now()) / 1000),
        )
        summaryDeadlineRef.current = null
      }
      return
    }

    // 시작/재개: deadline 없으면 남은 시간(보존된 값 or 전체 간격)으로 새로 anchor
    if (summaryDeadlineRef.current === null) {
      const secs = summaryRemainingRef.current ?? summaryIntervalSec
      summaryDeadlineRef.current = Date.now() + secs * 1000
      summaryRemainingRef.current = null
    }
    setSummaryCountdown(
      Math.max(0, Math.ceil((summaryDeadlineRef.current - Date.now()) / 1000)),
    )

    let summarizing = false
    const interval = setInterval(() => {
      if (summarizing) return  // 요약 진행 중이면 카운트다운 정지
      const deadline = summaryDeadlineRef.current
      if (deadline === null) return
      const remaining = Math.ceil((deadline - Date.now()) / 1000)
      if (remaining <= 0) {
        // 라이브 기록 없으면 요약 스킵하고 다음 주기로.
        if (useTranscriptStore.getState().finals.length === 0) {
          summaryDeadlineRef.current = Date.now() + summaryIntervalSec * 1000
          setSummaryCountdown(summaryIntervalSec)
          return
        }
        summarizing = true
        setSummaryCountdown(0)
        showStatus('기록을 회의록에 적용 중...', 10000)
        triggerRealtimeSummary(meetingId)
          .then(() => showStatus('회의록 적용 완료'))
          .catch(() => {})
          .finally(() => {
            summarizing = false
            // 다음 주기 deadline 재설정 (요약에 걸린 시간만큼 자동 보정)
            summaryDeadlineRef.current = Date.now() + summaryIntervalSec * 1000
            setSummaryCountdown(summaryIntervalSec)
          })
      } else {
        setSummaryCountdown(remaining)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [isActive, isPaused, isApplyingCorrections, meetingId, summaryIntervalSec])

  return { summaryCountdown, handleManualSummary, resetSummaryTimer }
}
