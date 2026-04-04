import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// --- matchMedia mock helpers ---

type ChangeHandler = (e: MediaQueryListEvent) => void

let listeners: ChangeHandler[] = []

function createMockMatchMedia(defaultMatches: boolean) {
  listeners = []

  const mockMatchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: defaultMatches,
    media: query,
    addEventListener: vi.fn(
      (event: string, handler: ChangeHandler) => {
        if (event === 'change') listeners.push(handler)
      },
    ),
    removeEventListener: vi.fn(
      (event: string, handler: ChangeHandler) => {
        if (event === 'change') {
          const idx = listeners.indexOf(handler)
          if (idx >= 0) listeners.splice(idx, 1)
        }
      },
    ),
    dispatchEvent: vi.fn(),
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }))

  return mockMatchMedia
}

function fireChange(matches: boolean) {
  // Copy the array so splicing inside handlers won't skip entries
  const snapshot = [...listeners]
  snapshot.forEach((fn) => fn({ matches } as MediaQueryListEvent))
}

// --- import after mock setup ---

import { useMediaQuery, BREAKPOINTS } from './useMediaQuery'

// --- tests ---

describe('BREAKPOINTS', () => {
  it('sm = "(min-width: 640px)"', () => {
    expect(BREAKPOINTS.sm).toBe('(min-width: 640px)')
  })

  it('md = "(min-width: 768px)"', () => {
    expect(BREAKPOINTS.md).toBe('(min-width: 768px)')
  })

  it('lg = "(min-width: 1024px)"', () => {
    expect(BREAKPOINTS.lg).toBe('(min-width: 1024px)')
  })

  it('xl = "(min-width: 1280px)"', () => {
    expect(BREAKPOINTS.xl).toBe('(min-width: 1280px)')
  })

  it('정확히 4개의 키만 존재한다', () => {
    expect(Object.keys(BREAKPOINTS)).toHaveLength(4)
  })
})

describe('useMediaQuery', () => {
  let originalMatchMedia: typeof window.matchMedia

  beforeEach(() => {
    originalMatchMedia = window.matchMedia
    vi.clearAllMocks()
  })

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: originalMatchMedia,
    })
    listeners = []
  })

  it('초기 렌더링: matchMedia.matches가 true이면 true 반환', () => {
    const mockMM = createMockMatchMedia(true)
    Object.defineProperty(window, 'matchMedia', { writable: true, value: mockMM })

    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'))

    expect(result.current).toBe(true)
    expect(mockMM).toHaveBeenCalledWith('(min-width: 1024px)')
  })

  it('초기 렌더링: matchMedia.matches가 false이면 false 반환', () => {
    const mockMM = createMockMatchMedia(false)
    Object.defineProperty(window, 'matchMedia', { writable: true, value: mockMM })

    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'))

    expect(result.current).toBe(false)
  })

  it('change 이벤트 발생 시 상태가 업데이트된다', () => {
    const mockMM = createMockMatchMedia(false)
    Object.defineProperty(window, 'matchMedia', { writable: true, value: mockMM })

    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'))

    expect(result.current).toBe(false)

    act(() => {
      fireChange(true)
    })

    expect(result.current).toBe(true)

    act(() => {
      fireChange(false)
    })

    expect(result.current).toBe(false)
  })

  it('언마운트 시 removeEventListener가 호출된다', () => {
    const mockMM = createMockMatchMedia(false)
    Object.defineProperty(window, 'matchMedia', { writable: true, value: mockMM })

    const { unmount } = renderHook(() => useMediaQuery('(min-width: 640px)'))

    // useState 초기화: result[0], useEffect: result[1]
    const mqlFromEffect = mockMM.mock.results[1].value
    expect(mqlFromEffect.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))

    unmount()

    expect(mqlFromEffect.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('query 변경 시 리스너가 재등록된다', () => {
    const mockMM = createMockMatchMedia(false)
    Object.defineProperty(window, 'matchMedia', { writable: true, value: mockMM })

    const { rerender } = renderHook(
      ({ query }) => useMediaQuery(query),
      { initialProps: { query: '(min-width: 640px)' } },
    )

    // useState 초기화: result[0], useEffect: result[1]
    const firstEffectMql = mockMM.mock.results[1].value
    expect(firstEffectMql.addEventListener).toHaveBeenCalledTimes(1)

    // query 변경
    rerender({ query: '(min-width: 1024px)' })

    // 이전 리스너 해제 확인
    expect(firstEffectMql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))

    // 새 query로 matchMedia 호출 확인
    expect(mockMM).toHaveBeenCalledWith('(min-width: 1024px)')
  })

  it('BREAKPOINTS.lg와 함께 사용 시 정상 동작한다', () => {
    const mockMM = createMockMatchMedia(true)
    Object.defineProperty(window, 'matchMedia', { writable: true, value: mockMM })

    const { result } = renderHook(() => useMediaQuery(BREAKPOINTS.lg))

    expect(result.current).toBe(true)
    expect(mockMM).toHaveBeenCalledWith('(min-width: 1024px)')
  })
})
