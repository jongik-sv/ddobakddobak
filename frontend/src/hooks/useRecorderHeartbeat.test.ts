import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useRecorderHeartbeat } from './useRecorderHeartbeat'

describe('useRecorderHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('active=true → 마운트 즉시 1회 발사 (시작 직후 공백 제거)', () => {
    const sendHeartbeat = vi.fn()
    renderHook(() => useRecorderHeartbeat(true, sendHeartbeat))
    expect(sendHeartbeat).toHaveBeenCalledTimes(1)
  })

  it('active=true → 15초마다 추가 1회 (침묵 라이브의 유일한 생명선)', () => {
    const sendHeartbeat = vi.fn()
    renderHook(() => useRecorderHeartbeat(true, sendHeartbeat))
    expect(sendHeartbeat).toHaveBeenCalledTimes(1) // 즉시 1회

    vi.advanceTimersByTime(15_000)
    expect(sendHeartbeat).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(15_000)
    expect(sendHeartbeat).toHaveBeenCalledTimes(3)
  })

  it('active=false → 0회 (시청자/2번째 탭 keep-alive 회귀 차단)', () => {
    const sendHeartbeat = vi.fn()
    renderHook(() => useRecorderHeartbeat(false, sendHeartbeat))
    expect(sendHeartbeat).not.toHaveBeenCalled()

    vi.advanceTimersByTime(60_000)
    expect(sendHeartbeat).not.toHaveBeenCalled()
  })

  it('active true→false → 인터벌 정리, 더 이상 발사 없음', () => {
    const sendHeartbeat = vi.fn()
    // sendHeartbeat 참조는 rerender 간 동일해야 함 (참조 변경 시 effect 재실행으로 오발사)
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useRecorderHeartbeat(active, sendHeartbeat),
      { initialProps: { active: true } },
    )
    expect(sendHeartbeat).toHaveBeenCalledTimes(1) // 즉시 1회

    vi.advanceTimersByTime(15_000)
    expect(sendHeartbeat).toHaveBeenCalledTimes(2) // 인터벌 1회

    rerender({ active: false }) // 비활성화 → cleanup으로 인터벌 정리
    const countAtToggle = sendHeartbeat.mock.calls.length
    expect(countAtToggle).toBe(2) // 토글 자체로는 발사 없음

    vi.advanceTimersByTime(60_000)
    expect(sendHeartbeat).toHaveBeenCalledTimes(countAtToggle) // 증가 0
  })
})
