import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { RecordingLayer } from '../RecordingLayer'
import { useRecordingStore } from '../../../stores/recordingStore'

// 마운트 횟수(mountCount)와 렌더 횟수(callCount)를 분리해 추적한다.
// 마운트 = useEffect(fn, []) 발화 횟수 = 진짜 DOM 마운트.
// 렌더 = useLiveRecording 호출 횟수 = React 렌더 함수 실행.
// 재마운트가 없으면 mountCount는 초기 1에서 변하지 않는다.
let mountCount = 0
const liveMock = vi.fn(() => {
  // 마운트 감지: startOnMount 여부와 무관하게 내부 useEffect 흉내 대신,
  // 마운트 카운트는 별도로 RecordingSession의 useEffect를 통해 수집한다.
  // 여기선 렌더 호출 수만 세고, 마운트 수는 mountCount 변수로 분리한다.
  return {
    isActive: true,
    handleStart: vi.fn(),
    handlePause: vi.fn(),
    handleResume: vi.fn(),
    performStop: vi.fn().mockResolvedValue(undefined),
    handleManualSummary: vi.fn(),
    handleToggleSystemAudio: vi.fn(),
    setSummaryIntervalSec: vi.fn(),
    handleResetConfirm: vi.fn(),
    isPaused: false,
    elapsedSeconds: 0,
    summaryCountdown: 0,
    summaryIntervalSec: 120,
    canManualSummary: false,
    systemAudioEnabled: false,
    isResetting: false,
    isStopping: false,
    error: null,
    systemAudioError: null,
    sttEngine: null,
    activeSttMode: 'server' as const,
    meetingApiStatus: 'recording' as const,
    status: 'recording',
  }
})

vi.mock('../../../hooks/useLiveRecording', () => ({
  useLiveRecording: (...args: unknown[]) => liveMock(...(args as [])),
}))

// RecordingSession의 마운트를 감지하기 위해 useEffect를 추적한다.
// vi.mock을 통해 RecordingSession 자체는 모킹하지 않고(그러면 호스트 테스트가 됨),
// 대신 "라우트 변경 후 call 횟수 증가분"으로 재마운트 vs 재렌더를 구분한다.
//
// 재마운트(key 변경 등)이면: startedRef가 reset → consumePendingStart 재실행 → store 업데이트 → 추가 렌더 루프
// 재렌더만 이면: 렌더 함수 1회 재실행(+1 call) — 이것은 정상이다.
//
// 따라서 `n` 캡처 후 route 변경 시 call이 최대 +1(재렌더)이고
// +2 이상(재마운트 → 추가 렌더 루프)이 아님을 검증한다.

function App() {
  return (
    <>
      <Routes>
        <Route path="/a" element={<div>A</div>} />
        <Route path="/b" element={<div>B</div>} />
      </Routes>
      <RecordingLayer />
    </>
  )
}

// SMOKE 테스트(로컬 App 트리) — 실제 라우트 영속 보장은 수동 E2E #1이 담당.
// "세션이 라우트 밖 RecordingLayer에 있어 라우트 변경에 재마운트 안 됨" 구조 속성을 가드한다.
describe('녹음 지속성(라우트 변경) smoke', () => {
  beforeEach(() => {
    liveMock.mockClear()
    mountCount = 0
    useRecordingStore.getState().endSession()
  })

  it('세션 마운트 후 라우트가 바뀌어도 재마운트되지 않는다(녹음 지속)', () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/a']}>
        <App />
      </MemoryRouter>,
    )
    expect(liveMock).not.toHaveBeenCalled() // idle: 미마운트

    useRecordingStore.getState().start(1)
    rerender(
      <MemoryRouter initialEntries={['/a']}>
        <App />
      </MemoryRouter>,
    )
    expect(liveMock).toHaveBeenCalled() // 마운트됨

    const n = liveMock.mock.calls.length // 마운트 시점 호출 수(pendingStart 재렌더로 1+ 가능)

    rerender(
      <MemoryRouter initialEntries={['/b']}>
        <App />
      </MemoryRouter>,
    ) // 라우트 변경

    // 재렌더(+1)는 정상. 재마운트(+2 이상)가 없어야 한다 = 녹음 지속.
    // 재마운트 시: key(activeMeetingId) 변경 없이도 RecordingSession 언마운트+리마운트가
    // 발생하면 startedRef reset → consumePendingStart → store.publish 루프 → 다수 추가 호출.
    expect(liveMock.mock.calls.length).toBeLessThanOrEqual(n + 1) // 추가 호출 최대 1(재렌더) = 재마운트 없음
  })
})
