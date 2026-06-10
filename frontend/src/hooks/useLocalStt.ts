/**
 * useLocalStt — 서버 useTranscription의 온디바이스(로컬) 대응 훅.
 *
 * 입력은 useMicCapture/useAudioRecorder의 onChunk(PCM Int16 16k)다. 이 청크는
 * **audio-processor.js가 이미 VAD로 잘라낸 완결 발화 세그먼트**이므로(silence/speech
 * 임계 + min/max + preroll), 여기서 Silero로 재분할하지 않는다 — 청크를 그대로
 * stt_transcribe에 넘긴다(과거 재-VAD는 pre-cut 청크에 trailing silence가 없어
 * SegmentAccumulator가 다음 청크/flush까지 emit 못하는 지연·병합 버그를 유발했다).
 *
 * 출력: 동일 TranscriptFinalData shape를 3-way emit:
 *   ① transcriptStore.addFinal  (BlockNote 렌더 — 기존 seam)
 *   ② localStore.appendSegment + appendAudio  (오프라인 진실원천)
 *   ③ (opt-in) syncQueue.enqueue  (서버 프로모트)
 *
 * 설계: docs/superpowers/specs/2026-06-01-ondevice-stt-local-mode-design.md §4.3.
 * 직렬성: Cohere FFI는 Mutex 직렬 + SYNC 커맨드라, 청크 전사를 단일 직렬 드레인으로 돌린다.
 */
import { useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'

import type { ChunkMeta } from './useAudioRecorder'
import type { TranscriptFinalData } from '../channels/transcription'
import { useTranscriptStore } from '../stores/transcriptStore'
import { cutEosLeak, hasSpeech, hasSpeechFrame, normalizeForStt, rms } from '../stt/postprocess'
import { DEFAULT_AUDIO_CONFIG } from '../stt/vadConfig'
import * as localStore from '../stt/localStore'
import { enqueue as syncEnqueue } from '../stt/syncQueue'

const MAX_SEGMENT_SAMPLES = 8 * 16000 // Cohere 8s 상한(FFI 백스톱과 일치).

export interface UseLocalSttOptions {
  /** localStore localId. null이면 영속 생략. */
  localId: string | null
  /** Cohere recognizer 언어(stt_load). */
  language: string
  /** 모델 디렉터리(resolve_model_paths 결과). null이면 transcribe 보류. */
  modelDir: string | null
  /** opt-in 서버 전송. */
  uploadEnabled: boolean
  /** 오디오 원본도 로컬 저장. 기본 true. */
  retainAudio?: boolean
}

export interface UseLocalSttResult {
  /** useMicCapture/useAudioRecorder onChunk에 연결. 완결 발화 PCM Int16 16k. */
  sendChunk: (pcm: Int16Array, meta?: ChunkMeta) => void
  /**
   * 회의 종료 시 호출. 진행 중인 전사+오디오 저장 드레인이 모두 끝날 때까지 기다린다.
   * (프로모트가 부분 오디오를 올리지 않도록 stop()이 await 한다.)
   */
  flush: () => Promise<void>
  /**
   * 이어녹음 시드. seq(= 세그먼트 id/sequence_number/audio 파일명)를 n부터 시작하게 한다.
   * 안 하면 재진입 시 seqRef가 0부터 시작해 audio/<seq>.wav를 덮어쓰고 id가 충돌한다.
   */
  seedSeq: (n: number) => void
}

function int16ToFloat32(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768
  return out
}

export function useLocalStt(opts: UseLocalSttOptions): UseLocalSttResult {
  const addFinal = useTranscriptStore((s) => s.addFinal)

  const loadedRef = useRef<string | null>(null) // stt_load된 언어
  const seqRef = useRef(0)
  // 단일 직렬 드레인: Cohere FFI는 순차 호출 필수. 진행 중 작업 체인에 이어붙인다.
  const drainRef = useRef<Promise<void>>(Promise.resolve())

  const optsRef = useRef(opts)
  optsRef.current = opts

  const sendChunk = useCallback(
    (pcm: Int16Array, meta?: ChunkMeta) => {
      const o = optsRef.current
      if (!o.modelDir) return

      const f = int16ToFloat32(pcm)
      // 무음/환각 차단(audio-processor가 1차로 걸러내지만 한 번 더). 프레임 게이트 —
      // 통짜 RMS는 짧은 발화+긴 무음 패딩에서 희석돼 정상 발화를 통째로 드랍한다.
      if (!hasSpeech(f)) return
      // 8s 초과 청크는 절단하지 않고 8s 윈도우로 분할해 전부 전사한다.
      // (과거 subarray(0, 8s) 절단은 max_chunk_sec 오버라이드가 8보다 클 때
      // 청크 꼬리를 통째로 폐기했다 — 설정이 틀어져도 데이터 손실이 없어야 한다.)
      const pieces: Float32Array[] = []
      for (let off = 0; off < f.length; off += MAX_SEGMENT_SAMPLES) {
        pieces.push(f.subarray(off, Math.min(off + MAX_SEGMENT_SAMPLES, f.length)))
      }
      // 0.5s 미만 꼬리 조각은 직전 조각에 병합 — 고립 파편 단독 전사는 Cohere 환각을
      // 유발한다. 병합 결과 ≤8.5s는 Rust FFI 8.7s 백스톱 안이라 안전.
      const MIN_TAIL_SAMPLES = 8000
      if (pieces.length >= 2 && pieces[pieces.length - 1].length < MIN_TAIL_SAMPLES) {
        const lastStart = (pieces.length - 2) * MAX_SEGMENT_SAMPLES
        pieces.splice(pieces.length - 2, 2, f.subarray(lastStart, f.length))
      }

      const seq = seqRef.current++
      const startMs = meta?.offsetMs ?? 0
      const endMs = startMs + Math.round((f.length / DEFAULT_AUDIO_CONFIG.sample_rate) * 1000)

      drainRef.current = drainRef.current
        .then(async () => {
          // 모델 로드 보장(언어 변경 시 stt_load가 재생성).
          if (loadedRef.current !== o.language) {
            await invoke('stt_load', { modelDir: o.modelDir, language: o.language })
            loadedRef.current = o.language
          }
          // 조각별 순차 전사(FFI 직렬) 후 텍스트 결합. 전사 입력만 정규화(저장 pcm은 raw 유지).
          // 조각 게이트는 느슨하게(hasSpeechFrame) — 청크는 이미 hasSpeech 통과,
          // 여기선 순수 무음 패딩 조각만 거른다(엄격하면 경계 걸친 발화가 양쪽서 탈락).
          const texts: string[] = []
          for (const piece of pieces) {
            if (!hasSpeechFrame(piece)) continue
            let raw: string
            try {
              raw = await invoke<string>('stt_transcribe', { pcm: Array.from(normalizeForStt(piece)) })
            } catch (e) {
              // 조각 단위 실패는 스킵 — 한 조각 실패가 청크 전체(텍스트+오디오 저장)를
              // 무효화하면 안 된다(retranscribe와 동일한 격리 정책).
              console.error('[useLocalStt] 조각 전사 실패(스킵):', e)
              continue
            }
            // [BBDBG] 임시 계측 — STT 입력 길이/RMS/타임스탬프 + 원본 출력 문자열 (제거 예정)
            void import('../lib/bbdbg').then((m) => m.bbdbg('stt ' + JSON.stringify({ len: piece.length, of: f.length, rms: Number(rms(piece).toFixed(4)), startMs, endMs, raw })))
            const t = cutEosLeak(raw)
            if (t) texts.push(t)
          }
          const content = texts.join(' ')
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
          addFinal(final)
          if (o.localId) {
            await localStore.appendSegment(o.localId, final)
            if (o.retainAudio !== false) {
              await localStore.appendAudio(o.localId, seq, pcm)
            }
          }
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

  // 진행 중 드레인(전사 + localStore.appendAudio 쓰기)이 끝날 때까지 기다린다.
  // drainRef 체인은 자체 .catch로 항상 resolve되므로 이 await는 throw하지 않는다.
  const flush = useCallback(() => drainRef.current, [])

  // 이어녹음: 기존 최대 seq+1로 끌어올린다(되돌리지 않음 — 진행 중 카운터 보호).
  const seedSeq = useCallback((n: number) => {
    if (n > seqRef.current) seqRef.current = n
  }, [])

  return { sendChunk, flush, seedSeq }
}
