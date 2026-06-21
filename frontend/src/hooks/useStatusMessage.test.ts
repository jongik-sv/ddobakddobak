import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStatusMessage } from './useStatusMessage'

describe('useStatusMessage', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('초기 statusMessage는 null', () => {
    const { result } = renderHook(() => useStatusMessage())
    expect(result.current.statusMessage).toBeNull()
  })

  it('showStatus 호출 시 메시지를 설정한다', () => {
    const { result } = renderHook(() => useStatusMessage())
    act(() => result.current.showStatus('hi'))
    expect(result.current.statusMessage).toBe('hi')
  })

  it('기본 3000ms 경과 후 null로 초기화된다', () => {
    const { result } = renderHook(() => useStatusMessage())
    act(() => result.current.showStatus('hi'))
    expect(result.current.statusMessage).toBe('hi')
    act(() => vi.advanceTimersByTime(3000))
    expect(result.current.statusMessage).toBeNull()
  })

  it('커스텀 duration을 존중한다', () => {
    const { result } = renderHook(() => useStatusMessage())
    act(() => result.current.showStatus('x', 5000))
    act(() => vi.advanceTimersByTime(3000))
    expect(result.current.statusMessage).toBe('x')
    act(() => vi.advanceTimersByTime(2000))
    expect(result.current.statusMessage).toBeNull()
  })

  it('재호출 시 이전 타이머를 제거한다 (조기 null 없음)', () => {
    const { result } = renderHook(() => useStatusMessage())
    act(() => result.current.showStatus('first'))
    act(() => vi.advanceTimersByTime(2000))
    act(() => result.current.showStatus('second'))
    // 첫 타이머가 만료될 시점(추가 1000ms = 첫 호출로부터 3000ms)에도 유지
    act(() => vi.advanceTimersByTime(1000))
    expect(result.current.statusMessage).toBe('second')
    // 두 번째 호출 기준 3000ms 경과 후에만 null
    act(() => vi.advanceTimersByTime(2000))
    expect(result.current.statusMessage).toBeNull()
  })
})
