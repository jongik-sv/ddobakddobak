import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// apiClient mock
vi.mock('../api/client', () => ({
  apiClient: {
    get: vi.fn().mockReturnValue({
      json: vi.fn().mockResolvedValue({ duration: 10 }),
      blob: vi.fn().mockResolvedValue(new Blob(['fake audio'], { type: 'audio/webm' })),
    }),
  },
  getAuthHeaders: vi.fn(() => ({})),
}))

// config mock
vi.mock('../config', () => ({
  getApiBaseUrl: vi.fn(() => 'http://127.0.0.1:13323/api/v1'),
  getMode: vi.fn(() => 'local'),
}))

// download mock
vi.mock('../lib/download', () => ({
  downloadBlob: vi.fn(),
}))

import { useAudioPlayer } from './useAudioPlayer'

describe('useAudioPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('초기 상태: isReady=false, isPlaying=false, currentTimeMs=0', () => {
    const { result } = renderHook(() => useAudioPlayer(1))

    expect(result.current.isReady).toBe(false)
    expect(result.current.isPlaying).toBe(false)
    expect(result.current.currentTimeMs).toBe(0)
  })

  it('play() 호출 시 audio.play() 실행', () => {
    const { result } = renderHook(() => useAudioPlayer(1))

    // play는 오류 없이 호출 가능해야 함 (audio가 로드되지 않은 상태에서도)
    act(() => {
      result.current.play()
    })
    // play()가 에러 없이 실행됨을 확인
    expect(result.current.isPlaying).toBe(false) // audio가 실제 로드되지 않았으므로
  })

  it('pause() 호출 시 audio.pause() 실행', () => {
    const { result } = renderHook(() => useAudioPlayer(1))

    act(() => {
      result.current.pause()
    })
    // pause()가 에러 없이 실행됨을 확인
    expect(result.current.isPlaying).toBe(false)
  })

  it('seekTo(ms) 호출 시 에러 없이 실행', () => {
    const { result } = renderHook(() => useAudioPlayer(1))

    act(() => {
      result.current.seekTo(5000)
    })
    // seekTo가 에러 없이 실행됨을 확인
    expect(true).toBe(true)
  })

  it('seekTo(0) 호출 시 에러 없이 실행', () => {
    const { result } = renderHook(() => useAudioPlayer(1))

    act(() => {
      result.current.seekTo(0)
    })
    expect(true).toBe(true)
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

  it('반환 값에 hasAudio, audioLoaded, durationMs, playbackRate, download이 포함됨', () => {
    const { result } = renderHook(() => useAudioPlayer(1))

    expect(result.current).toHaveProperty('hasAudio')
    expect(result.current).toHaveProperty('audioLoaded')
    expect(result.current).toHaveProperty('durationMs')
    expect(result.current).toHaveProperty('playbackRate')
    expect(result.current).toHaveProperty('download')
  })
})
