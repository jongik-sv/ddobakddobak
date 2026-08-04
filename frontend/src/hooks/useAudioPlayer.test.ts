import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// apiClient mock
vi.mock('../api/client', () => {
  const apiClient = {
    get: vi.fn().mockReturnValue({
      json: vi.fn().mockResolvedValue({ duration: 10 }),
      blob: vi.fn().mockResolvedValue(new Blob(['fake audio'], { type: 'audio/webm' })),
      headers: { get: vi.fn() },
    }),
  }
  return {
    apiClient,
    default: apiClient,
    getAuthHeaders: vi.fn().mockReturnValue({}),
  }
})

vi.mock('../lib/download', () => ({
  downloadBlob: vi.fn(),
}))

import { useAudioPlayer } from './useAudioPlayer'

describe('useAudioPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['fake audio'], { type: 'audio/webm' })),
    }))
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

  it('audioVersion이 바뀌면 새 URL로 오디오를 다시 받는다 (절단 후 옛 오디오 재생 방지)', async () => {
    const { rerender } = renderHook(({ v }: { v: number }) => useAudioPlayer(1, v), {
      initialProps: { v: 0 },
    })

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const firstUrls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(firstUrls.some((u) => u.includes('?v='))).toBe(false)

    rerender({ v: 1 })

    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/meetings/1/audio?v=1'))).toBe(true)
  })

  it('audioVersion이 그대로면 재요청하지 않는다', () => {
    const { rerender } = renderHook(({ v }: { v: number }) => useAudioPlayer(1, v), {
      initialProps: { v: 2 },
    })
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    const before = fetchMock.mock.calls.length

    rerender({ v: 2 })

    expect(fetchMock.mock.calls.length).toBe(before)
  })

  // ── MAJOR 회귀: <audio src>만 버전 토큰을 받고 download()·peaks fetch는 무버전 URL을
  // 그대로 썼다. Tauri/Android WebView·Caddy 리버스 프록시처럼 URL만 보고 캐싱하는 계층이
  // 하나라도 있으면 다운로드 버튼·파형이 절단 전 기밀 오디오/파형을 계속 서빙한다.
  it('download()도 audioVersion을 URL에 붙인다(다운로드가 캐시된 절단 전 오디오를 받지 않도록)', async () => {
    const { apiClient } = await import('../api/client')
    const { result } = renderHook(() => useAudioPlayer(1, 3))

    await result.current.download()

    const getMock = apiClient.get as unknown as ReturnType<typeof vi.fn>
    const urls = getMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('meetings/1/audio?v=3'))).toBe(true)
  })

  it('download()는 audioVersion이 0이면(기본값) 기존 URL 그대로다(하위호환)', async () => {
    const { apiClient } = await import('../api/client')
    const { result } = renderHook(() => useAudioPlayer(1))

    await result.current.download()

    const getMock = apiClient.get as unknown as ReturnType<typeof vi.fn>
    const urls = getMock.mock.calls.map((c) => String(c[0]))
    expect(urls).toContain('meetings/1/audio')
  })

  it('peaks 요청도 audioVersion을 URL에 붙인다(파형이 캐시된 절단 전 값을 보여주지 않도록)', async () => {
    const { apiClient } = await import('../api/client')
    renderHook(() => useAudioPlayer(1, 5))

    const getMock = apiClient.get as unknown as ReturnType<typeof vi.fn>
    const urls = getMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('meetings/1/peaks?v=5'))).toBe(true)
  })
})
