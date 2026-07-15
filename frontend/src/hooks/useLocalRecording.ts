/**
 * useLocalRecording — 완전 오프라인(서버 없음) 회의 세션 컨트롤러.
 *
 * useLiveRecording은 서버 발급 numeric meetingId + startMeeting/stopMeeting(POST)에
 * 결합돼 있어 서버 없이는 진입할 수 없다. 이 훅은 그 서버 lifecycle을 완전히 우회하고
 * localStore localId 기반으로 동작한다:
 *   - 회의 식별 = localId(localStore.createLocal). 서버 호출 0.
 *   - 캡처 = useMicCapture(getUserMedia + audio-processor worklet → Int16 onChunk).
 *   - 전사 = useLocalStt(onChunk → Silero VAD → stt_transcribe → addFinal + localStore 영속).
 *   - 종료 = flush + localStore status='completed' + (opt-in) syncQueue 프로모트.
 *
 * 설계: docs/superpowers/specs/2026-06-01-ondevice-stt-local-mode-design.md §2(축소 기능),
 * 자동결정 A-T16. AI 요약/공유/refine은 프로모트(업로드) 후 서버에서.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

import { useMicCapture } from './useMicCapture'
import { useLocalStt } from './useLocalStt'
import { useScreenWakeLock } from './useScreenWakeLock'
import { useTranscriptStore } from '../stores/transcriptStore'
import { useAppSettingsStore } from '../stores/appSettingsStore'
import * as localStore from '../stt/localStore'
import { flushAll as syncFlushAll } from '../stt/syncQueue'
import type { LocalMeetingMeta } from '../stt/localStore'

type LocalStatus = 'loading' | 'idle' | 'recording' | 'paused' | 'stopped' | 'unavailable'

export interface UseLocalRecordingResult {
  status: LocalStatus
  meta: LocalMeetingMeta | null
  error: string | null
  elapsedSeconds: number
  /** 녹음 진행 중(일시정지 포함 — 녹음 컨트롤 유지용). */
  isRecording: boolean
  /** 일시정지 상태. */
  isPaused: boolean
  /** 온디바이스 모델 선로딩 중(녹음 시작 게이트 UI용). */
  modelLoading: boolean
  /** start() 진행 중(콜드 stt_load + 마이크 기동). 버튼 스피너/비활성용. */
  starting: boolean
  start: () => Promise<void>
  pause: () => void
  resume: () => void
  stop: () => Promise<void>
}

/**
 * @param localId 기존 로컬 회의(이어하기) 또는 null(신규 — start 시 createLocal은 호출자가 미리 함)
 *   여기서는 localId가 이미 있다고 가정한다(페이지가 createLocal 후 라우팅).
 * @param language Cohere 언어
 * @param modelDir resolve_model_paths 결과(없으면 unavailable)
 */
export function useLocalRecording(
  localId: string,
  language: string,
  modelDir: string | null,
): UseLocalRecordingResult {
  const [status, setStatus] = useState<LocalStatus>('loading')
  const [meta, setMeta] = useState<LocalMeetingMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [modelLoading, setModelLoading] = useState(false)
  const [starting, setStarting] = useState(false)

  const reset = useTranscriptStore((s) => s.reset)
  const loadFinals = useTranscriptStore((s) => s.loadFinals)
  const localUploadEnabled = useAppSettingsStore((s) => s.localUploadEnabled)

  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const elapsedBaseRef = useRef<number | null>(null)
  // 일시정지 시점까지 누적된 경과(ms). resume에서 base를 이 값만큼 당겨 타이머를 이어붙인다.
  const pausedElapsedMsRef = useRef(0)
  // 재진입 가드(동기): stt_load 콜드로드 await 중에는 status가 아직 'recording'이 아니라
  // 사용자가 시작을 또 누를 수 있다. start()가 두 번 진입하면 mic 캡처 파이프라인이
  // 2벌 동시 가동되어(AudioContext/워크릿/STT 중복) 모든 발화가 중복 전사된다.
  const startingRef = useRef(false)
  // 모델 선로딩 dir 가드: 같은 modelDir에 대해 stt_load를 1회만 호출(재렌더/언어유지 시 중복 방지).
  const preloadedDirRef = useRef<string | null>(null)
  // 캡처 중 여부(언마운트 정리용). 뒤로=자동종료가 1차 방어지만, Android 하드웨어 백/
  // 프로그램적 라우트 변경 등 stop()을 안 거치는 이탈에서도 mic/AudioContext를 확실히 내린다
  // (안 그러면 마이크 표시등/배터리 누수 + status='recording' 잔존).
  const capturingRef = useRef(false)

  const localStt = useLocalStt({
    localId,
    language,
    modelDir,
    uploadEnabled: localUploadEnabled,
  })

  // 웹 브라우저 전용: 녹음 중 화면 자동 꺼짐 방지 (일시정지 포함 — 세션 생존 유지).
  // Tauri WebView는 미지원이라 no-op (macOS는 caffeinate, Android는 FGS가 담당).
  useScreenWakeLock(status === 'recording' || status === 'paused')

  // 연속 녹음 버퍼(이 세션분 raw-pcm Int16). 무음 포함 끊김 없는 재생/재전사 원본.
  // 종료 시 1벌로 concat → localStore.appendRecording(append-only). 세션 중 메모리 누적이라
  // append 레이스 없음(대가: 장시간 RAM ~115MB/h, 크래시 시 이 세션분 유실→segment 폴백).
  const recordBufRef = useRef<Int16Array[]>([])

  const mic = useMicCapture({
    onChunk: (pcm, meta) => localStt.sendChunk(pcm, meta),
    onRecordChunk: (pcm) => {
      recordBufRef.current.push(pcm)
    },
  })
  // 언마운트 정리(deps [])에서 최신 mic를 stale 없이 참조하기 위한 미러.
  // mic 객체는 매 렌더 새로 생성되므로 effect deps로 쓰면 안 된다(매 렌더 정리 → mic 중단).
  const micRef = useRef(mic)
  micRef.current = mic

  // 초기 로드: 메타 + 기존 세그먼트 복원(이어하기).
  useEffect(() => {
    let cancelled = false
    reset()
    localStore
      .getLocal(localId)
      .then(({ meta: m, segments }) => {
        if (cancelled) return
        setMeta(m)
        loadFinals(segments)
        setStatus(modelDir ? (m.status === 'completed' ? 'stopped' : 'idle') : 'unavailable')
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setStatus('unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [localId, modelDir, reset, loadFinals])

  // 모델 선로딩: modelDir 확정 시 dir당 1회 stt_load 콜드로드(첫 세그먼트/시작 지연 방지).
  // stt_load는 멱등이라 이후 start() 내부 콜드로드는 빠른 no-op.
  useEffect(() => {
    if (!modelDir) return
    if (preloadedDirRef.current === modelDir) return
    preloadedDirRef.current = modelDir
    let cancelled = false
    setModelLoading(true)
    invoke('stt_load', { modelDir, language })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setModelLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [modelDir, language])

  const tick = useCallback(() => {
    if (elapsedBaseRef.current == null) return
    setElapsedSeconds(Math.floor((Date.now() - elapsedBaseRef.current) / 1000))
  }, [])

  const start = useCallback(async () => {
    if (!modelDir) {
      setError('온디바이스 모델이 준비되지 않았습니다.')
      return
    }
    // 이미 시작 중이거나 녹음/일시정지 중이면 무시(이중 시작 → 파이프라인 중복 방지).
    if (startingRef.current || status === 'recording' || status === 'paused') return
    startingRef.current = true
    setStarting(true) // 버튼 스피너 — 콜드로드/마이크 기동이 끝나 녹음 시작될 때까지.
    setError(null)
    try {
      // recognizer 콜드로드 선행(첫 세그먼트 지연 방지).
      await invoke('stt_load', { modelDir, language }).catch(() => {})
      // 이어녹음(이미 세그먼트가 있는 회의 재진입): 기존 타임라인/seq를 이어받는다.
      // 안 그러면 mic.start(0,0)+seqRef=0으로 started_at_ms가 0부터 다시 시작하고(타임 꼬임)
      // audio/<seq>.wav가 덮어써져 이전 구간 오디오가 유실된다.
      const { segments } = await localStore
        .getLocal(localId)
        .catch(() => ({ segments: [] as Awaited<ReturnType<typeof localStore.getLocal>>['segments'] }))
      // base offset = 기존 연속녹음(recording.pcm) 물리 길이. 재생은 recording.pcm(세션 concat,
      // 갭 없음) 기준이라 새 세션 started_at_ms를 오디오 물리 끝에 앵커해야 자막↔오디오가 맞는다.
      // segments.ended_at_ms(마지막 발화 끝)로 잡으면 정지 전 trailing 무음만큼 앞당겨져
      // stop→이어녹음마다 어긋남이 누적된다(자막 클릭 시 엉뚱한 위치 재생). recording.pcm 없는
      // 옛 회의는 ended_at_ms로 폴백.
      const recDurMs = await localStore.getRecordingDurationMs(localId).catch(() => 0)
      const baseOffsetMs =
        recDurMs > 0 ? recDurMs : segments.reduce((m, s) => Math.max(m, s.ended_at_ms ?? 0), 0)
      const baseSeq =
        segments.reduce((m, s) => Math.max(m, s.sequence_number ?? s.id ?? -1), -1) + 1
      localStt.seedSeq(baseSeq)
      recordBufRef.current = [] // 이 세션분만 모은다(파일은 append-only라 직전 세션은 이미 기록됨).
      await mic.start(baseOffsetMs, baseSeq)
      await localStore.setStatus(localId, 'recording').catch(() => {})
      capturingRef.current = true
      pausedElapsedMsRef.current = 0
      setElapsedSeconds(0)
      elapsedBaseRef.current = Date.now()
      elapsedTimerRef.current = setInterval(tick, 1000)
      setStatus('recording')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      startingRef.current = false
      setStarting(false)
    }
  }, [modelDir, language, localId, mic, localStt, tick, status])

  // 일시정지: mic.pause(워크릿 _paused=true → 샘플카운터/녹음/전사 모두 정지)로 타임라인이
  // 멈추므로 재개 후 offsetMs가 무음 없이 이어진다. 경과 타이머도 freeze.
  const pause = useCallback(() => {
    if (status !== 'recording') return
    mic.pause()
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
    if (elapsedBaseRef.current != null) {
      pausedElapsedMsRef.current = Date.now() - elapsedBaseRef.current
    }
    setStatus('paused')
  }, [status, mic])

  const resume = useCallback(() => {
    if (status !== 'paused') return
    mic.resume()
    elapsedBaseRef.current = Date.now() - pausedElapsedMsRef.current
    elapsedTimerRef.current = setInterval(tick, 1000)
    setStatus('recording')
  }, [status, mic, tick])

  const stop = useCallback(async () => {
    mic.stop()
    capturingRef.current = false
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
    elapsedBaseRef.current = null
    // 워크릿 flush가 마지막 발화 청크를 enqueue(mic teardown ≤200ms)할 시간을 준 뒤,
    // 전사+오디오 저장 드레인이 모두 끝날 때까지 기다린다. 이걸 안 기다리면 아래
    // syncFlushAll(프로모트)이 아직 안 써진 마지막 구간을 빼고 부분 오디오만 서버에 올린다.
    await new Promise((r) => setTimeout(r, 250))
    await localStt.flush()
    // 이 세션 연속 녹음을 1벌로 합쳐 append(promote/재생/재전사 원본). syncFlushAll 전에 써야
    // 프로모트가 segment 병합 대신 깨끗한 연속본을 올린다.
    const recChunks = recordBufRef.current
    recordBufRef.current = []
    if (recChunks.length > 0) {
      const total = recChunks.reduce((n, c) => n + c.length, 0)
      const merged = new Int16Array(total)
      let off = 0
      for (const c of recChunks) {
        merged.set(c, off)
        off += c.length
      }
      // 피크 정규화(재생용): 원거리/작은 녹음을 균일하게 키운다(안드 AGC가 약해 작게 녹음됨).
      // 결정적이라 펌핑 없음. recording.pcm은 재생/재전사 원본 — STT는 별도 normalizeForStt라 무관.
      localStore.peakNormalizeInt16(merged)
      await localStore.appendRecording(localId, merged).catch(() => {})
    }
    await localStore.setStatus(localId, 'completed').catch(() => {})
    if (localUploadEnabled) {
      await syncFlushAll().catch(() => {})
    }
    const refreshed = await localStore.getLocal(localId).then((r) => r.meta).catch(() => null)
    if (refreshed) setMeta(refreshed)
    setStatus('stopped')
  }, [localId, mic, localStt, localUploadEnabled])

  useEffect(() => {
    return () => {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)
      // stop()을 안 거친 이탈(하드웨어 백/라우트 변경)에서도 캡처 중이면 mic 파이프라인 teardown.
      if (capturingRef.current) {
        capturingRef.current = false
        micRef.current.stop()
      }
    }
  }, [])

  return {
    status,
    meta,
    error,
    elapsedSeconds,
    isRecording: status === 'recording' || status === 'paused',
    isPaused: status === 'paused',
    modelLoading,
    starting,
    start,
    pause,
    resume,
    stop,
  }
}
