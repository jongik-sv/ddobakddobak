import { useState, useRef, useCallback } from 'react'
import { getEffectiveAudioConfig } from '../stores/appSettingsStore'
import { AUDIO, IS_TAURI } from '../config'
import type { ChunkMeta } from './useAudioRecorder'

export interface MicCaptureCallbacks {
  onChunk: (pcm: Int16Array, meta: ChunkMeta) => void
}

export interface MicCaptureResult {
  isCapturing: boolean
  error: string | null
  start: (baseOffsetMs?: number, baseSeq?: number) => Promise<void>
  stop: () => void
  pause: () => void
  resume: () => void
  /** 시스템 오디오 PCM을 마이크와 믹싱하여 STT 처리 (16kHz Int16) */
  feedSystemAudio: (pcm: Int16Array) => void
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let bin = ''
  const sz = 8192
  for (let i = 0; i < bytes.length; i += sz) {
    bin += String.fromCharCode(...bytes.subarray(i, i + sz))
  }
  return btoa(bin)
}

/**
 * Tauri 모드 마이크 캡처 훅.
 *
 * audio-processor.js 하나가 모든 것을 처리:
 * - 마이크 + 시스템 오디오 믹싱 (오디오 스레드, 128 샘플 단위)
 * - VAD → STT 청크 출력
 * - raw-pcm → 녹음용 믹싱된 PCM 배치 출력
 *
 * 녹음과 STT가 동일한 믹싱 오디오를 사용한다.
 */
export function useMicCapture(callbacks: MicCaptureCallbacks): MicCaptureResult {
  const [isCapturing, setIsCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const vadWorkletRef = useRef<AudioWorkletNode | null>(null)
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  const baseOffsetMsRef = useRef<number>(0)
  const chunkSeqRef = useRef<number>(0)

  const feedSystemAudio = useCallback((pcm: Int16Array) => {
    vadWorkletRef.current?.port.postMessage({ type: 'system-audio', pcm })
  }, [])

  const start = useCallback(async (baseOffsetMs = 0, baseSeq = 0) => {
    try {
      baseOffsetMsRef.current = baseOffsetMs
      chunkSeqRef.current = baseSeq

      const audioConfig = getEffectiveAudioConfig()

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true,
        },
      })
      streamRef.current = stream

      const audioCtx = new AudioContext({ sampleRate: AUDIO.sample_rate })
      audioCtxRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)

      // audio-processor.js 하나로 STT + 녹음 모두 처리
      await audioCtx.audioWorklet.addModule('/audio-processor.js')
      const vadWorklet = new AudioWorkletNode(audioCtx, 'audio-processor')
      vadWorkletRef.current = vadWorklet
      vadWorklet.port.postMessage({ type: 'init', config: audioConfig })

      // Tauri invoke 준비
      const invoke = IS_TAURI ? (await import('@tauri-apps/api/core')).invoke : null

      vadWorklet.port.onmessage = (event: MessageEvent<{ type?: string; pcm: Int16Array; startSample?: number }>) => {
        const data = event.data
        if (data.type === 'raw-pcm') {
          // 녹음: 믹싱된 PCM → Rust 녹음기
          if (invoke) {
            const bytes = new Uint8Array(data.pcm.buffer)
            const base64 = uint8ArrayToBase64(bytes)
            invoke('feed_recorder_mic', { pcmBase64: base64 }).catch(() => {})
          }
        } else {
          // STT: VAD 청크
          const { pcm, startSample } = data as { pcm: Int16Array; startSample: number }
          const seq = chunkSeqRef.current++
          const offsetMs = Math.round(baseOffsetMsRef.current + (startSample! / AUDIO.sample_rate) * 1000)
          callbacksRef.current.onChunk(pcm, { sequence: seq, offsetMs })
        }
      }

      source.connect(vadWorklet)
      const silentGain = audioCtx.createGain()
      silentGain.gain.value = 0
      vadWorklet.connect(silentGain)
      silentGain.connect(audioCtx.destination)

      console.log('[MicCapture] 시작 (audio-processor 단일 경로: STT + 녹음)')
      setIsCapturing(true)
      setError(null)
    } catch (err) {
      console.error('[MicCapture] 시작 실패:', err)
      setError((err as Error).message || String(err))
      setIsCapturing(false)
    }
  }, [])

  const stop = useCallback(() => {
    vadWorkletRef.current?.port.postMessage({ type: 'flush' })

    setTimeout(() => {
      vadWorkletRef.current?.disconnect()
      vadWorkletRef.current = null

      audioCtxRef.current?.close()
      audioCtxRef.current = null

      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }, 200)

    setIsCapturing(false)
  }, [])

  const pause = useCallback(() => {
    vadWorkletRef.current?.port.postMessage({ type: 'pause' })
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false })
  }, [])

  const resume = useCallback(() => {
    vadWorkletRef.current?.port.postMessage({ type: 'resume' })
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = true })
  }, [])

  return { isCapturing, error, start, stop, pause, resume, feedSystemAudio }
}
