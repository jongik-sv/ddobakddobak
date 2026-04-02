import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// apiClient mock
vi.mock('../api/client', () => ({
  apiClient: {
    get: vi.fn().mockReturnValue({
      json: vi.fn().mockResolvedValue({ duration: 10 }),
      blob: vi.fn().mockResolvedValue(new Blob(['fake audio'], { type: 'audio/webm' })),
      headers: { get: vi.fn() },
    }),
  },
}))

vi.mock('../lib/download', () => ({
  downloadBlob: vi.fn(),
}))

import { useAudioPlayer } from './useAudioPlayer'

describe('useAudioPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('초기 상태: isReady=false, isPlaying=false, currentTimeMs=0', () => {
    const { result } = renderHook(() => useAudioPlayer(1))

    expect(result.current.isReady).toBe(false)
    expect(result.current.isPlaying).toBe(false)
    expect(result.current.currentTimeMs).toBe(0)
  })

  it('반환 값에 isReady, isPlaying, currentTimeMs, play, pause, seekTo가 포함됨', () => {
    const { result } = renderHook(() => useAudioPlayer(1))

    expect(result.current).toHaveProperty('isReady')
    expect(result.current).toHaveProperty('isPlaying')
    expect(result.current).toHaveProperty('currentTimeMs')
    expect(result.current).toHaveProperty('play')
    expect(result.current).toHaveProperty('pause')
    expect(result.current).toHaveProperty('seekTo')
  })

  it('반환 값에 hasAudio, durationMs, playbackRate, setPlaybackRate, download가 포함됨', () => {
    const { result } = renderHook(() => useAudioPlayer(1))

    expect(result.current).toHaveProperty('hasAudio')
    expect(result.current).toHaveProperty('durationMs')
    expect(result.current).toHaveProperty('playbackRate')
    expect(result.current).toHaveProperty('setPlaybackRate')
    expect(result.current).toHaveProperty('download')
  })

  it('play, pause, seekTo가 함수이다', () => {
    const { result } = renderHook(() => useAudioPlayer(1))

    expect(typeof result.current.play).toBe('function')
    expect(typeof result.current.pause).toBe('function')
    expect(typeof result.current.seekTo).toBe('function')
  })

  it('meetingId 변경 시 상태 리셋', () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: number }) => useAudioPlayer(id),
      { initialProps: { id: 1 } }
    )

    rerender({ id: 2 })
    // 새 meetingId로 변경 시 초기화됨
    expect(result.current.isReady).toBe(false)
    expect(result.current.isPlaying).toBe(false)
    expect(result.current.currentTimeMs).toBe(0)
  })

  it('초기 playbackRate가 1이다', () => {
    const { result } = renderHook(() => useAudioPlayer(1))
    expect(result.current.playbackRate).toBe(1)
  })
})
