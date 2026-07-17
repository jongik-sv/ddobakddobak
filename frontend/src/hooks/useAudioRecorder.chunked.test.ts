import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// 모바일 Tauri 환경 강제 → useChunkedRecorder 경로
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  IS_TAURI: true,
  IS_MOBILE: true,
}))

let lastRecorder: FakeMediaRecorder | null = null

class FakeMediaRecorder {
  state = 'inactive'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  stream: unknown
  opts?: unknown
  constructor(stream: unknown, opts?: unknown) {
    this.stream = stream
    this.opts = opts
    lastRecorder = this
  }
  static isTypeSupported() {
    return true
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.onstop?.()
  }
  pause() {
    this.state = 'paused'
  }
  resume() {
    this.state = 'recording'
  }
  emit(data: Blob) {
    this.ondataavailable?.({ data })
  }
}

import { useAudioRecorder } from './useAudioRecorder'

describe('useAudioRecorder 모바일 청크 레코더', () => {
  beforeEach(() => {
    lastRecorder = null
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
      },
      configurable: true,
    })
  })

  it('청크를 seq 순서로 업로드하고 stop 시 마지막 청크 후 finalize한다', async () => {
    const uploaded: number[] = []
    const onAudioChunk = vi.fn(async (_b: Blob, seq: number) => {
      uploaded.push(seq)
    })
    const onFinalize = vi.fn(async () => {})

    const { result } = renderHook(() =>
      useAudioRecorder({ onChunk: vi.fn(), onStop: vi.fn(), onAudioChunk, onFinalize }),
    )

    await act(async () => {
      await result.current.start()
    })
    expect(result.current.isRecording).toBe(true)

    await act(async () => {
      lastRecorder!.emit(new Blob(['aaaa']))
      lastRecorder!.emit(new Blob(['bbbb']))
    })

    await act(async () => {
      result.current.stop()
    })

    await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1))
    expect(uploaded).toEqual([0, 1])
    expect(onAudioChunk).toHaveBeenCalledTimes(2)
  })

  it('빈 청크(size 0)는 업로드하지 않는다', async () => {
    const onAudioChunk = vi.fn()
    const { result } = renderHook(() =>
      useAudioRecorder({ onChunk: vi.fn(), onStop: vi.fn(), onAudioChunk, onFinalize: vi.fn() }),
    )

    await act(async () => {
      await result.current.start()
    })
    await act(async () => {
      lastRecorder!.emit(new Blob([]))
    })

    expect(onAudioChunk).not.toHaveBeenCalled()
  })
})
