import { useState, useRef, useCallback } from 'react'
import { AUDIO } from '../config'
import { getEffectiveAudioConfig } from '../stores/appSettingsStore'

export interface ChunkMeta {
  sequence: number
  offsetMs: number
}

export interface AudioRecorderCallbacks {
  onChunk: (pcm: Int16Array, meta: ChunkMeta) => void
  onStop: (blob: Blob) => void
}

export interface AudioRecorderResult {
  isRecording: boolean
  isPaused: boolean
  error: string | null
  start: (baseOffsetMs?: number, baseSeq?: number) => Promise<void>
  stop: () => void
  pause: () => void
  resume: () => void
  /** 시스템 오디오 PCM을 녹음 믹스에 주입 (16kHz Int16) */
  feedSystemAudio: (pcm: Int16Array) => void
}

export function useAudioRecorder(callbacks: AudioRecorderCallbacks): AudioRecorderResult {
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

      // STT용 VAD worklet
      await audioContext.audioWorklet.addModule('/audio-processor.js')
      const source = audioContext.createMediaStreamSource(stream)
      const workletNode = new AudioWorkletNode(audioContext, 'audio-processor')
      workletNodeRef.current = workletNode
      workletNode.port.postMessage({ type: 'init', config: getEffectiveAudioConfig() })

      workletNode.port.onmessage = (event: MessageEvent<{ pcm: Int16Array; startSample: number }>) => {
        if (!pausedRef.current) {
          const { pcm, startSample } = event.data
          const seq = chunkSeqRef.current++
          // 샘플 카운트 기반 오프셋: AudioContext 클럭과 정확히 동기화
          const offsetMs = Math.round(baseOffsetMsRef.current + (startSample / AUDIO.sample_rate) * 1000)
          callbacksRef.current.onChunk(pcm, { sequence: seq, offsetMs })
        }
      }

      source.connect(workletNode)

      // 녹음용 믹싱: 마이크 + 시스템 오디오 → MediaStreamDestination
      const destination = audioContext.createMediaStreamDestination()
      source.connect(destination)

      // 시스템 오디오 인젝터 worklet (녹음 믹싱 전용)
      await audioContext.audioWorklet.addModule('/system-audio-injector.js')
      const injector = new AudioWorkletNode(audioContext, 'system-audio-injector')
      systemInjectorRef.current = injector
      injector.connect(destination)
      // STT VAD 합류는 audio-processor 내부 직접 믹싱으로 처리 (injector→worklet 제거)

      // WKWebView(macOS Tauri)는 webm 미지원 → mp4 폴백
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : 'audio/webm'
      // 믹싱된 스트림에서 녹음
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
    const mediaRecorder = mediaRecorderRef.current
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.pause()
    }
    workletNodeRef.current?.port.postMessage({ type: 'pause' })
    pausedRef.current = true
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
    // 녹음 믹싱용: injector → MediaRecorder destination
    systemInjectorRef.current?.port.postMessage(pcm)
    // STT VAD용: audio-processor 내부에서 직접 믹싱 (AudioContext 그래프 경유 제거)
    workletNodeRef.current?.port.postMessage({ type: 'system-audio', pcm })
  }, [])

  return { isRecording, isPaused, error, start, stop, pause, resume, feedSystemAudio }
}
