import { useState, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { SystemAudioVAD } from '../lib/systemAudioVAD'
import { getEffectiveAudioConfig } from '../stores/appSettingsStore'
import { AUDIO } from '../config'
import type { ChunkMeta } from './useAudioRecorder'

export interface SystemAudioCaptureCallbacks {
  onChunk: (pcm: Int16Array, meta: ChunkMeta) => void
}

export interface SystemAudioCaptureResult {
  isCapturing: boolean
  error: string | null
  start: (baseOffsetMs?: number, baseSeq?: number) => Promise<void>
  stop: () => void
}

interface SystemAudioChunkPayload {
  pcm_base64: string
  sample_count: number
}

/**
 * Base64 인코딩된 PCM Int16 데이터를 Int16Array로 디코딩
 */
function base64ToInt16Array(base64: string): Int16Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Int16Array(bytes.buffer)
}

/**
 * 시스템 오디오 캡처 훅.
 * Tauri 네이티브 모듈에서 시스템 오디오를 캡처하고,
 * VAD 처리 후 onChunk 콜백으로 전달한다.
 */
export function useSystemAudioCapture(
  callbacks: SystemAudioCaptureCallbacks,
): SystemAudioCaptureResult {
  const [isCapturing, setIsCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const unlistenRef = useRef<UnlistenFn | null>(null)
  const vadRef = useRef<SystemAudioVAD | null>(null)
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  const captureStartRef = useRef<number>(0)
  const chunkSeqRef = useRef<number>(0)

  const start = useCallback(async (baseOffsetMs = 0, baseSeq = 0) => {
    try {
      captureStartRef.current = Date.now() - baseOffsetMs
      chunkSeqRef.current = baseSeq

      // VAD 초기화
      const audioConfig = getEffectiveAudioConfig()
      vadRef.current = new SystemAudioVAD(audioConfig, (pcm: Int16Array) => {
        const seq = chunkSeqRef.current++
        const now = Date.now() - captureStartRef.current
        const chunkDurationMs = (pcm.length / AUDIO.sample_rate) * 1000
        const offsetMs = Math.max(0, now - chunkDurationMs)
        callbacksRef.current.onChunk(pcm, { sequence: seq, offsetMs })
      })

      // Tauri 이벤트 리스닝 시작
      const unlisten = await listen<SystemAudioChunkPayload>(
        'system-audio-chunk',
        (event) => {
          const { pcm_base64 } = event.payload
          const pcmI16 = base64ToInt16Array(pcm_base64)
          vadRef.current?.feed(pcmI16)
        },
      )
      unlistenRef.current = unlisten

      // 네이티브 캡처 시작
      await invoke('start_system_audio_capture')

      setIsCapturing(true)
      setError(null)
    } catch (err) {
      setError((err as Error).message || String(err))
      setIsCapturing(false)
    }
  }, [])

  const stop = useCallback(() => {
    // VAD flush
    vadRef.current?.flush()
    vadRef.current = null

    // 이벤트 리스닝 중지
    unlistenRef.current?.()
    unlistenRef.current = null

    // 네이티브 캡처 중지
    invoke('stop_system_audio_capture').catch(() => {
      // 이미 중지된 경우 무시
    })

    setIsCapturing(false)
  }, [])

  return { isCapturing, error, start, stop }
}
