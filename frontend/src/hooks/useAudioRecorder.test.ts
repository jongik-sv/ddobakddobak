import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAudioRecorder } from './useAudioRecorder'

// ──────────────────────────────────────────────
// Mock objects (shared across tests)
// ──────────────────────────────────────────────

const mockTrack = { stop: vi.fn() }
const mockStream = { getTracks: vi.fn(() => [mockTrack]) }

const mockPort = {
  onmessage: null as ((e: MessageEvent) => void) | null,
  postMessage: vi.fn(),
}

const mockWorkletNode = {
  port: mockPort,
  disconnect: vi.fn(),
}

const mockSource = { connect: vi.fn() }

const mockAudioWorklet = { addModule: vi.fn() }

const mockAudioContext = {
  audioWorklet: mockAudioWorklet,
  createMediaStreamSource: vi.fn(),
  close: vi.fn(),
  sampleRate: 16000,
}

const mockMediaRecorder = {
  state: 'inactive' as string,
  ondataavailable: null as ((e: { data: Blob }) => void) | null,
  onstop: null as (() => void) | null,
  start: vi.fn(() => { mockMediaRecorder.state = 'recording' }),
  stop: vi.fn(() => {
    mockMediaRecorder.state = 'inactive'
    mockMediaRecorder.onstop?.()
  }),
}

// 생성자 mock은 반드시 일반 function 사용 (arrow function 불가)
function MockAudioContextCtor() { return mockAudioContext }
function MockAudioWorkletNodeCtor() { return mockWorkletNode }
function MockMediaRecorderCtor() { return mockMediaRecorder }
Object.defineProperty(MockMediaRecorderCtor, 'isTypeSupported', {
  value: vi.fn(() => true),
  configurable: true,
})

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('useAudioRecorder', () => {
  let callbacks: { onChunk: ReturnType<typeof vi.fn>; onStop: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    // 상태 리셋
    mockMediaRecorder.state = 'inactive'
    mockMediaRecorder.onstop = null
    mockMediaRecorder.ondataavailable = null
    mockPort.onmessage = null
    mockPort.postMessage.mockReset()

    // 구현 재설정
    mockAudioWorklet.addModule.mockReset().mockResolvedValue(undefined)
    mockAudioContext.createMediaStreamSource.mockReset().mockReturnValue(mockSource)
    mockSource.connect.mockReset()
    mockWorkletNode.disconnect.mockReset()
    mockAudioContext.close.mockReset()
    mockTrack.stop.mockReset()
    mockMediaRecorder.start.mockReset().mockImplementation(() => { mockMediaRecorder.state = 'recording' })
    mockMediaRecorder.stop.mockReset().mockImplementation(() => {
      mockMediaRecorder.state = 'inactive'
      mockMediaRecorder.onstop?.()
    })

    callbacks = { onChunk: vi.fn(), onStop: vi.fn() }

    const AudioContextSpy = vi.fn().mockImplementation(MockAudioContextCtor)
    const AudioWorkletNodeSpy = vi.fn().mockImplementation(MockAudioWorkletNodeCtor)
    const MediaRecorderSpy = vi.fn().mockImplementation(MockMediaRecorderCtor)
    Object.defineProperty(MediaRecorderSpy, 'isTypeSupported', {
      value: vi.fn(() => true),
      configurable: true,
    })

    vi.stubGlobal('AudioContext', AudioContextSpy)
    vi.stubGlobal('AudioWorkletNode', AudioWorkletNodeSpy)
    vi.stubGlobal('MediaRecorder', MediaRecorderSpy)

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue(mockStream),
        },
      },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('초기 상태: isRecording=false, error=null', () => {
    const { result } = renderHook(() => useAudioRecorder(callbacks))
    expect(result.current.isRecording).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('start() 호출 시 마이크 권한 요청', async () => {
    const { result } = renderHook(() => useAudioRecorder(callbacks))
    await act(async () => { await result.current.start() })
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true })
  })

  it('start() 성공 후 isRecording=true', async () => {
    const { result } = renderHook(() => useAudioRecorder(callbacks))
    await act(async () => { await result.current.start() })
    expect(result.current.isRecording).toBe(true)
  })

  it('start() 후 AudioContext가 16kHz로 생성됨', async () => {
    const { result } = renderHook(() => useAudioRecorder(callbacks))
    await act(async () => { await result.current.start() })
    expect(AudioContext).toHaveBeenCalledWith({ sampleRate: 16000 })
  })

  it('start() 후 AudioWorklet 모듈 등록', async () => {
    const { result } = renderHook(() => useAudioRecorder(callbacks))
    await act(async () => { await result.current.start() })
    expect(mockAudioWorklet.addModule).toHaveBeenCalledWith('/audio-processor.js')
  })

  it('stop() 후 isRecording=false', async () => {
    const { result } = renderHook(() => useAudioRecorder(callbacks))
    await act(async () => { await result.current.start() })
    act(() => { result.current.stop() })
    expect(result.current.isRecording).toBe(false)
  })

  it('worklet 메시지 수신 시 onChunk 콜백 호출', async () => {
    const { result } = renderHook(() => useAudioRecorder(callbacks))
    await act(async () => { await result.current.start() })

    const testData = new Int16Array([100, 200, 300])
    act(() => {
      mockPort.onmessage?.({ data: testData } as MessageEvent)
    })

    expect(callbacks.onChunk).toHaveBeenCalledWith(testData)
  })

  it('stop() 시 onStop(Blob) 콜백 호출', async () => {
    const { result } = renderHook(() => useAudioRecorder(callbacks))
    await act(async () => { await result.current.start() })
    act(() => { result.current.stop() })
    expect(callbacks.onStop).toHaveBeenCalledWith(expect.any(Blob))
  })

  it('getUserMedia 실패 시 error 설정, isRecording=false 유지', async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
      new Error('Permission denied')
    )
    const { result } = renderHook(() => useAudioRecorder(callbacks))
    await act(async () => { await result.current.start() })
    expect(result.current.error).toBe('Permission denied')
    expect(result.current.isRecording).toBe(false)
  })

  it('stop() 시 스트림 트랙 중지', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useAudioRecorder(callbacks))
    await act(async () => { await result.current.start() })
    act(() => { result.current.stop() })
    act(() => { vi.runAllTimers() })
    expect(mockTrack.stop).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('stop() 시 worklet에 flush 메시지 전송', async () => {
    const { result } = renderHook(() => useAudioRecorder(callbacks))
    await act(async () => { await result.current.start() })
    act(() => { result.current.stop() })
    expect(mockPort.postMessage).toHaveBeenCalledWith({ type: 'flush' })
  })
})
