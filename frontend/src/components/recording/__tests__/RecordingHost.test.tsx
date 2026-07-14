import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useRecordingStore } from '../../../stores/recordingStore'

const liveMock = vi.fn(() => ({
  isActive: false, isPaused: false, elapsedSeconds: 0, status: 'idle',
  meetingApiStatus: 'pending', summaryCountdown: 0, summaryIntervalSec: 120,
  canManualSummary: false, systemAudioEnabled: false, isResetting: false,
  isStopping: false, error: null, sttEngine: null, activeSttMode: 'server',
  handlePause(){}, handleResume(){}, performStop: async () => {}, handleManualSummary(){},
  handleToggleSystemAudio(){}, setSummaryIntervalSec(){}, handleResetConfirm: async () => {},
  handleStart: vi.fn(),
}))
vi.mock('../../../hooks/useLiveRecording', () => ({ useLiveRecording: (...a: unknown[]) => liveMock(...(a as [])) }))

import { RecordingHost } from '../RecordingHost'

const wrap = () => render(<MemoryRouter><RecordingHost /></MemoryRouter>)

describe('RecordingHost', () => {
  beforeEach(() => { liveMock.mockClear(); useRecordingStore.getState().endSession() })

  it('activeMeetingId null이면 useLiveRecording 미실행', () => {
    wrap()
    expect(liveMock).not.toHaveBeenCalled()
  })

  it('activeMeetingId 설정되면 세션 마운트→useLiveRecording 해당 meetingId로 실행(단일 소유자)', () => {
    // 렌더 카운트로 "정확히 1회"를 단언하면 안 된다 — RecordingHost가 pendingStart를 구독하므로
    // consumePendingStart()의 true→false 가 같은 세션 인스턴스를 재렌더(리마운트 아님, key 불변)해
    // 렌더당 mock이 1회씩 발화한다. 단일 소유자 불변식은 "1개 인스턴스 마운트"이지 "1회 호출"이 아니다.
    // 라우트 변경 시 무리마운트는 persistence 통합 테스트(T9)가 캡처-비교로 가드한다.
    const { rerender } = wrap()
    useRecordingStore.getState().start(99)
    rerender(<MemoryRouter><RecordingHost /></MemoryRouter>)
    expect(liveMock).toHaveBeenCalled()
    expect(liveMock).toHaveBeenCalledWith(99, expect.anything())
  })
})
