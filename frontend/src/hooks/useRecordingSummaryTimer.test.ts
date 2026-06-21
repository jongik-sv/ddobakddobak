import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRecordingSummaryTimer } from './useRecordingSummaryTimer'
import { triggerRealtimeSummary } from '../api/meetings'
import { useTranscriptStore } from '../stores/transcriptStore'
import { DEFAULT_SUMMARY_INTERVAL_SEC } from '../config'

vi.mock('../api/meetings', () => ({
  triggerRealtimeSummary: vi.fn(async () => {}),
}))

vi.mock('../stores/transcriptStore', () => ({
  useTranscriptStore: { getState: vi.fn(() => ({ finals: [] })) },
}))

const trigger = vi.mocked(triggerRealtimeSummary)

type Opts = Parameters<typeof useRecordingSummaryTimer>[0]

function makeOptions(over: Partial<Opts> = {}): Opts {
  return {
    isActive: false,
    isPaused: false,
    isApplyingCorrections: false,
    meetingId: 42,
    finalsCount: 0,
    isSummarizing: false,
    showStatus: vi.fn(),
    ...over,
  }
}

describe('useRecordingSummaryTimer — summaryIntervalSec 상태 내재화', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useTranscriptStore.getState).mockReturnValue({ finals: [] } as never)
  })

  it('기본값: summaryIntervalSec === DEFAULT_SUMMARY_INTERVAL_SEC, summaryCountdown === 0', () => {
    const { result } = renderHook(() => useRecordingSummaryTimer(makeOptions()))
    expect(result.current.summaryIntervalSec).toBe(DEFAULT_SUMMARY_INTERVAL_SEC)
    expect(result.current.summaryCountdown).toBe(0)
  })

  it('setSummaryIntervalSec(n) 이 노출된 summaryIntervalSec 를 갱신한다', () => {
    const { result } = renderHook(() => useRecordingSummaryTimer(makeOptions()))
    act(() => result.current.setSummaryIntervalSec(120))
    expect(result.current.summaryIntervalSec).toBe(120)
  })

  it('isActive:false 면 카운트다운 0 유지, 자동 요약 호출 안 함', () => {
    const { result } = renderHook(() => useRecordingSummaryTimer(makeOptions({ isActive: false })))
    expect(result.current.summaryCountdown).toBe(0)
    expect(trigger).not.toHaveBeenCalled()
  })

  it('summaryIntervalSec 0("안함") 이면 활성이어도 카운트다운 0 유지, 자동 요약 안 함', () => {
    const { result } = renderHook(() => useRecordingSummaryTimer(makeOptions({ isActive: true })))
    act(() => result.current.setSummaryIntervalSec(0))
    expect(result.current.summaryCountdown).toBe(0)
    expect(trigger).not.toHaveBeenCalled()
  })

  it('handleManualSummary: finalsCount>0·미일시정지·미요약 → triggerRealtimeSummary(meetingId) 호출', () => {
    const { result } = renderHook(() =>
      useRecordingSummaryTimer(makeOptions({ finalsCount: 3, isPaused: false, isSummarizing: false })),
    )
    act(() => result.current.handleManualSummary())
    expect(trigger).toHaveBeenCalledTimes(1)
    expect(trigger).toHaveBeenCalledWith(42)
  })

  it('handleManualSummary: finalsCount=0 이면 호출 안 함', () => {
    const { result } = renderHook(() =>
      useRecordingSummaryTimer(makeOptions({ finalsCount: 0 })),
    )
    act(() => result.current.handleManualSummary())
    expect(trigger).not.toHaveBeenCalled()
  })

  it('handleManualSummary: 일시정지/요약중이면 호출 안 함', () => {
    const paused = renderHook(() =>
      useRecordingSummaryTimer(makeOptions({ finalsCount: 3, isPaused: true })),
    )
    act(() => paused.result.current.handleManualSummary())
    expect(trigger).not.toHaveBeenCalled()

    const summarizing = renderHook(() =>
      useRecordingSummaryTimer(makeOptions({ finalsCount: 3, isSummarizing: true })),
    )
    act(() => summarizing.result.current.handleManualSummary())
    expect(trigger).not.toHaveBeenCalled()
  })

  it('handleManualSummary 직후 summaryCountdown 이 현재 간격으로 재anchor 된다', () => {
    const { result } = renderHook(() =>
      useRecordingSummaryTimer(makeOptions({ finalsCount: 3 })),
    )
    act(() => result.current.setSummaryIntervalSec(90))
    act(() => result.current.handleManualSummary())
    expect(result.current.summaryCountdown).toBe(90)
  })
})

describe('useRecordingSummaryTimer — 자동 타이머(가짜 타이머)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.mocked(useTranscriptStore.getState).mockReturnValue({ finals: [] } as never)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('활성화되면 카운트다운이 현재 간격값(기본 180)으로 시작된다', () => {
    // 비활성으로 시작 → 활성으로 rerender 하면 deadline 이 새로 anchor 되어 간격값으로 시작.
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useRecordingSummaryTimer>[0]) => useRecordingSummaryTimer(props),
      { initialProps: makeOptions({ isActive: false }) },
    )
    expect(result.current.summaryCountdown).toBe(0)
    act(() => rerender(makeOptions({ isActive: true })))
    expect(result.current.summaryCountdown).toBe(DEFAULT_SUMMARY_INTERVAL_SEC)
  })

  it('resetSummaryTimer 가 카운트다운을 0 으로 되돌린다', () => {
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useRecordingSummaryTimer>[0]) => useRecordingSummaryTimer(props),
      { initialProps: makeOptions({ isActive: false }) },
    )
    act(() => rerender(makeOptions({ isActive: true })))
    expect(result.current.summaryCountdown).toBe(DEFAULT_SUMMARY_INTERVAL_SEC)
    act(() => result.current.resetSummaryTimer())
    expect(result.current.summaryCountdown).toBe(0)
  })
})
