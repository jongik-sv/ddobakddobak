import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useRef } from 'react'

// WaveSurfer.js를 브라우저 전용 라이브러리이므로 vi.mock으로 모킹
const mockWaveSurfer = {
  on: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  seekTo: vi.fn(),
  getDuration: vi.fn(() => 10),
  destroy: vi.fn(),
  isPlaying: vi.fn(() => false),
}

vi.mock('wavesurfer.js', () => ({
  default: {
    create: vi.fn(() => mockWaveSurfer),
  },
}))

// fetch mock for audio blob URL
const mockBlobUrl = 'blob:mock-url'
const mockBlob = new Blob(['fake audio'], { type: 'audio/webm' })

// apiClient mock
vi.mock('../api/client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['fake audio'], { type: 'audio/webm' })),
    }),
  },
}))

import { useAudioPlayer } from './useAudioPlayer'

/**
 * ref가 DOM 요소에 연결된 renderHook 래퍼
 * waveformRef.current가 실제 HTMLDivElement를 가리키도록 설정
 */
function renderAudioPlayerHook(meetingId: number) {
  const container = document.createElement('div')
  document.body.appendChild(container)

  const result = renderHook(() => {
    const ref = useRef<HTMLDivElement>(null)
    // ref.current를 실제 DOM 요소로 설정
    ;(ref as React.MutableRefObject<HTMLDivElement>).current = container
    return useAudioPlayer(meetingId, ref)
  })

  return { ...result, container }
}

// React import for type
import type React from 'react'

describe('useAudioPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWaveSurfer.getDuration.mockReturnValue(10)
    mockWaveSurfer.isPlaying.mockReturnValue(false)

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => mockBlobUrl),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    // DOM 정리
    document.body.innerHTML = ''
  })

  it('초기 상태: isReady=false, isPlaying=false, currentTimeMs=0', () => {
    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(null)
      return useAudioPlayer(1, ref)
    })

    expect(result.current.isReady).toBe(false)
    expect(result.current.isPlaying).toBe(false)
    expect(result.current.currentTimeMs).toBe(0)
  })

  it('play() 호출 시 wavesurfer.play() 실행', async () => {
    const { result } = renderAudioPlayerHook(1)

    // WaveSurfer가 초기화될 때까지 대기
    await waitFor(() => {
      expect(mockWaveSurfer.on).toHaveBeenCalled()
    })

    act(() => {
      result.current.play()
    })

    expect(mockWaveSurfer.play).toHaveBeenCalled()
  })

  it('pause() 호출 시 wavesurfer.pause() 실행', async () => {
    const { result } = renderAudioPlayerHook(1)

    await waitFor(() => {
      expect(mockWaveSurfer.on).toHaveBeenCalled()
    })

    act(() => {
      result.current.pause()
    })

    expect(mockWaveSurfer.pause).toHaveBeenCalled()
  })

  it('seekTo(ms) 호출 시 wavesurfer.seekTo(ms/duration) 실행', async () => {
    const { result } = renderAudioPlayerHook(1)

    await waitFor(() => {
      expect(mockWaveSurfer.on).toHaveBeenCalled()
    })

    // duration = 10초, seekTo(5000ms) → 5000/(10*1000) = 0.5
    act(() => {
      result.current.seekTo(5000)
    })

    expect(mockWaveSurfer.seekTo).toHaveBeenCalledWith(0.5)
  })

  it('seekTo(0) 호출 시 wavesurfer.seekTo(0) 실행', async () => {
    const { result } = renderAudioPlayerHook(1)

    await waitFor(() => {
      expect(mockWaveSurfer.on).toHaveBeenCalled()
    })

    act(() => {
      result.current.seekTo(0)
    })

    expect(mockWaveSurfer.seekTo).toHaveBeenCalledWith(0)
  })

  it('반환 값에 isReady, isPlaying, currentTimeMs, play, pause, seekTo가 포함됨', () => {
    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(null)
      return useAudioPlayer(1, ref)
    })

    expect(result.current).toHaveProperty('isReady')
    expect(result.current).toHaveProperty('isPlaying')
    expect(result.current).toHaveProperty('currentTimeMs')
    expect(result.current).toHaveProperty('play')
    expect(result.current).toHaveProperty('pause')
    expect(result.current).toHaveProperty('seekTo')
  })
})
