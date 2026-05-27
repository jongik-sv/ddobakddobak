import { useState, useRef, useCallback } from 'react'
import { AUDIO, IS_TAURI, IS_MOBILE } from '../config'
import { getEffectiveAudioConfig, loadAppSettings } from '../stores/appSettingsStore'

export interface ChunkMeta {
  sequence: number
  offsetMs: number
}

export interface AudioRecorderCallbacks {
  /** 브라우저 모드에서만 사용: 마이크 VAD 청크 (Tauri 모드에서는 useMicCapture가 담당) */
  onChunk: (pcm: Int16Array, meta: ChunkMeta) => void
  onStop: (blob: Blob) => void
  /** 모바일 청크 레코더 전용: 녹음 중 압축 오디오 청크를 seq별로 연속 업로드 */
  onAudioChunk?: (blob: Blob, sequence: number) => Promise<void> | void
  /** 모바일 청크 레코더 전용: 녹음 종료 시 서버에 청크 합치기/변환 요청 */
  onFinalize?: () => Promise<void> | void
}

export interface AudioRecorderResult {
  isRecording: boolean
  isPaused: boolean
  error: string | null
  start: (baseOffsetMs?: number, baseSeq?: number) => Promise<void>
  stop: () => void
  pause: () => void
  resume: () => void
  /** 브라우저 모드 전용: 시스템 오디오 PCM을 녹음 믹스에 주입 */
  feedSystemAudio: (pcm: Int16Array) => void
}

// ── Tauri 네이티브 녹음 ─────────────────────────────

function useNativeRecorder(callbacks: AudioRecorderCallbacks): AudioRecorderResult {
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  const start = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      console.log('[NativeRecorder] start_recording 호출')
      await invoke('start_recording')
      console.log('[NativeRecorder] start_recording 성공')
      setIsRecording(true)
      setIsPaused(false)
      setError(null)
    } catch (err) {
      console.error('[NativeRecorder] start_recording 실패:', err)
      setError((err as Error).message || String(err))
      setIsRecording(false)
    }
  }, [])

  const stop = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const wavBase64 = (await invoke('stop_recording')) as string

      // base64 → Blob
      const binary = atob(wavBase64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      const blob = new Blob([bytes], { type: 'audio/wav' })
      callbacksRef.current.onStop(blob)
    } catch (err) {
      console.error('[NativeRecorder] stop 실패:', err)
      // 빈 blob이라도 전달하여 플로우 유지
      callbacksRef.current.onStop(new Blob([], { type: 'audio/wav' }))
    }
    setIsRecording(false)
    setIsPaused(false)
  }, [])

  const pause = useCallback(() => {
    // pause_mic_capture가 녹음기도 함께 일시정지
    setIsPaused(true)
  }, [])

  const resume = useCallback(() => {
    setIsPaused(false)
  }, [])

  const feedSystemAudio = useCallback(() => {
    // Tauri 모드에서는 Rust 녹음기가 직접 시스템 오디오를 받으므로 no-op
  }, [])

  return { isRecording, isPaused, error, start, stop, pause, resume, feedSystemAudio }
}

// ── 브라우저 MediaRecorder 녹음 (기존 fallback) ────────

function useBrowserRecorder(callbacks: AudioRecorderCallbacks): AudioRecorderResult {
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const systemInjectorRef = useRef<AudioWorkletNode | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const pausedRef = useRef(false)
  const chunkSeqRef = useRef<number>(0)
  const baseOffsetMsRef = useRef<number>(0)
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  const start = useCallback(async (baseOffsetMs = 0, baseSeq = 0) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const audioContext = new AudioContext({ sampleRate: AUDIO.sample_rate })
      audioContextRef.current = audioContext

      await audioContext.audioWorklet.addModule('/audio-processor.js')
      const source = audioContext.createMediaStreamSource(stream)
      const workletNode = new AudioWorkletNode(audioContext, 'audio-processor')
      workletNodeRef.current = workletNode
      // settings.yaml 오버라이드를 확실히 로드한 후 init
      await loadAppSettings()
      const config = getEffectiveAudioConfig()
      console.log('[AudioRecorder] init config:', config)
      workletNode.port.postMessage({ type: 'init', config })

      workletNode.port.onmessage = (event: MessageEvent<{ pcm: Int16Array; startSample: number; type?: string }>) => {
        // raw-pcm은 녹음 파일용 — STT로 보내지 않음
        if (event.data.type === 'raw-pcm') return
        const { pcm, startSample } = event.data
        const seq = chunkSeqRef.current++
        const offsetMs = Math.round(baseOffsetMsRef.current + (startSample / AUDIO.sample_rate) * 1000)
        callbacksRef.current.onChunk(pcm, { sequence: seq, offsetMs })
      }

      source.connect(workletNode)

      const destination = audioContext.createMediaStreamDestination()
      source.connect(destination)

      await audioContext.audioWorklet.addModule('/system-audio-injector.js')
      const injector = new AudioWorkletNode(audioContext, 'system-audio-injector')
      systemInjectorRef.current = injector
      injector.connect(destination)

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : 'audio/webm'
      const mediaRecorder = new MediaRecorder(destination.stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      mediaRecorder.start()
      baseOffsetMsRef.current = baseOffsetMs
      chunkSeqRef.current = baseSeq
      pausedRef.current = false
      setIsRecording(true)
      setIsPaused(false)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
      setIsRecording(false)
    }
  }, [])

  const pause = useCallback(() => {
    pausedRef.current = true
    workletNodeRef.current?.port.postMessage({ type: 'pause' })
    const mediaRecorder = mediaRecorderRef.current
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.pause()
    }
    setIsPaused(true)
  }, [])

  const resume = useCallback(() => {
    const mediaRecorder = mediaRecorderRef.current
    if (mediaRecorder && mediaRecorder.state === 'paused') {
      mediaRecorder.resume()
    }
    workletNodeRef.current?.port.postMessage({ type: 'resume' })
    pausedRef.current = false
    setIsPaused(false)
  }, [])

  const stop = useCallback(() => {
    pausedRef.current = false
    workletNodeRef.current?.port.postMessage({ type: 'flush' })

    setTimeout(() => {
      workletNodeRef.current?.disconnect()
      systemInjectorRef.current?.disconnect()
      systemInjectorRef.current = null
      audioContextRef.current?.close()
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }, 200)

    const mediaRecorder = mediaRecorderRef.current
    const effectiveMime = mediaRecorder?.mimeType || 'audio/webm;codecs=opus'
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: effectiveMime })
        callbacksRef.current.onStop(blob)
      }
      mediaRecorder.stop()
    } else {
      const blob = new Blob(chunksRef.current, { type: effectiveMime })
      callbacksRef.current.onStop(blob)
    }

    setIsRecording(false)
    setIsPaused(false)
  }, [])

  const feedSystemAudio = useCallback((pcm: Int16Array) => {
    if (pausedRef.current) return
    systemInjectorRef.current?.port.postMessage(pcm)
    workletNodeRef.current?.port.postMessage({ type: 'system-audio', pcm })
  }, [])

  return { isRecording, isPaused, error, start, stop, pause, resume, feedSystemAudio }
}

// ── 모바일 청크 녹음 (MediaRecorder Opus + 연속 업로드) ─────────────────
// 안드로이드 Tauri는 네이티브(cpal) 녹음이 모바일 빌드에서 빠져 있어 파일이 비게 된다.
// 대신 웹뷰의 MediaRecorder로 압축 캡처해 timeslice마다 서버로 청크 업로드한다.
// (STT용 PCM은 useMicCapture가 별도로 담당)

const CHUNK_TIMESLICE_MS = 10_000

function useChunkedRecorder(callbacks: AudioRecorderCallbacks): AudioRecorderResult {
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cbRef = useRef(callbacks)
  cbRef.current = callbacks

  const mrRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const seqRef = useRef(0)
  // 청크 업로드를 도착 순서대로 직렬화 (서버도 seq로 정렬하지만 이중 안전장치)
  const uploadChainRef = useRef<Promise<void>>(Promise.resolve())

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/mp4')
            ? 'audio/mp4'
            : ''
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      mrRef.current = mr
      seqRef.current = 0
      uploadChainRef.current = Promise.resolve()

      mr.ondataavailable = (e: BlobEvent) => {
        if (!e.data || e.data.size === 0) return
        const seq = seqRef.current++
        const blob = e.data
        uploadChainRef.current = uploadChainRef.current
          .then(() => cbRef.current.onAudioChunk?.(blob, seq))
          .catch((err) => console.error('[ChunkedRecorder] 청크 업로드 실패', seq, err))
      }

      mr.start(CHUNK_TIMESLICE_MS)
      setIsRecording(true)
      setIsPaused(false)
      setError(null)
    } catch (err) {
      console.error('[ChunkedRecorder] start 실패:', err)
      setError((err as Error).message || String(err))
      setIsRecording(false)
    }
  }, [])

  const stop = useCallback(() => {
    const mr = mrRef.current
    setIsRecording(false)
    setIsPaused(false)
    if (!mr || mr.state === 'inactive') return

    // stop() → 마지막 dataavailable flush → onstop. 마지막 청크까지 올린 뒤 finalize.
    mr.onstop = () => {
      uploadChainRef.current
        .then(() => cbRef.current.onFinalize?.())
        .catch((err) => console.error('[ChunkedRecorder] finalize 실패', err))
        .finally(() => {
          streamRef.current?.getTracks().forEach((t) => t.stop())
          streamRef.current = null
          mrRef.current = null
        })
    }
    mr.stop()
  }, [])

  const pause = useCallback(() => {
    if (mrRef.current?.state === 'recording') mrRef.current.pause()
    setIsPaused(true)
  }, [])

  const resume = useCallback(() => {
    if (mrRef.current?.state === 'paused') mrRef.current.resume()
    setIsPaused(false)
  }, [])

  const feedSystemAudio = useCallback(() => {
    // 모바일은 시스템 오디오 캡처 없음 (no-op)
  }, [])

  return { isRecording, isPaused, error, start, stop, pause, resume, feedSystemAudio }
}

// ── 공개 훅: 환경에 따라 자동 분기 ─────────────────

export function useAudioRecorder(callbacks: AudioRecorderCallbacks): AudioRecorderResult {
  // 안드로이드 Tauri 앱: 네이티브 녹음이 빠져 있어 MediaRecorder 청크 방식 사용
  if (IS_TAURI && IS_MOBILE) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useChunkedRecorder(callbacks)
  }
  if (IS_TAURI) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useNativeRecorder(callbacks)
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useBrowserRecorder(callbacks)
}
