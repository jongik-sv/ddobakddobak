import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useEffect } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { RecordingLayer } from '../RecordingLayer'
import { useRecordingStore } from '../../../stores/recordingStore'

// 진짜 마운트(mountCount)와 언마운트(unmountCount)를 모듈 레벨 변수로 추적한다.
// useLiveRecording 모킹 내부에서 useEffect(fn, [])를 발화시켜 마운트/언마운트를 직접 카운트한다.
//   - mountCount  = useEffect(fn, []) 진입 횟수 = 진짜 DOM 마운트
//   - unmountCount = cleanup 발화 횟수 = 진짜 언마운트
// 라우트가 바뀌어도 세션이 라우트 밖 RecordingLayer에 있으면 재마운트/언마운트가 없어야 한다.
let mountCount = 0
let unmountCount = 0
const liveMock = vi.fn(() => {
  // useEffect(fn, [])로 진짜 마운트/언마운트를 직접 카운트한다(재렌더와 무관).
  useEffect(() => {
    mountCount++
    return () => { unmountCount++ }
  }, [])
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
    unmountCount = 0
    useRecordingStore.getState().endSession()
  })

  it('세션 마운트 후 라우트가 바뀌어도 재마운트되지 않는다(녹음 지속)', () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/a']}>
        <App />
      </MemoryRouter>,
    )
    expect(liveMock).not.toHaveBeenCalled() // idle: 미마운트
    expect(mountCount).toBe(0)

    useRecordingStore.getState().start(1)
    rerender(
      <MemoryRouter initialEntries={['/a']}>
        <App />
      </MemoryRouter>,
    )
    // 세션이 마운트됨 — useEffect(fn, []) 1회 발화, 언마운트 0.
    expect(mountCount).toBe(1)
    expect(unmountCount).toBe(0)

    rerender(
      <MemoryRouter initialEntries={['/b']}>
        <App />
      </MemoryRouter>,
    ) // 라우트 변경

    // 라우트가 바뀌어도 세션은 라우트 밖이라 재마운트/언마운트가 없어야 한다.
    expect(mountCount).toBe(1)    // STILL 1 — 재마운트 없음
    expect(unmountCount).toBe(0)  // STILL 0 — 언마운트 없음
  })
})
