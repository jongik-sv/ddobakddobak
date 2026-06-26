import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// localStore.mergeLocalAudio 스파이.
const mergeLocalAudio = vi.fn()
vi.mock('../stt/localStore', () => ({
  mergeLocalAudio: (...a: unknown[]) => mergeLocalAudio(...a),
}))

// lib/download의 downloadBlob 스파이.
const downloadBlob = vi.fn().mockResolvedValue(undefined)
vi.mock('../lib/download', () => ({
  downloadBlob: (...a: unknown[]) => downloadBlob(...a),
}))

import { useLocalAudioPlayer } from './useLocalAudioPlayer'

const createObjectURL = vi.fn(() => 'blob:mock-url')
const revokeObjectURL = vi.fn()

// HTMLMediaElement는 jsdom에서 play/pause/load 미구현 + blob src에서 loadedmetadata 미발화.
// currentTime setter를 가로채 seekToSegment 검증에 쓴다.
let lastCurrentTime = 0

beforeEach(() => {
  vi.clearAllMocks()
  lastCurrentTime = 0
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
  Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  })
  Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(window.HTMLMediaElement.prototype, 'load', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
    configurable: true,
    get: () => lastCurrentTime,
    set: (v: number) => { lastCurrentTime = v },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useLocalAudioPlayer', () => {
  it('AudioPlayerResult 인터페이스 + 오프라인 확장(segmentOffsetsMs, seekToSegment)을 노출', () => {
    mergeLocalAudio.mockResolvedValue(null)
    const { result } = renderHook(() => useLocalAudioPlayer('local-x', '제목'))
    for (const k of [
      'isReady', 'isPlaying', 'hasAudio', 'audioLoaded', 'srcReady',
      'currentTimeMs', 'durationMs', 'playbackRate',
      'play', 'pause', 'seekTo', 'setPlaybackRate', 'download',
    ]) {
      expect(result.current).toHaveProperty(k)
    }
    expect(result.current).toHaveProperty('segmentOffsetsMs')
    expect(typeof result.current.seekToSegment).toBe('function')
  })

  it('mergeLocalAudio 성공 → hasAudio/isReady=true, durationMs 세팅, objectURL 생성', async () => {
    mergeLocalAudio.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3, 4]),
      segmentOffsetsMs: [0, 1000],
      durationMs: 1500,
    })
    const { result } = renderHook(() => useLocalAudioPlayer('local-x', '제목'))

    await waitFor(() => expect(result.current.hasAudio).toBe(true))
    expect(result.current.isReady).toBe(true)
    expect(result.current.durationMs).toBe(1500)
    expect(result.current.segmentOffsetsMs).toEqual([0, 1000])
    expect(createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('오디오 없음(null) → isReady=true, hasAudio=false', async () => {
    mergeLocalAudio.mockResolvedValue(null)
    const { result } = renderHook(() => useLocalAudioPlayer('local-x', '제목'))
    await waitFor(() => expect(result.current.isReady).toBe(true))
    expect(result.current.hasAudio).toBe(false)
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('seekToSegment(i)가 audio.currentTime을 offsets[i]/1000으로 세팅', async () => {
    mergeLocalAudio.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3, 4]),
      segmentOffsetsMs: [0, 1000, 2500],
      durationMs: 3000,
    })
    const { result } = renderHook(() => useLocalAudioPlayer('local-x', '제목'))
    await waitFor(() => expect(result.current.hasAudio).toBe(true))

    act(() => { result.current.seekToSegment(2) })
    expect(lastCurrentTime).toBe(2.5) // 2500ms / 1000
  })

  it('download()가 인자 없이 호출되면 `${title}.wav`로 downloadBlob', async () => {
    mergeLocalAudio.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3, 4]),
      segmentOffsetsMs: [0],
      durationMs: 1000,
    })
    const { result } = renderHook(() => useLocalAudioPlayer('local-x', '내 회의'))
    await waitFor(() => expect(result.current.hasAudio).toBe(true))

    await act(async () => { await result.current.download() })
    const [blob, filename] = downloadBlob.mock.calls[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(filename).toBe('내 회의.wav')
  })

  it('언마운트 시 objectURL revoke', async () => {
    mergeLocalAudio.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3, 4]),
      segmentOffsetsMs: [0],
      durationMs: 1000,
    })
    const { result, unmount } = renderHook(() => useLocalAudioPlayer('local-x', '제목'))
    await waitFor(() => expect(result.current.hasAudio).toBe(true))
    unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })
})
