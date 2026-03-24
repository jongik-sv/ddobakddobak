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
  start: () => Promise<void>
  stop: () => void
  pause: () => void
  resume: () => void
}

export function useAudioRecorder(callbacks: AudioRecorderCallbacks): AudioRecorderResult {
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const pausedRef = useRef(false)
  const recordingStartRef = useRef<number>(0)
  const chunkSeqRef = useRef<number>(0)
  // 콜백 ref 패턴: start/stop 의존성 없이 최신 콜백 참조
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

      // config.yaml 기본값 + 사용자 오버라이드를 worklet에 전달
      workletNode.port.postMessage({ type: 'init', config: getEffectiveAudioConfig() })

      workletNode.port.onmessage = (event: MessageEvent<Int16Array>) => {
        if (!pausedRef.current) {
          const seq = chunkSeqRef.current++
          const now = Date.now() - recordingStartRef.current
          // 청크 시작 시점 = 현재 시점 - 청크 길이(샘플 수 / 샘플레이트)
          const chunkDurationMs = (event.data.length / AUDIO.sample_rate) * 1000
          const offsetMs = Math.max(0, now - chunkDurationMs)
          callbacksRef.current.onChunk(event.data, { sequence: seq, offsetMs })
        }
      }

      source.connect(workletNode)

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      mediaRecorder.start()
      recordingStartRef.current = Date.now() - baseOffsetMs
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
    pausedRef.current = true
    setIsPaused(true)
  }, [])

  const resume = useCallback(() => {
    const mediaRecorder = mediaRecorderRef.current
    if (mediaRecorder && mediaRecorder.state === 'paused') {
      mediaRecorder.resume()
    }
    pausedRef.current = false
    setIsPaused(false)
  }, [])

  const stop = useCallback(() => {
    pausedRef.current = false

    // flush: worklet에 남은 음성 전송 요청
    workletNodeRef.current?.port.postMessage({ type: 'flush' })

    // 200ms 후 정리 (worklet이 flush 응답할 시간 확보)
    setTimeout(() => {
      workletNodeRef.current?.disconnect()
      audioContextRef.current?.close()
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }, 200)

    const mediaRecorder = mediaRecorderRef.current
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm;codecs=opus' })
        callbacksRef.current.onStop(blob)
      }
      mediaRecorder.stop()
    } else {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm;codecs=opus' })
      callbacksRef.current.onStop(blob)
    }

    setIsRecording(false)
    setIsPaused(false)
  }, [])

  return { isRecording, isPaused, error, start, stop, pause, resume }
}
