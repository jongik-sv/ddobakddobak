import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMediaQuery, BREAKPOINTS } from '../useMediaQuery'

describe('BREAKPOINTS', () => {
  it('lg는 1024px 기준', () => {
    expect(BREAKPOINTS.lg).toBe('(min-width: 1024px)')
  })

  it('모든 브레이크포인트가 정의됨', () => {
    expect(BREAKPOINTS.sm).toBeDefined()
    expect(BREAKPOINTS.md).toBeDefined()
    expect(BREAKPOINTS.lg).toBeDefined()
    expect(BREAKPOINTS.xl).toBeDefined()
  })
})

describe('useMediaQuery', () => {
  let listeners: Array<() => void>
  let mockMatches: boolean

  beforeEach(() => {
    listeners = []
    mockMatches = false

    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: mockMatches,
      media: query,
      onchange: null,
      addEventListener: (_: string, cb: () => void) => {
        listeners.push(cb)
      },
      removeEventListener: (_: string, cb: () => void) => {
        listeners = listeners.filter((l) => l !== cb)
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  })

  it('초기값이 matchMedia.matches를 반영함', () => {
    mockMatches = true
    const { result } = renderHook(() => useMediaQuery(BREAKPOINTS.lg))
    expect(result.current).toBe(true)
  })

  it('matches가 false이면 false 반환', () => {
    mockMatches = false
    const { result } = renderHook(() => useMediaQuery(BREAKPOINTS.lg))
    expect(result.current).toBe(false)
  })

  it('change 이벤트에 반응하여 값이 변경됨', () => {
    mockMatches = false
    const { result } = renderHook(() => useMediaQuery(BREAKPOINTS.lg))
    expect(result.current).toBe(false)

    // 미디어 쿼리 매치 변경 시뮬레이션
    mockMatches = true
    act(() => {
      listeners.forEach((cb) => cb())
    })
    expect(result.current).toBe(true)
  })

  it('unmount 시 리스너 정리', () => {
    const { unmount } = renderHook(() => useMediaQuery(BREAKPOINTS.lg))
    expect(listeners.length).toBeGreaterThan(0)
    unmount()
    expect(listeners.length).toBe(0)
  })
})
