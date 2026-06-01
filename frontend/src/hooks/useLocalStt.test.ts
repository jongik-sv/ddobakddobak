import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// invoke: stt_load → ok, stt_transcribe → 고정 텍스트.
const invokeMock = vi.fn((cmd: string, _args?: unknown): Promise<unknown> => {
  if (cmd === 'stt_transcribe') return Promise.resolve('안녕하세요 테스트')
  return Promise.resolve(undefined)
})
vi.mock('@tauri-apps/api/core', () => ({ invoke: (c: string, a?: unknown) => invokeMock(c, a) }))

const appendSegment = vi.fn((..._a: unknown[]): Promise<void> => Promise.resolve())
const appendAudio = vi.fn((..._a: unknown[]): Promise<void> => Promise.resolve())
vi.mock('../stt/localStore', () => ({
  appendSegment: (...a: unknown[]) => appendSegment(...a),
  appendAudio: (...a: unknown[]) => appendAudio(...a),
}))

const syncEnqueue = vi.fn((..._a: unknown[]) => {})
vi.mock('../stt/syncQueue', () => ({ enqueue: (...a: unknown[]) => syncEnqueue(...a) }))

import { useLocalStt } from './useLocalStt'
import { useTranscriptStore } from '../stores/transcriptStore'

beforeEach(() => {
  invokeMock.mockClear()
  appendSegment.mockClear()
  appendAudio.mockClear()
  syncEnqueue.mockClear()
  useTranscriptStore.getState().reset()
})

/** 발화처럼 보이는(RMS > 0.015) 짧은 PCM16 청크 생성 — audio-processor가 잘라낸 단일 발화 모사. */
function utteranceChunk(samples = 16000): Int16Array {
  const pcm = new Int16Array(samples)
  for (let i = 0; i < samples; i++) pcm[i] = Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / 16000))
  return pcm
}

describe('useLocalStt — pre-segmented 청크 직접 전사(재-VAD 없음)', () => {
  it('단일 짧은 발화 청크가 두 번째 청크를 기다리지 않고 즉시 final로 emit된다', async () => {
    const { result } = renderHook(() =>
      useLocalStt({ localId: 'local-x', language: 'ko', modelDir: '/m', uploadEnabled: false }),
    )

    act(() => {
      result.current.sendChunk(utteranceChunk(16000), { sequence: 0, offsetMs: 0 })
    })

    // 단 하나의 청크만으로 final이 나와야 한다(과거 버그: 다음 청크/flush까지 지연).
    await waitFor(() => {
      expect(useTranscriptStore.getState().finals.length).toBe(1)
    })
    const f = useTranscriptStore.getState().finals[0]
    expect(f.content).toBe('안녕하세요 테스트')
    expect(f.speaker_label).toBe('')
    expect(f.sequence_number).toBe(0)
    expect(invokeMock).toHaveBeenCalledWith('stt_transcribe', expect.anything())
    expect(appendSegment).toHaveBeenCalledTimes(1)
    expect(appendAudio).toHaveBeenCalledTimes(1)
  })

  it('무음(저RMS) 청크는 전사하지 않는다', async () => {
    const { result } = renderHook(() =>
      useLocalStt({ localId: null, language: 'ko', modelDir: '/m', uploadEnabled: false }),
    )
    act(() => {
      result.current.sendChunk(new Int16Array(16000), { sequence: 0, offsetMs: 0 }) // 전부 0 = 무음
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(useTranscriptStore.getState().finals.length).toBe(0)
    expect(invokeMock).not.toHaveBeenCalledWith('stt_transcribe', expect.anything())
  })

  it('modelDir이 null이면 아무 것도 하지 않는다', () => {
    const { result } = renderHook(() =>
      useLocalStt({ localId: 'local-x', language: 'ko', modelDir: null, uploadEnabled: false }),
    )
    act(() => {
      result.current.sendChunk(utteranceChunk(), { sequence: 0, offsetMs: 0 })
    })
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('uploadEnabled면 syncQueue.enqueue 호출', async () => {
    const { result } = renderHook(() =>
      useLocalStt({ localId: 'local-x', language: 'ko', modelDir: '/m', uploadEnabled: true }),
    )
    act(() => {
      result.current.sendChunk(utteranceChunk(), { sequence: 0, offsetMs: 0 })
    })
    await waitFor(() => expect(syncEnqueue).toHaveBeenCalledWith('local-x'))
  })
})
