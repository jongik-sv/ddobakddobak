import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLocalToast } from '../useLocalToast'

describe('useLocalToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('초기 message는 null', () => {
    const { result } = renderHook(() => useLocalToast())
    expect(result.current.message).toBeNull()
  })

  it('show(text) 호출 시 message가 설정되고 durationMs 경과 후 자동으로 null이 된다', () => {
    const { result } = renderHook(() => useLocalToast(1000))
    act(() => result.current.show('안내'))
    expect(result.current.message).toBe('안내')

    act(() => vi.advanceTimersByTime(1000))
    expect(result.current.message).toBeNull()
  })

  it('만료 전 새 show가 오면 이전 타이머를 교체한다 (조기 clear 안 됨)', () => {
    const { result } = renderHook(() => useLocalToast(1000))
    act(() => result.current.show('A'))
    act(() => vi.advanceTimersByTime(500))
    act(() => result.current.show('B'))
    act(() => vi.advanceTimersByTime(600)) // A의 원래 만료 시점 지남
    expect(result.current.message).toBe('B')
    act(() => vi.advanceTimersByTime(400))
    expect(result.current.message).toBeNull()
  })
})
