import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Settings, Monitor, Mic, ArrowLeft, StickyNote, Paperclip, Bookmark, Save, Timer, FileText, Bot, PenLine } from 'lucide-react'
import { Switch } from '../components/ui/Switch'
import { Tooltip } from '../components/ui/Tooltip'
import { useUiStore } from '../stores/uiStore'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { useAudioRecorder } from '../hooks/useAudioRecorder'
import { useSystemAudioCapture } from '../hooks/useSystemAudioCapture'
import { useMicCapture } from '../hooks/useMicCapture'
import { useTranscription } from '../hooks/useTranscription'
import { useMemoEditor } from '../hooks/useMemoEditor'
import { RecordTabPanel } from '../components/meeting/RecordTabPanel'
import { AiSummaryPanel } from '../components/meeting/AiSummaryPanel'
import { SpeakerPanel } from '../components/meeting/SpeakerPanel'
import { MeetingEditor } from '../components/editor/MeetingEditor'
import { getMeeting, startMeeting, stopMeeting, reopenMeeting, uploadAudio, triggerRealtimeSummary, getTranscripts, getSummary, resetMeetingContent, correctTerms, updateNotes, getParticipants } from '../api/meetings'
import type { Participant, TermCorrection } from '../api/meetings'
import { getSttSettings } from '../api/settings'
import { useTranscriptStore } from '../stores/transcriptStore'
import { useSharingStore } from '../stores/sharingStore'
import { ENGINE_LABELS_SHORT, IS_TAURI, SUMMARY_INTERVAL_OPTIONS, DEFAULT_SUMMARY_INTERVAL_SEC } from '../config'
import { AttachmentSection } from '../components/meeting/AttachmentSection'
import { ShareButton } from '../components/meeting/ShareButton'
import { ParticipantList } from '../components/meeting/ParticipantList'
import { HostTransferDialog } from '../components/meeting/HostTransferDialog'
import { mapTranscriptsToFinals } from '../lib/transcriptMapper'
import { createBookmark } from '../api/bookmarks'
import { useMeetingTemplateStore } from '../stores/meetingTemplateStore'
import SaveTemplateDialog from '../components/meeting/SaveTemplateDialog'
import { useMediaQuery, BREAKPOINTS } from '../hooks/useMediaQuery'
import MobileTabLayout from '../components/layout/MobileTabLayout'
import type { Tab } from '../components/layout/MobileTabLayout'

type MeetingStatus = 'idle' | 'recording' | 'stopped'

/** 오타 수정 섹션 — 모바일/데스크톱 양쪽에서 재사용 */
function CorrectionsSection({
  corrections,
  isApplyingCorrections,
  onUpdate,
  onAdd,
  onRemove,
  onApply,
}: {
  corrections: TermCorrection[]
  isApplyingCorrections: boolean
  onUpdate: (index: number, field: 'from' | 'to', value: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
  onApply: () => void
}) {
  return (
    <>
      <h2 className="px-4 py-2 text-sm font-semibold text-gray-500 border-b bg-gray-50 shrink-0">
        오타 수정
      </h2>
      <div className="flex-1 flex flex-col p-3 gap-2 overflow-auto">
        <p className="text-xs text-gray-400 shrink-0">
          잘못된 용어를 올바른 용어로 일괄 치환합니다
        </p>
        {corrections.map((c, i) => (
          <div key={i} className="flex items-center gap-1 shrink-0">
            <input
              type="text"
              value={c.from}
              onChange={(e) => onUpdate(i, 'from', e.target.value)}
              placeholder="잘못된 용어"
              className="flex-1 min-w-0 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
              disabled={isApplyingCorrections}
            />
            <span className="text-gray-400 text-xs shrink-0">&rarr;</span>
            <input
              type="text"
              value={c.to}
              onChange={(e) => onUpdate(i, 'to', e.target.value)}
              placeholder="올바른 용어"
              className="flex-1 min-w-0 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
              disabled={isApplyingCorrections}
            />
            <button
              onClick={() => onRemove(i)}
              className="shrink-0 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-red-500 text-sm"
              title="삭제"
            >
              &times;
            </button>
          </div>
        ))}
        <button
          onClick={onAdd}
          disabled={isApplyingCorrections}
          className="shrink-0 text-xs text-blue-500 hover:text-blue-700 self-start"
        >
          + 용어 추가
        </button>
        <button
          onClick={onApply}
          disabled={!corrections.some((c) => c.from.trim() && c.to.trim()) || isApplyingCorrections}
          className="shrink-0 px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isApplyingCorrections ? '반영 중...' : '오타 수정 적용'}
        </button>
      </div>
    </>
  )
}

/** 메모 저장 헤더 바 — 모바일/데스크톱 양쪽에서 재사용 */
function MemoHeader({
  onSave,
  isSaving,
}: {
  onSave: () => void
  isSaving: boolean
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50 shrink-0">
      <h2 className="text-sm font-semibold text-gray-500">메모</h2>
      <button
        onClick={onSave}
        disabled={isSaving}
        className="px-3 py-1 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isSaving ? '저장 중...' : '저장'}
      </button>
    </div>
  )
}

export default function MeetingLivePage() {
  const { id } = useParams<{ id: string }>()
  const meetingId = Number(id)
  const navigate = useNavigate()

  // 회의실 진입 시 사이드바 닫기
  useEffect(() => {
    useUiStore.setState({ sidebarOpen: false })
  }, [])

  const [status, setStatus] = useState<MeetingStatus>('idle')
  const [meetingApiStatus, setMeetingApiStatus] = useState<'pending' | 'recording' | 'completed' | null>(null)
  const [sttEngine, setSttEngine] = useState<string | null>(null)
  const [summaryCountdown, setSummaryCountdown] = useState<number>(0)
  const [, setAudioDurationMs] = useState(0)
  const [, setLastSeqNum] = useState(0)

  // 오타 수정 상태
  const [corrections, setCorrections] = useState<TermCorrection[]>([{ from: '', to: '' }])
  const [isApplyingCorrections, setIsApplyingCorrections] = useState(false)

  // 녹음 중 뒤로가기 차단
  const [showLeaveBlock, setShowLeaveBlock] = useState(false)

  // 호스트 위임 다이얼로그
  const [transferTarget, setTransferTarget] = useState<Participant | null>(null)

  // 템플릿 저장 다이얼로그
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const addTemplate = useMeetingTemplateStore((s) => s.add)

  // 초기화 확인 다이얼로그
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const statusTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // 북마크 팝오버
  const [showBookmarkPopover, setShowBookmarkPopover] = useState(false)
  const [bookmarkLabel, setBookmarkLabel] = useState('')
  const bookmarkTimestampRef = useRef<number>(0)

  // 경과 시간
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const elapsedBaseRef = useRef<number | null>(null)

  const showStatus = useCallback((msg: string, durationMs = 3000) => {
    setStatusMessage(msg)
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    statusTimerRef.current = setTimeout(() => setStatusMessage(null), durationMs)
  }, [])

  const reset = useTranscriptStore((s) => s.reset)
  const loadFinals = useTranscriptStore((s) => s.loadFinals)
  const setMeetingNotes = useTranscriptStore((s) => s.setMeetingNotes)
  const [summaryIntervalSec, setSummaryIntervalSec] = useState(DEFAULT_SUMMARY_INTERVAL_SEC)

  // 공유 상태
  const isSharing = useSharingStore((s) => s.shareCode !== null)
  const sharingParticipants = useSharingStore((s) => s.participants)
  const [currentUserId, setCurrentUserId] = useState<number>(0)
  const isHost = useMemo(() => {
    const host = sharingParticipants.find((p) => p.role === 'host')
    return host?.user_id === currentUserId && currentUserId !== 0
  }, [sharingParticipants, currentUserId])

  // 메모 에디터
  const [meetingMemo, setMeetingMemo] = useState<string | null>(null)
  const memoCallbacks = useMemo(() => ({
    onSuccess: () => showStatus('메모가 저장되었습니다'),
    onError: () => showStatus('메모 저장에 실패했습니다'),
  }), [showStatus])
  const { memoEditorRef, isSavingMemo, handleSaveMemo } = useMemoEditor(meetingId, meetingMemo, memoCallbacks)

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
  const { sendChunk } = useTranscription(meetingId)

  const onChunkRef = useRef(sendChunk)
  onChunkRef.current = sendChunk

  type ChunkMeta = { sequence: number; offsetMs: number }

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

  const { isRecording, isPaused, error, start, stop, pause, resume, feedSystemAudio } = useAudioRecorder({
    onChunk: (pcm: Int16Array, meta: ChunkMeta) => onChunkRef.current(pcm, meta),
    onStop,
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
    // STT는 마이크와 믹싱 후 처리 — 별도 VAD 청크 전송 안 함
    onChunk: () => {},
    // 원본 PCM을 마이크 캡처에 전달하여 믹싱 후 STT
    onRawAudio: (pcm: Int16Array) => feedSystemAudioRef.current(pcm),
  })

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
      // 기록 + 회의록 스토어 초기화
      reset()
      // 메모 에디터 초기화
      memoEditorRef.current?.replaceBlocks(memoEditorRef.current.document, [])
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

  // 오타 수정 적용
  const handleApplyCorrections = async () => {
    const valid = corrections.filter((c) => c.from.trim() && c.to.trim())
    if (valid.length === 0 || isApplyingCorrections) return

    setIsApplyingCorrections(true)
    showStatus('오타 수정 반영 중...', 10000)
    try {
      const result = await correctTerms(meetingId, valid)
      setCorrections([{ from: '', to: '' }])
      const msg = result.corrected_transcripts > 0
        ? `오타 수정 완료 (트랜스크립트 ${result.corrected_transcripts}건 수정)`
        : '오타 수정이 회의록에 반영되었습니다'
      showStatus(msg)
    } catch {
      showStatus('오타 수정 반영에 실패했습니다')
    } finally {
      setIsApplyingCorrections(false)
    }
  }

  const updateCorrection = (index: number, field: 'from' | 'to', value: string) => {
    setCorrections((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)))
  }

  const addCorrectionRow = () => {
    setCorrections((prev) => [...prev, { from: '', to: '' }])
  }

  const removeCorrectionRow = (index: number) => {
    setCorrections((prev) => (prev.length <= 1 ? [{ from: '', to: '' }] : prev.filter((_, i) => i !== index)))
  }

  const isActive = status === 'recording'

  // 북마크 추가
  const handleOpenBookmark = useCallback(() => {
    bookmarkTimestampRef.current = elapsedSeconds * 1000
    setBookmarkLabel('')
    setShowBookmarkPopover(true)
  }, [elapsedSeconds])

  const handleSaveBookmark = async () => {
    setShowBookmarkPopover(false)
    try {
      await createBookmark(meetingId, {
        timestamp_ms: bookmarkTimestampRef.current,
        label: bookmarkLabel.trim() || undefined,
      })
      showStatus('북마크가 추가되었습니다')
    } catch {
      showStatus('북마크 추가에 실패했습니다')
    }
  }

  // Ctrl+B 단축키로 북마크 추가
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault()
        if (isActive) {
          handleOpenBookmark()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isActive, handleOpenBookmark])

  // 사용자가 AI 회의록을 직접 편집 시 백엔드에 저장
  const handleNotesChange = useCallback(
    (markdown: string) => {
      updateNotes(meetingId, markdown).catch((e) => console.error('[updateNotes] 저장 실패:', e))
    },
    [meetingId]
  )

  // 뒤로가기 (미리보기로)
  const handleNavigateBack = () => {
    if (isActive) {
      setShowLeaveBlock(true)
      return
    }
    navigate(`/meetings/${meetingId}`)
  }

  // 메모 토글
  const memoVisible = useUiStore((s) => s.memoVisible)
  const toggleMemo = useUiStore((s) => s.toggleMemo)

  // 데스크톱/모바일 분기
  const isDesktop = useMediaQuery(BREAKPOINTS.lg)

  // 첨부 토글
  const attachmentsVisible = useUiStore((s) => s.attachmentsVisible)
  const toggleAttachments = useUiStore((s) => s.toggleAttachments)

  // 녹음 상태를 글로벌 스토어에 동기화 (폴더 클릭 차단용)
  const setRecordingActive = useUiStore((s) => s.setRecordingActive)
  useEffect(() => {
    setRecordingActive(isActive)
    return () => setRecordingActive(false)
  }, [isActive, setRecordingActive])

  const formatElapsed = (totalSec: number) => {
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    return h > 0
      ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

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
        setMeetingApiStatus(m.status as 'pending' | 'recording' | 'completed')
        setAudioDurationMs(m.audio_duration_ms ?? 0)
        setLastSeqNum(m.last_sequence_number ?? 0)
        if (m.memo) setMeetingMemo(m.memo)
        // 현재 사용자 ID 저장 (호스트 여부 판별용)
        setCurrentUserId(m.created_by.id)
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

  // 모바일 탭 정의
  const mobileTabs: Tab[] = useMemo(() => [
    {
      id: 'transcript',
      label: '전사',
      icon: FileText,
      content: (
        <div className="h-full flex flex-col">
          {/* 화자 관리 accordion (기본 닫힘) */}
          <details className="border-b">
            <summary className="px-4 py-2 text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50">
              화자 관리
            </summary>
            <div className="px-2 pb-2">
              <SpeakerPanel meetingId={meetingId} isRecording={isActive} />
              {isSharing && (
                <div className="border-t mt-2 pt-2">
                  <ParticipantList
                    isHost={isHost}
                    currentUserId={currentUserId}
                    onTransferRequest={(p) => setTransferTarget(p)}
                  />
                </div>
              )}
            </div>
          </details>
          <div className="flex-1 overflow-hidden">
            <RecordTabPanel
              meetingId={meetingId}
              currentTimeMs={0}
              onApply={() => triggerRealtimeSummary(meetingId)}
            />
          </div>
        </div>
      ),
    },
    {
      id: 'summary',
      label: '요약',
      icon: Bot,
      content: (
        <AiSummaryPanel meetingId={meetingId} isRecording={isActive} onNotesChange={handleNotesChange} />
      ),
    },
    {
      id: 'memo',
      label: '메모',
      icon: PenLine,
      content: (
        <div className="h-full flex flex-col overflow-hidden">
          <MemoHeader onSave={handleSaveMemo} isSaving={isSavingMemo} />
          <div className="flex-1 overflow-auto">
            <MeetingEditor editorRef={memoEditorRef} />
          </div>
          {/* 오타 수정 영역 */}
          <div className="flex flex-col border-t shrink-0" style={{ maxHeight: '40%' }}>
            <CorrectionsSection
              corrections={corrections}
              isApplyingCorrections={isApplyingCorrections}
              onUpdate={updateCorrection}
              onAdd={addCorrectionRow}
              onRemove={removeCorrectionRow}
              onApply={handleApplyCorrections}
            />
          </div>
        </div>
      ),
    },
  ], [meetingId, isActive, isSharing, isHost, currentUserId, handleNotesChange, handleSaveMemo, isSavingMemo, corrections, isApplyingCorrections])

  return (
    <div className="flex flex-col h-full">

      {/* 헤더 컨트롤 바 */}
      <div className={`flex items-center justify-between px-4 py-2 shadow-sm shrink-0 transition-colors duration-300 ${
        isActive && !isPaused
          ? 'bg-red-50 border-b-2 border-red-400'
          : isActive && isPaused
            ? 'bg-amber-50 border-b-2 border-amber-400'
            : 'bg-white border-b'
      }`}>
        {/* 좌측: 네비게이션 */}
        <div className="flex items-center gap-2">
          <Tooltip text="미리보기로">
            <button
              onClick={handleNavigateBack}
              className="p-1.5 rounded-md hover:bg-gray-100 transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
          </Tooltip>
          <h1 className="text-lg font-semibold text-gray-900">회의실</h1>
          <Tooltip text={attachmentsVisible ? '첨부 숨기기' : '첨부 보기'}>
            <button
              onClick={toggleAttachments}
              className={`p-1.5 rounded-md transition-colors ${attachmentsVisible ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
            >
              <Paperclip className="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip text={memoVisible ? '메모 숨기기' : '메모 보기'}>
            <button
              onClick={toggleMemo}
              className={`p-1.5 rounded-md transition-colors ${memoVisible ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
            >
              <StickyNote className="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip text="설정">
            <button
              onClick={useUiStore.getState().openSettings}
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <Settings className="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip text="템플릿으로 저장">
            <button
              onClick={() => setShowSaveTemplate(true)}
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <Save className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>

        {/* 중앙: 녹음 상태 인디케이터 */}
        {isActive && (
          <div className="flex items-center gap-3">
            <div
              data-testid="recording-indicator"
              className={`flex items-center gap-2 px-3 py-1 rounded-full border ${
                isPaused
                  ? 'bg-amber-100 border-amber-300'
                  : 'bg-red-100 border-red-200'
              }`}
            >
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${isPaused ? 'bg-amber-500' : 'bg-red-500'}`}
                style={!isPaused ? { animation: 'recording-blink 1.2s ease-in-out infinite' } : undefined}
              />
              <Mic className={`w-3.5 h-3.5 ${isPaused ? 'text-amber-600' : 'text-red-500'}`} />
              <span className={`text-sm font-semibold ${isPaused ? 'text-amber-700' : 'text-red-600'}`}>
                {isPaused ? '일시정지' : '녹음 중'}
              </span>
            </div>

            {/* 경과 시간 */}
            <span className="font-mono text-sm font-semibold text-gray-700 tabular-nums tracking-wide">
              {formatElapsed(elapsedSeconds)}
            </span>

            {/* 원형 카운트다운 타이머 */}
            {summaryCountdown > 0 && (
              <div className="flex items-center gap-1" title="다음 AI 회의록 적용까지">
                <div className="relative w-7 h-7">
                  <svg className="w-7 h-7 -rotate-90" viewBox="0 0 28 28">
                    <circle cx="14" cy="14" r="12" fill="none" stroke="#e5e7eb" strokeWidth="2" />
                    <circle
                      cx="14" cy="14" r="12" fill="none" stroke="#3b82f6" strokeWidth="2"
                      strokeDasharray={`${2 * Math.PI * 12}`}
                      strokeDashoffset={`${2 * Math.PI * 12 * (1 - (summaryIntervalSec - summaryCountdown) / summaryIntervalSec)}`}
                      strokeLinecap="round"
                      className="transition-all duration-1000 ease-linear"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-blue-600 font-mono">
                    {summaryCountdown}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 우측: 컨트롤 */}
        <div className="flex items-center gap-2">
          {(error || systemAudioError) && (
            <span className="text-sm text-red-500">{error || systemAudioError}</span>
          )}

          {/* 북마크 추가 버튼 (녹음 중만 표시) */}
          {isActive && (
            <Tooltip text="북마크 추가 (Ctrl+B)">
              <button
                onClick={handleOpenBookmark}
                className="p-1.5 rounded-md text-amber-500 hover:text-amber-600 hover:bg-amber-50 transition-colors"
              >
                <Bookmark className="w-4 h-4" />
              </button>
            </Tooltip>
          )}

          {/* 공유 버튼 */}
          <ShareButton meetingId={meetingId} />

          {/* 시스템 오디오 토글 (Tauri 데스크톱 앱에서만 표시) */}
          {IS_TAURI && (
            <Tooltip text="시스템 오디오 캡처">
              <div className="flex items-center gap-1.5">
                <Monitor className={`w-3.5 h-3.5 ${systemAudioEnabled ? 'text-purple-600' : 'text-gray-400'}`} />
                <Switch
                  checked={systemAudioEnabled}
                  onChange={handleToggleSystemAudio}
                />
              </div>
            </Tooltip>
          )}

          {/* 적용주기 선택 */}
          <Tooltip text="AI 회의록 적용 주기">
          <div className="flex items-center gap-1.5">
            <Timer className="w-3.5 h-3.5 text-gray-500" />
            <select
              value={summaryIntervalSec}
              onChange={(e) => setSummaryIntervalSec(Number(e.target.value))}
              disabled={isActive}
              className="text-xs border border-gray-300 rounded-md px-1.5 py-1 bg-white text-gray-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {SUMMARY_INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          </Tooltip>

          {!isActive && (
            <button
              onClick={handleResetClick}
              disabled={isResetting}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-colors disabled:opacity-50"
            >
              {isResetting ? '초기화 중...' : '회의 초기화'}
            </button>
          )}

          {!isActive ? (
            <button
              onClick={handleStart}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              회의 시작
            </button>
          ) : (
            <>
              <button
                onClick={isPaused ? handleResume : handlePause}
                className={`px-3 py-1.5 rounded-md text-sm font-medium text-white transition-colors ${
                  isPaused
                    ? 'bg-green-500 hover:bg-green-600'
                    : 'bg-yellow-500 hover:bg-yellow-600'
                }`}
              >
                {isPaused ? '재개' : '일시정지'}
              </button>
              <button
                onClick={handleStop}
                disabled={isStopping}
                className="px-3 py-1.5 rounded-md text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {isStopping ? '종료 중...' : '회의 종료'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 첨부 파일/링크 섹션 */}
      {attachmentsVisible && <AttachmentSection meetingId={meetingId} />}

      {/* 데스크톱: 3영역 리사이즈 레이아웃 / 모바일: 탭 레이아웃 */}
      {isDesktop ? (
        <PanelGroup orientation="horizontal" className="flex-1 overflow-hidden">
          {/* 기록 + 화자 영역 — 기본 20% */}
          <Panel defaultSize={20} minSize={15}>
            <section className="h-full border-r overflow-hidden flex flex-col">
              <div className="flex-1 overflow-hidden">
                <RecordTabPanel
                  meetingId={meetingId}
                  currentTimeMs={0}
                  onApply={() => triggerRealtimeSummary(meetingId)}
                />
              </div>
              <div className="border-t shrink-0">
                <SpeakerPanel meetingId={meetingId} isRecording={isActive} />
              </div>
              {isSharing && (
                <div className="border-t shrink-0">
                  <ParticipantList
                    isHost={isHost}
                    currentUserId={currentUserId}
                    onTransferRequest={(p) => setTransferTarget(p)}
                  />
                </div>
              )}
            </section>
          </Panel>

          <PanelResizeHandle className="w-1 bg-gray-200 hover:bg-blue-400 transition-colors cursor-col-resize" />

          {/* AI 회의록 영역 — 기본 50% */}
          <Panel defaultSize={50} minSize={20}>
            <section
              data-testid="ai-minutes"
              className="h-full border-r overflow-hidden flex flex-col"
            >
              <AiSummaryPanel meetingId={meetingId} isRecording={isActive} onNotesChange={handleNotesChange} />
            </section>
          </Panel>

          {memoVisible && (
            <>
              <PanelResizeHandle className="w-1 bg-gray-200 hover:bg-blue-400 transition-colors cursor-col-resize" />

              {/* 메모 + 피드백 영역 — 나머지 30% */}
              <Panel defaultSize={30} minSize={15}>
                <section
                  data-testid="memo-editor"
                  className="h-full flex flex-col overflow-hidden"
                >
                  {/* ���모 영역 (60%) */}
                  <MemoHeader onSave={handleSaveMemo} isSaving={isSavingMemo} />
                  <div className="overflow-auto" style={{ flex: '0 0 60%' }}>
                    <MeetingEditor editorRef={memoEditorRef} />
                  </div>

                  {/* 오타 수정 영역 (40%) */}
                  <div className="flex flex-col border-t" style={{ flex: '0 0 40%' }}>
                    <CorrectionsSection
                      corrections={corrections}
                      isApplyingCorrections={isApplyingCorrections}
                      onUpdate={updateCorrection}
                      onAdd={addCorrectionRow}
                      onRemove={removeCorrectionRow}
                      onApply={handleApplyCorrections}
                    />
                  </div>
                </section>
              </Panel>
            </>
          )}
        </PanelGroup>
      ) : (
        <MobileTabLayout
          tabs={mobileTabs}
          defaultTab="transcript"
        />
      )}

      {/* 하단 상태바 */}
      <div className="flex items-center justify-between px-4 h-7 border-t bg-gray-50 text-[11px] text-gray-500 shrink-0 select-none">
        <div className="flex items-center gap-3">
          {isSystemCapturing && (
            <span className="flex items-center gap-1 text-purple-500 font-medium">
              <Monitor className="w-3 h-3" />
              시스템 오디오
            </span>
          )}
          {!isActive && meetingApiStatus === 'completed' && (
            <span className="text-gray-400">종료됨</span>
          )}
          {!isActive && meetingApiStatus === 'pending' && (
            <span className="text-gray-400">대기 중</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {statusMessage && (
            <span className="text-blue-600 font-medium truncate max-w-xs">{statusMessage}</span>
          )}
          {sttEngine && (
            <span className="font-mono text-gray-400">
              STT: {ENGINE_LABELS_SHORT[sttEngine] ?? sttEngine}
            </span>
          )}
        </div>
      </div>

      {/* 템플릿 저장 다이얼로그 */}
      {showSaveTemplate && (
        <SaveTemplateDialog
          onSave={async (name) => {
            await addTemplate({
              name,
              meeting_type: meetingApiStatus ? undefined : 'general',
            })
            showStatus('템플릿이 저장되었습니다')
          }}
          onClose={() => setShowSaveTemplate(false)}
        />
      )}

      {/* 녹음 중 뒤로가기 차단 다이얼로그 */}
      {showLeaveBlock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">녹음 진행 중</h3>
            <p className="text-sm text-gray-600 mb-5">
              녹음 중에는 페이지를 떠날 수 없습니다. 먼저 회의를 종료해주세요.
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => setShowLeaveBlock(false)}
                className="px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 초기화 확인 다이얼로그 */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">회의 초기화</h3>
            <p className="text-sm text-gray-600 mb-5">
              모든 회의 내용(기록, 회의록, 액션아이템, 오디오)이 삭제됩니다. 초기화하시겠습니까?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 rounded-md text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleResetConfirm}
                className="px-4 py-2 rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-colors"
              >
                초기화
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 북마크 추가 팝오버 */}
      {showBookmarkPopover && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-lg p-5 max-w-xs w-full mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-1">북마크 추가</h3>
            <p className="text-xs text-gray-400 mb-3">
              {formatElapsed(Math.floor(bookmarkTimestampRef.current / 1000))} 지점
            </p>
            <input
              type="text"
              value={bookmarkLabel}
              onChange={(e) => setBookmarkLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveBookmark()
                if (e.key === 'Escape') setShowBookmarkPopover(false)
              }}
              placeholder="라벨 (선택사항)"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent mb-3"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowBookmarkPopover(false)}
                className="px-3 py-1.5 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                취소
              </button>
              <button
                onClick={handleSaveBookmark}
                className="px-3 py-1.5 text-sm rounded-md bg-amber-500 text-white hover:bg-amber-600"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 호스트 위임 다이얼로그 */}
      <HostTransferDialog
        open={transferTarget !== null}
        targetUserName={transferTarget?.user_name ?? ''}
        targetUserId={transferTarget?.user_id ?? 0}
        meetingId={meetingId}
        onClose={() => setTransferTarget(null)}
        onTransferred={() => setTransferTarget(null)}
      />
    </div>
  )
}
