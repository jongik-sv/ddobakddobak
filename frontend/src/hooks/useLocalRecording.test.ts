import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// useMicCapture: 전달받은 onChunk 콜백을 캡처한다(워크릿이 (pcm, meta)로 호출하는 그 핸들러).
let capturedOnChunk: ((pcm: Int16Array, meta?: { sequence: number; offsetMs: number }) => void) | null = null
const micStart = vi.fn((..._a: unknown[]) => Promise.resolve())
const micStop = vi.fn()
const micPause = vi.fn()
const micResume = vi.fn()
vi.mock('./useMicCapture', () => ({
  useMicCapture: (cbs: { onChunk: (pcm: Int16Array, meta?: unknown) => void }) => {
    capturedOnChunk = cbs.onChunk as typeof capturedOnChunk
    return {
      isCapturing: false,
      error: null,
      start: (...a: unknown[]) => micStart(...a),
      stop: (...a: unknown[]) => micStop(...a),
      pause: (...a: unknown[]) => micPause(...a),
      resume: (...a: unknown[]) => micResume(...a),
      feedSystemAudio: vi.fn(),
    }
  },
}))

// useLocalStt: sendChunk + seedSeq(이어녹음 시드) 스파이.
const sendChunk = vi.fn((..._a: unknown[]) => {})
const seedSeq = vi.fn((..._a: unknown[]) => {})
vi.mock('./useLocalStt', () => ({
  useLocalStt: () => ({
    sendChunk: (...a: unknown[]) => sendChunk(...a),
    flush: vi.fn().mockResolvedValue(undefined),
    seedSeq: (...a: unknown[]) => seedSeq(...a),
  }),
}))

const getLocalMock = vi.fn().mockResolvedValue({ meta: { title: 't', status: 'idle' }, segments: [] })
vi.mock('../stt/localStore', () => ({
  getLocal: (...a: unknown[]) => getLocalMock(...a),
  setStatus: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../stt/syncQueue', () => ({ flushAll: vi.fn().mockResolvedValue(undefined) }))

const invokeMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }))

import { useLocalRecording } from './useLocalRecording'

beforeEach(() => {
  capturedOnChunk = null
  sendChunk.mockClear()
  seedSeq.mockClear()
  micStart.mockClear()
  micStop.mockClear()
  micPause.mockClear()
  micResume.mockClear()
  getLocalMock.mockClear()
  getLocalMock.mockResolvedValue({ meta: { title: 't', status: 'idle' }, segments: [] })
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

  it('start() 진행 중 starting=true → 완료 후 false (회의 시작 버튼 스피너)', async () => {
    // mic.start를 보류시켜 start() 콜드로드/기동 구간을 관찰.
    let resolveMic: (() => void) | null = null
    micStart.mockImplementationOnce(() => new Promise<void>((r) => { resolveMic = () => r() }))

    const { result } = renderHook(() => useLocalRecording('local-abc', 'ko', '/m'))
    await act(async () => {})
    // 선로딩 끝나 modelLoading=false인 상태에서 시작.
    await waitFor(() => expect(result.current.modelLoading).toBe(false))

    let startPromise: Promise<void> | undefined
    await act(async () => { startPromise = result.current.start(); await Promise.resolve() })
    // mic 기동 대기 중 → starting=true(버튼 비활성+스피너).
    await waitFor(() => expect(result.current.starting).toBe(true))

    await act(async () => { resolveMic?.(); await startPromise })
    // 녹음 시작 → starting=false.
    await waitFor(() => expect(result.current.starting).toBe(false))
    expect(result.current.isRecording).toBe(true)
  })
})

describe('useLocalRecording — 일시정지/재개(pause/resume)', () => {
  it('pause()는 mic.pause를 호출하고 status=paused(isPaused=true, isRecording 유지)', async () => {
    const { result } = renderHook(() => useLocalRecording('local-abc', 'ko', '/m'))
    await act(async () => {})
    await waitFor(() => expect(result.current.modelLoading).toBe(false))

    await act(async () => { await result.current.start() })
    expect(result.current.isRecording).toBe(true)
    expect(result.current.isPaused).toBe(false)

    await act(async () => { result.current.pause() })
    expect(micPause).toHaveBeenCalledTimes(1)
    expect(result.current.isPaused).toBe(true)
    // 일시정지 중에도 녹음 컨트롤(일시정지/재개/종료)을 유지해야 하므로 isRecording=true.
    expect(result.current.isRecording).toBe(true)
  })

  it('resume()는 mic.resume를 호출하고 status=recording 복귀(isPaused=false)', async () => {
    const { result } = renderHook(() => useLocalRecording('local-abc', 'ko', '/m'))
    await act(async () => {})
    await waitFor(() => expect(result.current.modelLoading).toBe(false))
    await act(async () => { await result.current.start() })
    await act(async () => { result.current.pause() })
    expect(result.current.isPaused).toBe(true)

    await act(async () => { result.current.resume() })
    expect(micResume).toHaveBeenCalledTimes(1)
    expect(result.current.isPaused).toBe(false)
    expect(result.current.isRecording).toBe(true)
  })
})

describe('useLocalRecording — 이어녹음 타임라인/seq 연속(bug3)', () => {
  it('기존 세그먼트가 있으면 start()가 max(ended_at_ms)/max(seq)+1로 이어간다', async () => {
    // 이전 세션 결과(2건): 마지막 ended_at_ms=30000, 최대 seq=1.
    getLocalMock.mockResolvedValue({
      meta: { title: 't', status: 'completed' },
      segments: [
        { id: 0, sequence_number: 0, started_at_ms: 0, ended_at_ms: 5000 },
        { id: 1, sequence_number: 1, started_at_ms: 20000, ended_at_ms: 30000 },
      ],
    })

    const { result } = renderHook(() => useLocalRecording('local-abc', 'ko', '/m'))
    await act(async () => {})
    await waitFor(() => expect(result.current.modelLoading).toBe(false))

    await act(async () => { await result.current.start() })

    // mic.start(baseOffsetMs, baseSeq) — 0,0이 아니라 30000, 2로 이어간다(타임라인 0리셋/seq충돌 방지).
    expect(micStart).toHaveBeenCalledWith(30000, 2)
    // useLocalStt seqRef도 2로 시드(audio/<seq>.wav 덮어쓰기 방지).
    expect(seedSeq).toHaveBeenCalledWith(2)
  })

  it('세그먼트가 없으면(신규) 0,0으로 시작', async () => {
    const { result } = renderHook(() => useLocalRecording('local-new', 'ko', '/m'))
    await act(async () => {})
    await waitFor(() => expect(result.current.modelLoading).toBe(false))

    await act(async () => { await result.current.start() })

    expect(micStart).toHaveBeenCalledWith(0, 0)
    expect(seedSeq).toHaveBeenCalledWith(0)
  })
})
