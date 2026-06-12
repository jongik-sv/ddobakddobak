import { useState, useRef, useCallback } from 'react'
import { getEffectiveAudioConfig, loadAppSettings } from '../stores/appSettingsStore'
import { uint8ArrayToBase64 } from '../lib/audioUtils'
import { AUDIO, IS_TAURI, IS_MOBILE } from '../config'
import type { ChunkMeta } from './useAudioRecorder'

declare global {
  interface Window {
    /** 안드로이드 APK에서만 주입됨 (MainActivity.onWebViewCreate) — 화면 꺼짐 중 녹음 유지 FGS */
    AndroidRecordingService?: { start: () => void; stop: () => void }
  }
}

export interface MicCaptureCallbacks {
  onChunk: (pcm: Int16Array, meta: ChunkMeta) => void
  /**
   * 연속 녹음용 raw-pcm 배치(믹싱된 PCM, 16k Int16, ~300ms). VAD와 무관하게 연속 출력 —
   * 무음 포함 전체. 재생/재전사 원본(끊김 없는 깨끗한 녹음). 워크릿이 매번 새 버퍼를
   * transfer하므로 소비자는 복사 없이 보관해도 안전.
   */
  onRecordChunk?: (pcm: Int16Array) => void
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

      // settings.yaml 오버라이드를 확실히 로드한 후 설정 가져오기
      await loadAppSettings()
      const audioConfig = getEffectiveAudioConfig()
      console.log('[MicCapture] audioConfig:', JSON.stringify(audioConfig))

      // 마이크 제약: 녹음(사람 귀)과 STT가 같은 스트림을 공유하는 트레이드오프 조정.
      // - echoCancellation: 플랫폼 분기.
      //   · 모바일(안드): false — true면 VOICE_COMMUNICATION(전화) 소스로 강제돼 원거리
      //     회의음 감쇠+게이팅+AEC 아티팩트로 ASR 열화. 재생출력 없어 AEC 이득 0.
      //   · 데스크톱(맥): true — macOS Chromium APM(AEC+AGC) 처리경로를 켜 마이크 레벨을
      //     정규화한다. false면 raw 저레벨이 워클릿 VAD(고정 silence_threshold 0.05)를
      //     굶겨 정상 발화를 무음 오판 → 청크가 MIN_CHUNK(2s) 바닥에서 잘림(문장 중간 짤림).
      //     데스크톱은 마이크-스피커 근접 회의가 아니라 AEC 부작용보다 레벨 정규화 이득이 크다.
      // - autoGainControl:true — 원거리/작은 목소리를 끌어올린다. 단 echoCancellation:false면
      //   macOS에서 APM AGC가 사실상 우회되므로 데스크톱은 echoCancellation:true가 필요하다.
      // - noiseSuppression:false — NS는 약한 음절을 먹어 ASR 손해. 녹음 노이즈가 거슬리면 켠다.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: !IS_MOBILE,
          noiseSuppression: false,
          autoGainControl: true,
        },
      })
      streamRef.current = stream

      const audioCtx = new AudioContext({ sampleRate: AUDIO.sample_rate })
      audioCtxRef.current = audioCtx
      // [BBDBG] 임시 계측 — 실제 ctx 레이트 + 마이크 트랙 설정 (제거 예정)
      ;(await import('../lib/bbdbg')).bbdbg('mic ctx.sampleRate=' + audioCtx.sampleRate + ' track=' + JSON.stringify(stream.getAudioTracks()[0]?.getSettings?.() ?? {}))
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
        if (data.type === 'dbg') {
          // [BBDBG] 워크릿 진단 (제거 예정)
          void import('../lib/bbdbg').then((m) => m.bbdbg('wl ' + JSON.stringify(data)))
          return
        }
        if (data.type === 'raw-pcm') {
          // 연속 녹음(재생/재전사 원본) — 무음 포함 전체 PCM.
          callbacksRef.current.onRecordChunk?.(data.pcm)
          // 데스크톱: 믹싱된 PCM → Rust cpal 녹음기(모바일은 미등록 → no-op).
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

      // 화면 꺼짐(슬립)에도 캡처·업로드 유지 — 포그라운드 서비스(mic) + wake/wifi lock
      window.AndroidRecordingService?.start()

      console.log('[MicCapture] 시작 (audio-processor 단일 경로: STT + 녹음)')
      setIsCapturing(true)
      setError(null)
    } catch (err) {
      console.error('[MicCapture] 시작 실패:', err)
      window.AndroidRecordingService?.stop()
      setError((err as Error).message || String(err))
      setIsCapturing(false)
    }
  }, [])

  const stop = useCallback(() => {
    window.AndroidRecordingService?.stop()
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
