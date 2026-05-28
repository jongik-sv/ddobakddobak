import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUiStore } from '../stores/uiStore'
import { useAudioRecorder } from './useAudioRecorder'
import { useSystemAudioCapture } from './useSystemAudioCapture'
import { useMicCapture } from './useMicCapture'
import { useTranscription } from './useTranscription'
import {
  getMeeting,
  startMeeting,
  stopMeeting,
  reopenMeeting,
  uploadAudio,
  uploadAudioChunk,
  finalizeAudio,
  triggerRealtimeSummary,
  getTranscripts,
  getSummary,
  resetMeetingContent,
  getParticipants,
} from '../api/meetings'
import type { Meeting, Participant } from '../api/meetings'
import { getSttSettings } from '../api/settings'
import { useTranscriptStore } from '../stores/transcriptStore'
import { useSharingStore } from '../stores/sharingStore'
import { IS_TAURI, DEFAULT_SUMMARY_INTERVAL_SEC } from '../config'
import { useAuthStore } from '../stores/authStore'
import { mapTranscriptsToFinals } from '../lib/transcriptMapper'

type MeetingStatus = 'idle' | 'recording' | 'stopped'
type ChunkMeta = { sequence: number; offsetMs: number }

interface UseLiveRecordingOptions {
  showStatus: (msg: string, durationMs?: number) => void
  isApplyingCorrections: boolean
  clearMemoEditor: () => void
}

/**
 * 회의 라이브 세션(녹음/캡처/요약/메모로드/접근가드 외 세션상태) 컨트롤러.
 * MeetingLivePage 렌더에서 사용하는 세션 상태와 핸들러를 반환한다.
 */
export function useLiveRecording(
  meetingId: number,
  { showStatus, isApplyingCorrections, clearMemoEditor }: UseLiveRecordingOptions
) {
  const navigate = useNavigate()

  // 회의실 진입 시 사이드바 닫기 + 이전 거부 플래그 초기화
  useEffect(() => {
    useUiStore.setState({ sidebarOpen: false })
    useSharingStore.getState().setRecordingDenied(false)
  }, [])

  const [status, setStatus] = useState<MeetingStatus>('idle')
  const [meetingApiStatus, setMeetingApiStatus] = useState<'pending' | 'recording' | 'completed' | null>(null)
  const [sttEngine, setSttEngine] = useState<string | null>(null)
  const [summaryCountdown, setSummaryCountdown] = useState<number>(0)
  const [, setAudioDurationMs] = useState(0)
  const [, setLastSeqNum] = useState(0)

  // 녹음 중 뒤로가기 차단
  const [showLeaveBlock, setShowLeaveBlock] = useState(false)

  // 회의 정보
  const [meeting, setMeeting] = useState<Meeting | null>(null)

  // 초기화 확인 다이얼로그
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)

  // 경과 시간
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const elapsedBaseRef = useRef<number | null>(null)

  const reset = useTranscriptStore((s) => s.reset)
  const loadFinals = useTranscriptStore((s) => s.loadFinals)
  const setMeetingNotes = useTranscriptStore((s) => s.setMeetingNotes)
  const markReset = useTranscriptStore((s) => s.markReset)
  const [summaryIntervalSec, setSummaryIntervalSec] = useState(DEFAULT_SUMMARY_INTERVAL_SEC)

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
  const { sendChunk, sendSystemChunk } = useTranscription(meetingId)

  const onChunkRef = useRef(sendChunk)
  onChunkRef.current = sendChunk

  const systemChunkRef = useRef(sendSystemChunk)
  systemChunkRef.current = sendSystemChunk

  // 오디오 업로드 프로미스 추적 (중단→재시작 시 업로드 완료 보장)
  const uploadPromiseRef = useRef<Promise<void> | null>(null)

  const onStop = useCallback(
    async (blob: Blob) => {
      uploadPromiseRef.current = uploadAudio(meetingId, blob)
      try {
        await uploadPromiseRef.current
      } finally {
        uploadPromiseRef.current = null
      }
    },
    [meetingId]
  )

  const { isRecording, isPaused, error, start, stop, discard, pause, resume, feedSystemAudio } = useAudioRecorder({
    onChunk: (pcm: Int16Array, meta: ChunkMeta) => onChunkRef.current(pcm, meta),
    onStop,
    // 모바일 청크 레코더: 녹음 중 압축 청크 연속 업로드 + 종료 시 서버 합치기/변환
    onAudioChunk: (blob, seq) => uploadAudioChunk(meetingId, blob, seq),
    onFinalize: () => {
      uploadPromiseRef.current = finalizeAudio(meetingId)
      return uploadPromiseRef.current
    },
  })

  // Tauri 네이티브 마이크 캡처 (STT용) — 시스템 오디오도 여기서 믹싱하여 하나의 STT 스트림으로 처리
  const {
    start: startMicCapture,
    stop: stopMicCapture,
    pause: pauseMicCapture,
    resume: resumeMicCapture,
    feedSystemAudio: feedMicSystemAudio,
  } = useMicCapture({
    onChunk: (pcm: Int16Array, meta: ChunkMeta) => onChunkRef.current(pcm, meta),
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
    navigate(`/meetings/${meetingId}/viewer`, { replace: true })
  }, [recordingDenied, isRecording, meetingId, navigate, discard, stopMicCapture, stopSystemCapture])

  const handleStart = async () => {
    // 이전 세션 오디오 업로드 완료 대기 (중단→재시작 싱크 보장)
    if (uploadPromiseRef.current) {
      showStatus('이전 녹음 저장 중... 잠시 기다려주세요', 10000)
      await uploadPromiseRef.current.catch(() => {})
    }

    try {
      if (meetingApiStatus === 'completed') {
        await reopenMeeting(meetingId)
      }
      if (meetingApiStatus !== 'recording') {
        await startMeeting(meetingId)
      }
    } catch {
      // 이미 recording 상태인 경우 무시
    }
    // 재개 시 최신 오디오 길이 + 시퀀스 번호를 서버에서 가져옴
    const latest = await getMeeting(meetingId)
    const offsetMs = Math.max(latest.audio_duration_ms ?? 0, latest.last_transcript_end_ms ?? 0)
    const seqNum = latest.last_sequence_number ?? 0
    setAudioDurationMs(offsetMs)
    setLastSeqNum(seqNum)

    // 경과 시간을 이전 녹음 시간 이어서 시작
    const baseSec = Math.floor(offsetMs / 1000)
    setElapsedSeconds(baseSec)
    elapsedBaseRef.current = Date.now() - baseSec * 1000

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
    // 일시정지 시 아직 적용되지 않은 기록을 AI 회의록에 반영
    triggerRealtimeSummary(meetingId).catch(() => {})
  }

  const handleResume = () => {
    if (IS_TAURI) {
      resumeMicCapture()
      import('@tauri-apps/api/core').then(({ invoke }) => invoke('resume_recording')).catch(() => {})
    }
    resume()
  }

  const handleStop = async () => {
    setIsStopping(true)
    showStatus('회의 종료 중... 기록을 회의록에 적용하고 있습니다', 10000)
    // 캡처 먼저 중지 → 녹음기에 남은 데이터 플러시
    if (IS_TAURI) {
      stopMicCapture()
    }
    stopSystemCapture()
    await stop()
    try {
      // 종료 전 미적용 기록을 AI 회의록에 반영
      await triggerRealtimeSummary(meetingId).catch(() => {})
      // 요약 반영 시간 확보
      await new Promise((r) => setTimeout(r, 2000))
      await stopMeeting(meetingId)
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
      setSummaryCountdown(0)
      setElapsedSeconds(0)
      elapsedBaseRef.current = null
    } catch (err) {
      console.error('회의 초기화 실패:', err)
    } finally {
      setIsResetting(false)
    }
  }

  const isActive = status === 'recording'

  // 뒤로가기 (미리보기로)
  const handleNavigateBack = () => {
    if (isActive) {
      setShowLeaveBlock(true)
      return
    }
    navigate(`/meetings/${meetingId}`)
  }

  // 녹음 상태를 글로벌 스토어에 동기화 (폴더 클릭 차단용)
  const setRecordingActive = useUiStore((s) => s.setRecordingActive)
  useEffect(() => {
    setRecordingActive(isActive)
    return () => setRecordingActive(false)
  }, [isActive, setRecordingActive])

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

  // 녹음 중 브라우저 뒤로가기/새로고침 차단
  useEffect(() => {
    if (!isActive) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isActive])

  // 녹음 중 Option+←/→ (히스토리 뒤로/앞으로) 키보드 단축키 차단
  useEffect(() => {
    if (!isActive) return
    const handler = (e: KeyboardEvent) => {
      // Option+← 또는 Option+→ (macOS 브라우저 뒤로/앞으로)
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        setShowLeaveBlock(true)
      }
      // Cmd+[ 또는 Cmd+] (macOS 뒤로/앞으로)
      if (e.metaKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault()
        setShowLeaveBlock(true)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [isActive])

  // 녹음 중 popstate (브라우저 뒤로/앞으로 버튼) 차단
  useEffect(() => {
    if (!isActive) return
    const handler = () => {
      // 뒤로가기가 발생하면 원래 위치로 되돌리고 경고 표시
      window.history.pushState(null, '', window.location.href)
      setShowLeaveBlock(true)
    }
    // 현재 위치를 히스토리에 한 번 더 push (popstate 감지용)
    window.history.pushState(null, '', window.location.href)
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [isActive])

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

  // 녹음 중(일시정지 아닌) 1초 카운트다운 → 0이면 AI 요약 트리거
  // summaryIntervalSec === 0 이면 "안함" — 실시간 요약 비활성화 (종료 시 final 요약만)
  useEffect(() => {
    if (!isActive || isPaused || summaryIntervalSec === 0) {
      setSummaryCountdown(0)
      return
    }

    // 오타 수정 반영 중이면 타이머 일시정지 (카운트다운 값 유지)
    if (isApplyingCorrections) {
      return
    }

    // 재개 시 기존 카운트다운 유지, 새로 시작할 때만 초기화
    setSummaryCountdown((prev) => prev > 0 ? prev : summaryIntervalSec)

    let summarizing = false
    const interval = setInterval(() => {
      setSummaryCountdown((prev) => {
        if (summarizing) return prev  // 요약 진행 중이면 카운트다운 정지
        if (prev <= 1) {
          summarizing = true
          showStatus('기록을 회의록에 적용 중...', 10000)
          triggerRealtimeSummary(meetingId)
            .then(() => showStatus('회의록 적용 완료'))
            .catch(() => {})
            .finally(() => {
              summarizing = false
              setSummaryCountdown(summaryIntervalSec)
            })
          return 0  // 요약 중에는 0 유지
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [isActive, isPaused, isApplyingCorrections, meetingId, summaryIntervalSec])

  return {
    meeting,
    setMeeting,
    meetingMemo,
    meetingApiStatus,
    sttEngine,
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
    showLeaveBlock,
    setShowLeaveBlock,
    handleStart,
    handlePause,
    handleResume,
    handleStop,
    handleResetClick,
    handleResetConfirm,
    handleNavigateBack,
  } as const
}

export type { Participant }
