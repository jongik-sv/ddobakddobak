import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useUiStore } from '../stores/uiStore'
import { useToastStore } from '../stores/toastStore'
import { useAudioRecorder } from './useAudioRecorder'
import { useSystemAudioCapture } from './useSystemAudioCapture'
import { useMicCapture } from './useMicCapture'
import { useTranscription } from './useTranscription'
import { useLocalStt } from './useLocalStt'
import { resolveSttModeWithReason } from '../stt/sttModeResolver'
import { localSttLanguage } from '../stt/cohereLang'
import { probeUrl } from '../lib/bridge'
import * as localStore from '../stt/localStore'
import { flushAll as syncFlushAll } from '../stt/syncQueue'
import { useAppSettingsStore } from '../stores/appSettingsStore'
import {
  getMeeting,
  startMeeting,
  stopMeeting,
  pauseMeeting,
  resumeMeeting,
  reopenMeeting,
  promoteAudio,
  uploadAudioChunk,
  finalizeAudio,
  triggerRealtimeSummary,
  getTranscripts,
  getSummary,
  resetMeetingContent,
  getParticipants,
} from '../api/meetings'
import type { Meeting, Participant } from '../api/meetings'
import { getSttSettings, getLanguageSettings } from '../api/settings'
import { useTranscriptStore } from '../stores/transcriptStore'
import { useSharingStore } from '../stores/sharingStore'
import { IS_TAURI, getApiOrigin, getMode } from '../config'
import { useAuthStore } from '../stores/authStore'
import { mapTranscriptsToFinals } from '../lib/transcriptMapper'
import { useRecordingSummaryTimer } from './useRecordingSummaryTimer'
import { useRecorderHeartbeat } from './useRecorderHeartbeat'
import { useScreenWakeLock } from './useScreenWakeLock'
import { newSilenceState, tickSilence } from '../lib/silenceAutoComplete'

type MeetingStatus = 'idle' | 'recording' | 'stopped'
type ChunkMeta = { sequence: number; offsetMs: number }

interface UseLiveRecordingOptions {
  isApplyingCorrections: boolean
  clearMemoEditor: () => void
}

/**
 * 회의 라이브 세션(녹음/캡처/요약/메모로드/접근가드 외 세션상태) 컨트롤러.
 * MeetingLivePage 렌더에서 사용하는 세션 상태와 핸들러를 반환한다.
 */
export function useLiveRecording(
  meetingId: number,
  { isApplyingCorrections, clearMemoEditor }: UseLiveRecordingOptions
) {
  const navigate = useNavigate()
  const location = useLocation()

  // 상태 토스트는 전역 스토어 경유 — 백그라운드 녹음 종료 메시지가 라우트 무관 표시되도록.
  const showStatus = (msg: string, durationMs?: number) =>
    useToastStore.getState().showStatus(msg, durationMs)

  // 회의실 진입 시 사이드바 닫기 + 이전 거부 플래그 초기화
  useEffect(() => {
    useUiStore.setState({ sidebarOpen: false })
    useSharingStore.getState().setRecordingDenied(false)
  }, [])

  const [status, setStatus] = useState<MeetingStatus>('idle')
  const isActive = status === 'recording'
  const [meetingApiStatus, setMeetingApiStatus] = useState<'pending' | 'recording' | 'completed' | null>(null)
  const [sttEngine, setSttEngine] = useState<string | null>(null)
  const [, setAudioDurationMs] = useState(0)
  const [, setLastSeqNum] = useState(0)

  // 회의 정보
  const [meeting, setMeeting] = useState<Meeting | null>(null)

  // 초기화 확인 다이얼로그
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  // 종료 시 최종요약 여부 확인 다이얼로그
  const [showStopConfirm, setShowStopConfirm] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)

  // 경과 시간
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const elapsedBaseRef = useRef<number | null>(null)

  const reset = useTranscriptStore((s) => s.reset)
  const loadFinals = useTranscriptStore((s) => s.loadFinals)
  const setMeetingNotes = useTranscriptStore((s) => s.setMeetingNotes)
  const markReset = useTranscriptStore((s) => s.markReset)
  const finalsCount = useTranscriptStore((s) => s.finals.length)
  const isSummarizing = useTranscriptStore((s) => s.isSummarizing)

  // 공유 상태
  const isSharing = useSharingStore((s) => s.shareCode !== null)
  const sharingParticipants = useSharingStore((s) => s.participants)
  // 다른 세션이 이미 녹음 중 → 읽기전용 뷰어로 라우팅 (단일 녹음 세션 보장)
  const recordingDenied = useSharingStore((s) => s.recordingDenied)
  const [currentUserId, setCurrentUserId] = useState<number>(0)
  const isHost = useMemo(() => {
    const host = sharingParticipants.find((p) => p.role === 'host')
    return host?.user_id === currentUserId && currentUserId !== 0
  }, [sharingParticipants, currentUserId])

  // 메모 (초기 로드 값)
  const [meetingMemo, setMeetingMemo] = useState<string | null>(null)

  // 페이지 진입 시 기존 기록 + AI 회의록 로드
  useEffect(() => {
    reset()

    // 기존 기록 로드
    getTranscripts(meetingId)
      .then((transcripts) => loadFinals(mapTranscriptsToFinals(transcripts)))
      .catch(() => {})

    // 기존 AI 회의록 로드
    getSummary(meetingId).then((summary) => {
      if (summary?.notes_markdown) {
        setMeetingNotes(summary.notes_markdown)
      }
    }).catch(() => {})
  }, [meetingId, reset, loadFinals, setMeetingNotes])

  const [systemAudioEnabled, setSystemAudioEnabled] = useState(false)
  const { sendChunk, sendSystemChunk, sendHeartbeat } = useTranscription(meetingId)

  // ── 온디바이스(로컬) STT (Android). 서버 모드면 미사용이지만 훅 규칙상 항상 호출. ──
  const sttMode = useAppSettingsStore((s) => s.sttMode)
  const localUploadEnabled = useAppSettingsStore((s) => s.localUploadEnabled)
  // 활성 모드(server/local) — 시작 시 resolveSttMode로 확정. 기본 server.
  const [activeSttMode, setActiveSttMode] = useState<'server' | 'local'>('server')
  const [localCtx, setLocalCtx] = useState<{
    localId: string | null
    language: string
    modelDir: string | null
  }>({ localId: null, language: 'ko', modelDir: null })

  const localStt = useLocalStt({
    localId: localCtx.localId,
    language: localCtx.language,
    modelDir: localCtx.modelDir,
    uploadEnabled: localUploadEnabled,
  })

  // 활성 모드에 따라 마이크 청크를 서버/로컬 STT로 라우팅.
  const onChunkRef = useRef(sendChunk)
  onChunkRef.current = activeSttMode === 'local' ? localStt.sendChunk : sendChunk

  // 무음 5분 자동완료 — timer 기반 (VAD onChunk는 유음에만 발화 → 무음 중 호출 없음)
  const silenceRef = useRef(newSilenceState())
  // 인터벌 틱 사이에 VAD 청크(유음)가 도착했는지 기록
  const soundSinceTickRef = useRef(false)
  // stale closure 방지: handleStop을 매 렌더마다 최신으로 갱신
  const handleStopRef = useRef<() => void>(() => {})

  const systemChunkRef = useRef(sendSystemChunk)
  // 시스템 오디오는 로컬 모드에서도 마이크와 믹싱되어 같은 로컬 스트림으로 가므로
  // 별도 시스템 청크 전송은 서버 모드에서만 의미가 있다.
  systemChunkRef.current = activeSttMode === 'local' ? () => {} : sendSystemChunk

  // 오디오 업로드 프로미스 추적 (중단→재시작 시 업로드 완료 보장)
  const uploadPromiseRef = useRef<Promise<void> | null>(null)

  const onStop = useCallback(
    async (blob: Blob) => {
      const task = (async () => {
        // promoteAudio는 res.ok를 검사해 실패 시 throw → 성공했을 때만 로컬 녹음 파일을 정리한다.
        await promoteAudio(meetingId, blob)
        if (IS_TAURI) {
          const { invoke } = await import('@tauri-apps/api/core')
          await invoke('delete_recording', { meetingId })
        }
      })()
      uploadPromiseRef.current = task
      try {
        await task
      } catch (err) {
        // 업로드 실패 → recordings/<id>.wav 보존. 다음 앱 시작 시 복구 스윕이 재업로드한다.
        console.error('[useLiveRecording] 오디오 업로드 실패, 복구용 파일 보존', err)
      } finally {
        uploadPromiseRef.current = null
      }
    },
    [meetingId]
  )

  const { isRecording, isPaused, error, start, stop, discard, pause, resume, feedSystemAudio } = useAudioRecorder({
    meetingId,
    onChunk: (pcm: Int16Array, meta: ChunkMeta) => {
      // VAD 청크 수신 = 유음 증거 → 무음 자동완료 카운터 플래그 세팅
      soundSinceTickRef.current = true
      onChunkRef.current(pcm, meta)
    },
    onStop,
    // 모바일 청크 레코더: 녹음 중 압축 청크 연속 업로드 + 종료 시 서버 합치기/변환
    onAudioChunk: (blob, seq) => uploadAudioChunk(meetingId, blob, seq),
    onFinalize: () => {
      uploadPromiseRef.current = finalizeAudio(meetingId)
      return uploadPromiseRef.current
    },
  })

  // 라이브 세션 보조 훅 (god 분해): 자동/수동 요약 타이머 + 이탈 차단 가드
  const { summaryCountdown, handleManualSummary, resetSummaryTimer, summaryIntervalSec, setSummaryIntervalSec } = useRecordingSummaryTimer({
    isActive,
    isPaused,
    isApplyingCorrections,
    meetingId,
    finalsCount,
    isSummarizing,
    showStatus,
  })

  // Tauri 네이티브 마이크 캡처 (STT용) — 시스템 오디오도 여기서 믹싱하여 하나의 STT 스트림으로 처리
  const {
    start: startMicCapture,
    stop: stopMicCapture,
    pause: pauseMicCapture,
    resume: resumeMicCapture,
    feedSystemAudio: feedMicSystemAudio,
  } = useMicCapture({
    onChunk: (pcm: Int16Array, meta: ChunkMeta) => {
      // VAD 청크 수신 = 유음 증거 → 무음 자동완료 카운터 플래그 세팅
      soundSinceTickRef.current = true
      onChunkRef.current(pcm, meta)
    },
  })

  // 시스템 오디오 믹싱 대상 ref (Tauri: useMicCapture, 브라우저: useAudioRecorder)
  const feedSystemAudioRef = useRef(IS_TAURI ? feedMicSystemAudio : feedSystemAudio)
  feedSystemAudioRef.current = IS_TAURI ? feedMicSystemAudio : feedSystemAudio

  const {
    isCapturing: isSystemCapturing,
    error: systemAudioError,
    start: startSystemCapture,
    stop: stopSystemCapture,
  } = useSystemAudioCapture({
    // 시스템 오디오 VAD 청크 → 별도 STT 스트림으로 전송
    onChunk: (pcm: Int16Array, meta: ChunkMeta) => systemChunkRef.current(pcm, meta),
    // 원본 PCM을 마이크 캡처에 전달하여 믹싱 후 STT
    onRawAudio: (pcm: Int16Array) => feedSystemAudioRef.current(pcm),
  })

  // 다른 세션이 이미 녹음 중이면(백엔드 recording_in_progress/recording_denied):
  // 진행 중인 로컬 캡처는 폐기(업로드 안 함)하고 읽기전용 뷰어로 이동한다.
  useEffect(() => {
    if (!recordingDenied) return
    if (IS_TAURI) stopMicCapture()
    stopSystemCapture()
    if (isRecording) discard()
    // 훅이 라우트 무관 세션으로 옮겨지므로(B), 다른 라우트(대시보드 등)에서 2번째 클라
    // 레이스로 navigate가 발화하면 사용자를 엉뚱하게 끌어간다. 이 회의의 live 라우트일 때만 이동.
    if (location.pathname === `/meetings/${meetingId}/live`) {
      navigate(`/meetings/${meetingId}/viewer`, { replace: true })
    }
  }, [recordingDenied, isRecording, meetingId, navigate, location.pathname, discard, stopMicCapture, stopSystemCapture])

  const handleStart = async () => {
    // 이전 세션 오디오 업로드 완료 대기 (중단→재시작 싱크 보장)
    if (uploadPromiseRef.current) {
      showStatus('이전 녹음 저장 중... 잠시 기다려주세요', 10000)
      await uploadPromiseRef.current.catch(() => {})
    }

    // ── STT 모드 결정 (server/local). 로컬 가능성 = Android + 모델 + 언어∈Cohere8 + single. ──
    // 주의: 이 분기는 "서버 회의가 이미 존재하는" 경로다(useLiveRecording은 numeric
    // meetingId 기반). 완전 오프라인 회의 생성은 별도 진입점(T16)에서 처리한다.
    let resolved: 'server' | 'local' = 'server'
    if (IS_TAURI) {
      try {
        const langCfg = await getLanguageSettings().catch(
          () => ({ mode: 'single' as const, languages: ['ko'] }),
        )
        const lang = localSttLanguage(langCfg)
        let modelDir: string | null = null
        if (lang) {
          const { invoke } = await import('@tauri-apps/api/core')
          const paths = await invoke<{ dir: string }>('resolve_model_paths').catch(() => null)
          modelDir = paths?.dir ?? null
        }
        const localCapable = lang != null && modelDir != null
        // probe_url은 bare origin을 기대한다(/api/v1/health를 직접 붙임) — getApiBaseUrl을
        // 넘기면 /api/v1/api/v1/health로 항상 404 → 서버가 살아 있어도 로컬로 폴백한다.
        const serverReachable = await probeUrl(getApiOrigin()).catch(() => false)
        const resolution = resolveSttModeWithReason({ manualMode: sttMode, serverReachable, localCapable })
        resolved = resolution.mode
        // 모드 결정을 사용자에게 알린다 — 조용한 폴백은 "녹음은 되는데 서버 회의록에
        // 전사가 없는" 사고로 이어진다(전사가 로컬 store에만 저장되므로).
        if (resolution.mode === 'local') {
          showStatus(
            resolution.reason === 'auto-offline'
              ? '서버에 연결할 수 없어 온디바이스 STT로 전사합니다 — 전사는 이 기기에만 저장됩니다'
              : '개인설정에 따라 온디바이스 STT로 전사합니다 — 전사는 이 기기에만 저장됩니다',
            8000,
          )
        } else if (resolution.reason === 'local-incapable') {
          showStatus('온디바이스 STT 사용 불가(모델/언어) — 서버 STT로 전사합니다', 8000)
        }
        if (resolved === 'local' && lang) {
          // 로컬 회의 진실원천 생성(영속) + recognizer 콜드로드 선행(첫 세그먼트 지연 방지).
          const latestMeeting = await getMeeting(meetingId).catch(() => null)
          const localId = await localStore.createLocal({
            title: latestMeeting?.title ?? `회의 ${meetingId}`,
            lang,
          })
          setLocalCtx({ localId, language: lang, modelDir })
          import('@tauri-apps/api/core')
            .then(({ invoke }) => invoke('stt_load', { modelDir, language: lang }))
            .catch((e) => console.warn('[useLocalStt] stt_load preload 실패:', e))
        }
      } catch (e) {
        console.warn('[useLiveRecording] STT 모드 결정 실패, 서버 폴백:', e)
        resolved = 'server'
      }
    }
    setActiveSttMode(resolved)

    // 재개 시 최신 오디오 길이 + 시퀀스 번호를 서버에서 가져옴.
    // 로컬 모드(auto-offline)는 서버 미도달이 정상 상태 — 실패 시 0부터 시작해
    // 녹음은 계속돼야 한다. 서버 모드에선 실패가 곧 진행 불가이므로 그대로 throw.
    // 이 fetch는 start/reopen 분기보다 먼저 와야 한다 — 갓 마운트된 세션은
    // meetingApiStatus state 가 아직 null(getMeeting 미해결)이라, stale closure 로
    // 분기하면 종료된(completed) 회의를 startMeeting(422)으로 잘못 보내 녹음이
    // 종료 상태 회의에 묶인다(조용한 데이터 손실). 갓 가져온 상태로 분기한다.
    const latest =
      resolved === 'local' ? await getMeeting(meetingId).catch(() => null) : await getMeeting(meetingId)

    try {
      if (latest?.status === 'completed') {
        await reopenMeeting(meetingId)
      } else if (latest?.status !== 'recording') {
        await startMeeting(meetingId)
      }
    } catch {
      // 이미 recording 등 — 무시
    }
    const offsetMs = Math.max(latest?.audio_duration_ms ?? 0, latest?.last_transcript_end_ms ?? 0)
    const seqNum = latest?.last_sequence_number ?? 0
    setAudioDurationMs(offsetMs)
    setLastSeqNum(seqNum)

    // 경과 시간을 이전 녹음 시간 이어서 시작
    const baseSec = Math.floor(offsetMs / 1000)
    setElapsedSeconds(baseSec)
    elapsedBaseRef.current = Date.now() - baseSec * 1000

    // 무음 자동완료 카운터 초기화 (재시작 포함)
    silenceRef.current = newSilenceState()
    soundSinceTickRef.current = false

    await start(offsetMs, seqNum + 1)

    // Tauri 모드: 네이티브 마이크 캡처 시작 (녹음 시작 후에 호출 — recorder가 먼저 존재해야 함)
    if (IS_TAURI) {
      startMicCapture(offsetMs, seqNum + 1).catch((err) =>
        console.warn('[MicCapture] 시작 실패:', err)
      )
    }

    // 시스템 오디오 캡처 (활성화된 경우) — STT는 마이크와 믹싱하여 처리
    if (systemAudioEnabled) {
      startSystemCapture(offsetMs, 0).catch((err) =>
        console.warn('[SystemAudio] 시작 실패:', err)
      )
    }

    setMeetingApiStatus('recording')
    setStatus('recording')
  }

  const handlePause = () => {
    if (IS_TAURI) {
      pauseMicCapture()
      import('@tauri-apps/api/core').then(({ invoke }) => invoke('pause_recording')).catch(() => {})
    }
    pause()
    // 일시정지 중 요약 완전 금지 — flush 호출하지 않음. 서버에 일시정지 통지(cron 자동요약 차단).
    pauseMeeting(meetingId).catch(() => {})
  }

  const handleResume = () => {
    if (IS_TAURI) {
      resumeMicCapture()
      import('@tauri-apps/api/core').then(({ invoke }) => invoke('resume_recording')).catch(() => {})
    }
    resume()
    resumeMeeting(meetingId).catch(() => {})
  }

  // 종료 버튼: 라이브 기록 있으면 최종요약 여부 확인 다이얼로그, 없으면 바로 종료(skip).
  const handleStop = () => {
    if (finalsCount === 0) {
      performStop(true)
      return
    }
    setShowStopConfirm(true)
  }
  // stale closure 방지: 매 렌더마다 최신 handleStop으로 갱신 (무음 자동완료 timer에서 사용)
  handleStopRef.current = handleStop

  const confirmStopSummarize = () => {
    setShowStopConfirm(false)
    performStop(false)
  }

  const confirmStopSkip = () => {
    setShowStopConfirm(false)
    performStop(true)
  }

  const cancelStop = () => setShowStopConfirm(false)

  const performStop = async (skipSummary: boolean) => {
    setIsStopping(true)
    showStatus('회의 종료 중... 기록을 회의록에 적용하고 있습니다', 10000)
    // 캡처 먼저 중지 → 녹음기에 남은 데이터 플러시
    if (IS_TAURI) {
      stopMicCapture()
    }
    stopSystemCapture()
    await stop()

    // 로컬 모드: 잔여 세그먼트 flush(마지막 발화) + 로컬 회의 종료 마킹 + opt-in 프로모트.
    if (activeSttMode === 'local') {
      // 워클릿 flush 청크는 stopMicCapture() 후 ~200ms(teardown 창) 안에 비동기로 도착한다.
      // 즉시 flush()하면 마지막 발화가 아직 드레인에 안 들어와 스냅샷에서 빠진다
      // (useLocalRecording.stop과 동일한 250ms 대기 정책).
      await new Promise((r) => setTimeout(r, 250))
      // 진행 중 전사 드레인 완료까지 대기 — 안 기다리면 마지막 발화가 종료/프로모트에서 누락된다.
      await localStt.flush()
      if (localCtx.localId) {
        await localStore.setStatus(localCtx.localId, 'completed').catch(() => {})
        if (localUploadEnabled) {
          // 서버 도달 시 즉시 프로모트 시도(실패 시 syncQueue가 pending 유지).
          await syncFlushAll().catch(() => {})
        }
      }
    }
    try {
      // 요약함 선택 시에만 종료 전 미적용 기록 flush. 건너뛰기면 생략.
      if (!skipSummary) {
        await triggerRealtimeSummary(meetingId).catch(() => {})
        // 요약 반영 시간 확보
        await new Promise((r) => setTimeout(r, 2000))
      }
      await stopMeeting(meetingId, { skipSummary })
      // 최종 회의록 다시 로드
      const summary = await getSummary(meetingId).catch(() => null)
      if (summary?.notes_markdown) {
        setMeetingNotes(summary.notes_markdown)
      }
      showStatus('회의가 종료되었습니다')
    } finally {
      setStatus('stopped')
      setMeetingApiStatus('completed')
      setIsStopping(false)
      setElapsedSeconds(0)
      elapsedBaseRef.current = null
    }
  }

  const handleResetClick = () => {
    setShowResetConfirm(true)
  }

  const handleResetConfirm = async () => {
    setShowResetConfirm(false)
    setIsResetting(true)
    try {
      // 녹음 중 초기화면 캡처·네이티브 녹음부터 정지 (recordingDenied 처리와 동일 패턴).
      // 안 멈추면 좀비 캡처가 살아남아 다음 시작에서 청크 이중 전송(전사 2배) +
      // 네이티브 start_recording이 "녹음이 이미 진행 중입니다"로 거부된다.
      if (isRecording) {
        if (IS_TAURI) stopMicCapture()
        stopSystemCapture()
        await discard()
      }
      await resetMeetingContent(meetingId)
      // reset 시각 기록 → 잔여 broadcast 무시
      markReset()
      // 기록 + 회의록 스토어 초기화
      reset()
      // 회의록 명시 초기화 (broadcast 의존 제거)
      setMeetingNotes(null)
      // 메모 에디터 초기화
      clearMemoEditor()
      // 로컬 상태 초기화
      setStatus('idle')
      setMeetingApiStatus('pending')
      setAudioDurationMs(0)
      setLastSeqNum(0)
      setElapsedSeconds(0)
      elapsedBaseRef.current = null
      resetSummaryTimer()
    } catch (err) {
      console.error('회의 초기화 실패:', err)
    } finally {
      setIsResetting(false)
    }
  }

  // 녹음 상태를 글로벌 스토어에 동기화 (폴더 클릭 차단용)
  const setRecordingActive = useUiStore((s) => s.setRecordingActive)
  useEffect(() => {
    setRecordingActive(isActive)
    return () => setRecordingActive(false)
  }, [isActive, setRecordingActive])

  // 데스크톱 로컬 전용: 녹음 on/off를 Rust AssertionState에 통지 (caffeinate 유지)
  useEffect(() => {
    if (!IS_TAURI || getMode() !== 'local') return
    import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('set_recording', { active: isActive }))
      .catch(() => {})
    return () => {
      // 언마운트 시 녹음 플래그 해제 — 안 하면 caffeinate가 앱 세션 내내 유지(역누수)
      import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('set_recording', { active: false }))
        .catch(() => {})
    }
  }, [isActive])

  // 웹 브라우저 전용: 녹음 중 화면 자동 꺼짐 방지 (Screen Wake Lock).
  // 일시정지 중에도 status는 'recording'이라 유지 — 하트비트와 동일 의미론(클라 생존).
  // 게이트(isActive && !recordingDenied)도 하트비트와 동일 — 녹음 거부된 클라가 lock을 계속 쥐지 않게.
  useScreenWakeLock(isActive && !recordingDenied)

  // 녹음 클라 생존 하트비트: "이 클라가 활성 녹음 중"일 때만 ~15초마다 전송.
  // 게이트(isActive && !recordingDenied)로 시청자·idle·녹음거부 컨텍스트에서는 0회.
  // 안 그러면 2번째 탭/기기가 owner 롤로 keep-alive 를 보내 stale-recording 자동종결이 무력화된다.
  // 일시정지(isPaused) 중에도 status 는 'recording' 이라 isActive 유지 → 하트비트 계속(클라 생존).
  useRecorderHeartbeat(isActive && !recordingDenied, sendHeartbeat)

  // 경과 시간 타이머
  useEffect(() => {
    if (isActive && !isPaused) {
      if (elapsedBaseRef.current === null) {
        elapsedBaseRef.current = Date.now() - elapsedSeconds * 1000
      }
      const interval = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - elapsedBaseRef.current!) / 1000))
      }, 1000)
      return () => clearInterval(interval)
    } else if (isPaused) {
      elapsedBaseRef.current = null
    }
    // 리셋은 handleStop / handleResetConfirm에서 명시적으로 처리
  }, [isActive, isPaused])

  // 무음 5분 자동완료 타이머 (5초 틱)
  // VAD onChunk는 유음에만 발화하므로, tick 사이에 청크가 왔는지로 유/무음 판정.
  const SILENCE_TICK_MS = 5_000
  useEffect(() => {
    if (!isActive || isPaused) return
    const id = setInterval(() => {
      const hadSound = soundSinceTickRef.current
      soundSinceTickRef.current = false
      if (tickSilence(silenceRef.current, SILENCE_TICK_MS, hadSound)) {
        console.log('[silenceAutoComplete] 무음 5분 → 자동완료')
        handleStopRef.current()
      }
    }, SILENCE_TICK_MS)
    return () => clearInterval(id)
  }, [isActive, isPaused])

  const handleToggleSystemAudio = async (next: boolean) => {
    setSystemAudioEnabled(next)

    // 녹음 중이면 즉시 캡처 시작/중지
    if (isActive) {
      if (next) {
        const latest = await getMeeting(meetingId)
        const offsetMs = Math.max(latest.audio_duration_ms ?? 0, latest.last_transcript_end_ms ?? 0)
        startSystemCapture(offsetMs, 0).catch((err) =>
          console.warn('[SystemAudio] 시작 실패:', err)
        )
      } else {
        stopSystemCapture()
      }
    }
  }

  useEffect(() => {
    getMeeting(meetingId)
      .then((m) => {
        setMeeting(m)
        setMeetingApiStatus(m.status as 'pending' | 'recording' | 'completed')
        setAudioDurationMs(m.audio_duration_ms ?? 0)
        setLastSeqNum(m.last_sequence_number ?? 0)
        if (m.memo) setMeetingMemo(m.memo)
        // 현재 사용자 ID 저장 (호스트 여부 판별용) - 인증된 유저 우선
        const authUser = useAuthStore.getState().user
        setCurrentUserId(authUser?.id ?? m.created_by.id)
        // 공유 상태 초기화: share_code가 있으면 참여자 로드
        if (m.share_code) {
          getParticipants(meetingId)
            .then((participants) => {
              useSharingStore.getState().startSharing(
                m.share_code!,
                participants,
              )
            })
            .catch(() => {})
        } else {
          useSharingStore.getState().reset()
        }
      })
      .catch(() => {})
  }, [meetingId])

  // 페이지 언마운트 시 sharingStore 초기화
  useEffect(() => {
    return () => {
      useSharingStore.getState().reset()
    }
  }, [])

  useEffect(() => {
    getSttSettings()
      .then((s) => setSttEngine(s.stt_engine))
      .catch(() => {})
  }, [])

  return {
    meeting,
    setMeeting,
    meetingMemo,
    meetingApiStatus,
    sttEngine,
    activeSttMode,
    isPaused,
    error,
    systemAudioError,
    isSystemCapturing,
    elapsedSeconds,
    summaryCountdown,
    summaryIntervalSec,
    setSummaryIntervalSec,
    systemAudioEnabled,
    handleToggleSystemAudio,
    isResetting,
    isStopping,
    isActive,
    isSharing,
    isHost,
    currentUserId,
    showResetConfirm,
    setShowResetConfirm,
    handleStart,
    handlePause,
    handleResume,
    handleStop,
    performStop,
    handleManualSummary,
    canManualSummary: isActive && !isPaused && finalsCount > 0 && !isSummarizing,
    showStopConfirm,
    confirmStopSummarize,
    confirmStopSkip,
    cancelStop,
    handleResetClick,
    handleResetConfirm,
  } as const
}

export type { Participant }
