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
import { useTranscriptStore } from '../stores/transcriptStore'
import { useAppSettingsStore } from '../stores/appSettingsStore'
import * as localStore from '../stt/localStore'
import { flushAll as syncFlushAll } from '../stt/syncQueue'
import type { LocalMeetingMeta } from '../stt/localStore'

type LocalStatus = 'loading' | 'idle' | 'recording' | 'stopped' | 'unavailable'

export interface UseLocalRecordingResult {
  status: LocalStatus
  meta: LocalMeetingMeta | null
  error: string | null
  elapsedSeconds: number
  isRecording: boolean
  /** 온디바이스 모델 선로딩 중(녹음 시작 게이트 UI용). */
  modelLoading: boolean
  start: () => Promise<void>
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

  const reset = useTranscriptStore((s) => s.reset)
  const loadFinals = useTranscriptStore((s) => s.loadFinals)
  const localUploadEnabled = useAppSettingsStore((s) => s.localUploadEnabled)

  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const elapsedBaseRef = useRef<number | null>(null)
  // 재진입 가드(동기): stt_load 콜드로드 await 중에는 status가 아직 'recording'이 아니라
  // 사용자가 시작을 또 누를 수 있다. start()가 두 번 진입하면 mic 캡처 파이프라인이
  // 2벌 동시 가동되어(AudioContext/워크릿/STT 중복) 모든 발화가 중복 전사된다.
  const startingRef = useRef(false)
  // 모델 선로딩 dir 가드: 같은 modelDir에 대해 stt_load를 1회만 호출(재렌더/언어유지 시 중복 방지).
  const preloadedDirRef = useRef<string | null>(null)

  const localStt = useLocalStt({
    localId,
    language,
    modelDir,
    uploadEnabled: localUploadEnabled,
  })

  const mic = useMicCapture({
    onChunk: (pcm, meta) => localStt.sendChunk(pcm, meta),
  })

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
    // 이미 시작 중이거나 녹음 중이면 무시(이중 시작 → 파이프라인 중복 방지).
    if (startingRef.current || status === 'recording') return
    startingRef.current = true
    setError(null)
    try {
      // recognizer 콜드로드 선행(첫 세그먼트 지연 방지).
      await invoke('stt_load', { modelDir, language }).catch(() => {})
      await mic.start(0, 0)
      await localStore.setStatus(localId, 'recording').catch(() => {})
      elapsedBaseRef.current = Date.now()
      elapsedTimerRef.current = setInterval(tick, 1000)
      setStatus('recording')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      startingRef.current = false
    }
  }, [modelDir, language, localId, mic, tick, status])

  const stop = useCallback(async () => {
    mic.stop()
    localStt.flush()
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
    elapsedBaseRef.current = null
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
    }
  }, [])

  return {
    status,
    meta,
    error,
    elapsedSeconds,
    isRecording: status === 'recording',
    modelLoading,
    start,
    stop,
  }
}
