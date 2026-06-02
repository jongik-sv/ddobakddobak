import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// useMicCapture: 전달받은 onChunk 콜백을 캡처한다(워크릿이 (pcm, meta)로 호출하는 그 핸들러).
let capturedOnChunk: ((pcm: Int16Array, meta?: { sequence: number; offsetMs: number }) => void) | null = null
const micStart = vi.fn((..._a: unknown[]) => Promise.resolve())
vi.mock('./useMicCapture', () => ({
  useMicCapture: (cbs: { onChunk: (pcm: Int16Array, meta?: unknown) => void }) => {
    capturedOnChunk = cbs.onChunk as typeof capturedOnChunk
    return {
      isCapturing: false,
      error: null,
      start: (...a: unknown[]) => micStart(...a),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      feedSystemAudio: vi.fn(),
    }
  },
}))

// useLocalStt: sendChunk 스파이.
const sendChunk = vi.fn((..._a: unknown[]) => {})
vi.mock('./useLocalStt', () => ({
  useLocalStt: () => ({ sendChunk: (...a: unknown[]) => sendChunk(...a), flush: vi.fn() }),
}))

vi.mock('../stt/localStore', () => ({
  getLocal: vi.fn().mockResolvedValue({ meta: { title: 't', status: 'idle' }, segments: [] }),
  setStatus: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../stt/syncQueue', () => ({ flushAll: vi.fn().mockResolvedValue(undefined) }))

const invokeMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }))

import { useLocalRecording } from './useLocalRecording'

beforeEach(() => {
  capturedOnChunk = null
  sendChunk.mockClear()
  micStart.mockClear()
  invokeMock.mockClear()
  invokeMock.mockResolvedValue(undefined)
})

describe('useLocalRecording — 마이크 청크 → 로컬 STT 전파', () => {
  it('onChunk의 meta(offsetMs)를 localStt.sendChunk로 그대로 넘긴다(타임스탬프 보존)', async () => {
    renderHook(() => useLocalRecording('local-abc', 'ko', '/m'))
    // 초기 getLocal useEffect 정착(act 경고 억제).
    await act(async () => {})

    expect(capturedOnChunk).toBeTypeOf('function')

    const pcm = new Int16Array([1, 2, 3])
    const meta = { sequence: 4, offsetMs: 12345 }
    capturedOnChunk!(pcm, meta)

    // 버그: useLocalRecording이 sendChunk(pcm)만 호출 → meta 유실 → started_at_ms=0 → 전부 00:00.
    expect(sendChunk).toHaveBeenCalledTimes(1)
    expect(sendChunk).toHaveBeenCalledWith(pcm, meta)
  })

  it('start()를 빠르게 두 번 호출해도 mic.start는 한 번만 실행된다(재진입 가드)', async () => {
    // 실증 버그: 모델 콜드로드(stt_load) await 중 status가 아직 recording이 아니라
    // 사용자가 시작을 또 누르면 두 번째 start()가 재진입 → mic 파이프라인 2벌 동시 가동(중복 전사).
    const { result } = renderHook(() => useLocalRecording('local-abc', 'ko', '/m'))
    await act(async () => {})

    await act(async () => {
      void result.current.start()
      void result.current.start()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(micStart).toHaveBeenCalledTimes(1)
  })
})

describe('useLocalRecording — 모델 선로딩(modelLoading)', () => {
  it('modelDir 확정 시 stt_load를 dir당 1회 호출하고 modelLoading을 토글한다', async () => {
    let resolveLoad: (() => void) | null = null
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'stt_load') return new Promise<void>((r) => { resolveLoad = () => r() })
      return Promise.resolve()
    })

    const { result } = renderHook(() => useLocalRecording('local-abc', 'ko', '/m'))
    // 초기 getLocal 정착.
    await act(async () => {})

    // 선로딩 중: modelLoading=true.
    await waitFor(() => expect(result.current.modelLoading).toBe(true))
    const loadCalls = invokeMock.mock.calls.filter((c) => c[0] === 'stt_load')
    expect(loadCalls).toHaveLength(1)

    // 로드 완료 → modelLoading=false.
    await act(async () => { resolveLoad?.(); await Promise.resolve() })
    await waitFor(() => expect(result.current.modelLoading).toBe(false))
  })

  it('선로딩된 dir에서 재렌더해도 stt_load 추가 호출 없음(dir당 1회 가드)', async () => {
    const { rerender } = renderHook(
      ({ dir }: { dir: string }) => useLocalRecording('local-abc', 'ko', dir),
      { initialProps: { dir: '/m' } },
    )
    await act(async () => {})
    await waitFor(() =>
      expect(invokeMock.mock.calls.filter((c) => c[0] === 'stt_load')).toHaveLength(1),
    )

    rerender({ dir: '/m' })
    await act(async () => {})
    // 같은 dir → 추가 호출 없음.
    expect(invokeMock.mock.calls.filter((c) => c[0] === 'stt_load')).toHaveLength(1)
  })

  it('선로딩 후 start()는 mic 파이프라인을 1벌만 가동한다(선로딩과 무관)', async () => {
    const { result } = renderHook(() => useLocalRecording('local-abc', 'ko', '/m'))
    await act(async () => {})
    // 선로딩 1회 완료 대기.
    await waitFor(() =>
      expect(invokeMock.mock.calls.filter((c) => c[0] === 'stt_load')).toHaveLength(1),
    )

    // start()는 stt_load 멱등이라 빠른 no-op이지만, start 내부에서도 한 번 더 호출되긴 한다.
    // 핵심 회귀가드: start가 선로딩과 별개로 mic 파이프라인을 1벌만 가동.
    await act(async () => { await result.current.start() })
    expect(micStart).toHaveBeenCalledTimes(1)
  })
})
