import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMediaQuery } from './useMediaQuery'

describe('useMediaQuery', () => {
  let listeners: Array<(e: { matches: boolean }) => void>
  let mockMatches: boolean

  beforeEach(() => {
    listeners = []
    mockMatches = false

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn((query: string) => ({
        matches: mockMatches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn((_event: string, cb: (e: { matches: boolean }) => void) => {
          listeners.push(cb)
        }),
        removeEventListener: vi.fn((_event: string, cb: (e: { matches: boolean }) => void) => {
          listeners = listeners.filter((l) => l !== cb)
        }),
        dispatchEvent: vi.fn(() => false),
      })),
    })
  })

  afterEach(() => {
    listeners = []
  })

  it('returns false initially when media query does not match', () => {
    mockMatches = false
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'))
    expect(result.current).toBe(false)
  })

  it('returns true initially when media query matches', () => {
    mockMatches = true
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'))
    expect(result.current).toBe(true)
  })

  it('updates when media query match state changes', () => {
    mockMatches = false
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'))
    expect(result.current).toBe(false)

    // Simulate viewport change
    act(() => {
      listeners.forEach((cb) => cb({ matches: true }))
    })
    expect(result.current).toBe(true)
  })

  it('cleans up event listener on unmount', () => {
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 1024px)'))
    expect(listeners.length).toBe(1)

    unmount()
    expect(listeners.length).toBe(0)
  })

  it('calls matchMedia with the provided query string', () => {
    renderHook(() => useMediaQuery('(min-width: 768px)'))
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 768px)')
  })
})
