/**
 * useLocalStt — 서버 useTranscription의 온디바이스(로컬) 대응 훅.
 *
 * 동일 캡처 스트림(useMicCapture/useAudioRecorder의 onChunk PCM Int16 16k)을 입력으로
 * 받아 Silero VAD 프레임 처리 → SegmentAccumulator 청킹 → invoke('stt_transcribe') →
 * 동일 TranscriptFinalData shape를 3-way emit한다:
 *   ① transcriptStore.addFinal  (BlockNote 렌더 — 기존 seam 재사용)
 *   ② localStore.appendSegment + appendAudio  (오프라인 진실원천)
 *   ③ (opt-in) syncQueue.enqueue  (서버 프로모트)
 *
 * 설계: docs/superpowers/specs/2026-06-01-ondevice-stt-local-mode-design.md §4.3.
 *
 * 직렬성 불변식: Silero state(h/c)는 순차 갱신돼야 하고(sileroVad 주석), Cohere FFI도
 * Mutex 직렬이므로 프레임/세그먼트 처리를 단일 직렬 드레인으로 돌린다(동시 처리 금지).
 */
import { useCallback, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'

import type { ChunkMeta } from './useAudioRecorder'
import type { TranscriptFinalData } from '../channels/transcription'
import { useTranscriptStore } from '../stores/transcriptStore'
import { SegmentAccumulator } from '../stt/chunker'
import { FRAME_SIZE, SileroVad } from '../stt/sileroVad'
import { loadSileroVad } from '../stt/sileroVadLoader'
import { resampleTo16k, shouldResample } from '../stt/resample'
import { cutEosLeak, rms, RMS_GATE } from '../stt/postprocess'
import { DEFAULT_AUDIO_CONFIG, chunkerOptsFromAudioConfig } from '../stt/vadConfig'
import * as localStore from '../stt/localStore'
import { enqueue as syncEnqueue } from '../stt/syncQueue'

export interface UseLocalSttOptions {
  /** localStore localId (회의 시작 시 createLocal로 생성). null이면 영속 생략. */
  localId: string | null
  /** Cohere recognizer 언어(stt_load). cohereLang.localSttLanguage 결과. */
  language: string
  /** 모델 디렉터리(resolve_model_paths 결과). null이면 stt_load 보류. */
  modelDir: string | null
  /** opt-in 서버 전송 — true면 세그먼트마다 syncQueue.enqueue. */
  uploadEnabled: boolean
  /** 오디오 원본도 로컬 저장(opt-in 업로드 대비). 기본 true. */
  retainAudio?: boolean
}

export interface UseLocalSttResult {
  /** useMicCapture/useAudioRecorder의 onChunk에 연결. PCM Int16 16k. */
  sendChunk: (pcm: Int16Array, meta?: ChunkMeta) => void
  /** 회의 종료 시 잔여 세그먼트 flush(마지막 발화 유실 방지). */
  flush: () => void
}

/** Int16 PCM([-32768,32767]) → Float32([-1,1]). */
function int16ToFloat32(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768
  return out
}

/** Float32([-1,1]) → Int16 PCM(로컬 WAV 저장용). */
function float32ToInt16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length)
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]))
    out[i] = s < 0 ? s * 32768 : s * 32767
  }
  return out
}

export function useLocalStt(opts: UseLocalSttOptions): UseLocalSttResult {
  const addFinal = useTranscriptStore((s) => s.addFinal)

  const vadRef = useRef<SileroVad | null>(null)
  const accRef = useRef<SegmentAccumulator | null>(null)
  const loadedRef = useRef<string | null>(null) // stt_load된 언어
  const seqRef = useRef(0)
  const offsetSamplesRef = useRef(0) // 세그먼트 타임 추적(샘플)
  // 512 미만 잔여 프레임 누적 버퍼(프레임 경계 정렬).
  const frameTailRef = useRef<Float32Array>(new Float32Array(0))
  // 단일 직렬 드레인: VAD/FFI는 순차 호출 필수. 진행 중 작업 체인에 이어붙인다.
  const drainRef = useRef<Promise<void>>(Promise.resolve())

  // 옵션을 ref로 캐시(콜백 안정화).
  const optsRef = useRef(opts)
  optsRef.current = opts

  // VAD + accumulator 1회 초기화.
  useEffect(() => {
    let cancelled = false
    accRef.current = new SegmentAccumulator(
      chunkerOptsFromAudioConfig(DEFAULT_AUDIO_CONFIG),
    )
    accRef.current.onSegment = (pcm: Float32Array) => {
      // RMS 게이트: 무음/환각 차단.
      if (rms(pcm) < RMS_GATE) return
      const startMs = Math.round(
        ((offsetSamplesRef.current - pcm.length) / DEFAULT_AUDIO_CONFIG.sample_rate) * 1000,
      )
      const endMs = Math.round(
        (offsetSamplesRef.current / DEFAULT_AUDIO_CONFIG.sample_rate) * 1000,
      )
      enqueueTranscribe(pcm, Math.max(0, startMs), Math.max(0, endMs))
    }

    loadSileroVad()
      .then((vad) => {
        if (!cancelled) vadRef.current = vad
      })
      .catch((e) => {
        console.error('[useLocalStt] Silero VAD 로드 실패:', e)
      })

    return () => {
      cancelled = true
      vadRef.current = null
      accRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 세그먼트를 직렬 드레인에 올려 transcribe→emit. */
  const enqueueTranscribe = useCallback(
    (pcm: Float32Array, startMs: number, endMs: number) => {
      const seq = seqRef.current++
      drainRef.current = drainRef.current
        .then(async () => {
          const o = optsRef.current
          // 모델 로드 보장(언어 변경 시 stt_load가 재생성).
          if (o.modelDir && loadedRef.current !== o.language) {
            await invoke('stt_load', { modelDir: o.modelDir, language: o.language })
            loadedRef.current = o.language
          }
          const raw = await invoke<string>('stt_transcribe', {
            pcm: Array.from(pcm),
          })
          const content = cutEosLeak(raw)
          if (!content) return

          const final: TranscriptFinalData = {
            id: seq,
            content,
            speaker_label: '', // 온디바이스 화자분리 없음(단일/미상)
            started_at_ms: startMs,
            ended_at_ms: endMs,
            sequence_number: seq,
            applied: false,
            created_at: new Date().toISOString(),
            audio_source: 'mic',
          }
          // ① 렌더
          addFinal(final)
          // ② 로컬 영속
          if (o.localId) {
            await localStore.appendSegment(o.localId, final)
            if (o.retainAudio !== false) {
              await localStore.appendAudio(o.localId, seq, float32ToInt16(pcm))
            }
          }
          // ③ opt-in 서버 프로모트
          if (o.localId && o.uploadEnabled) {
            syncEnqueue(o.localId)
          }
        })
        .catch((e) => {
          // 세그먼트 단위 실패는 체인을 오염시키지 않고 스킵(연속성 유지).
          console.error('[useLocalStt] 세그먼트 전사 실패(스킵):', e)
        })
    },
    [addFinal],
  )

  const sendChunk = useCallback((pcm: Int16Array, _meta?: ChunkMeta) => {
    const vad = vadRef.current
    const acc = accRef.current
    if (!vad || !acc) return

    // Int16 → Float32, 필요 시 16k 리샘플(보통 이미 16k).
    let f = int16ToFloat32(pcm)
    if (shouldResample(DEFAULT_AUDIO_CONFIG.sample_rate)) {
      f = resampleTo16k(f, DEFAULT_AUDIO_CONFIG.sample_rate)
    }

    // 512 프레임 경계로 정렬(잔여 tail 이어붙임).
    const tail = frameTailRef.current
    const merged = new Float32Array(tail.length + f.length)
    merged.set(tail, 0)
    merged.set(f, tail.length)

    let i = 0
    for (; i + FRAME_SIZE <= merged.length; i += FRAME_SIZE) {
      const frame = merged.subarray(i, i + FRAME_SIZE)
      // VAD process는 비동기·순차. 드레인에 직렬로 올린다.
      const frameCopy = frame.slice()
      drainRef.current = drainRef.current.then(async () => {
        const v = vadRef.current
        const a = accRef.current
        if (!v || !a) return
        // offsetSamples는 드레인(process 시점)에서 증가시켜야 한다. enqueue 시점에
        // 올리면 큐 깊이만큼 앞서가 onSegment가 읽는 started/ended_at_ms가 미래로
        // 밀린다(타임스탬프 레이스). feed→onSegment와 같은 드레인 스텝에서 갱신.
        offsetSamplesRef.current += FRAME_SIZE
        const speech = await v.process(frameCopy)
        a.feed(frameCopy, speech)
      })
    }
    frameTailRef.current = merged.slice(i)
  }, [])

  const flush = useCallback(() => {
    drainRef.current = drainRef.current.then(async () => {
      accRef.current?.flush()
    })
  }, [])

  return { sendChunk, flush }
}
