import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Settings, Monitor, Mic, ArrowLeft, StickyNote } from 'lucide-react'
import { Switch } from '../components/ui/Switch'
import { useUiStore } from '../stores/uiStore'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { useAudioRecorder } from '../hooks/useAudioRecorder'
import { useSystemAudioCapture } from '../hooks/useSystemAudioCapture'
import { useTranscription } from '../hooks/useTranscription'
import { useMemoEditor } from '../hooks/useMemoEditor'
import { RecordTabPanel } from '../components/meeting/RecordTabPanel'
import { AiSummaryPanel } from '../components/meeting/AiSummaryPanel'
import { SpeakerPanel } from '../components/meeting/SpeakerPanel'
import { MeetingEditor } from '../components/editor/MeetingEditor'
import { getMeeting, startMeeting, stopMeeting, reopenMeeting, uploadAudio, triggerRealtimeSummary, getTranscripts, getSummary, resetMeetingContent, feedbackNotes, updateNotes } from '../api/meetings'
import { getSttSettings } from '../api/settings'
import { useTranscriptStore } from '../stores/transcriptStore'
import { useAppSettingsStore } from '../stores/appSettingsStore'
import { ENGINE_LABELS_SHORT } from '../config'
import type { TranscriptFinalData } from '../channels/transcription'

type MeetingStatus = 'idle' | 'recording' | 'stopped'

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

  // 피드백 상태
  const [feedbackText, setFeedbackText] = useState('')
  const [isSendingFeedback, setIsSendingFeedback] = useState(false)

  // 녹음 중 뒤로가기 차단
  const [showLeaveBlock, setShowLeaveBlock] = useState(false)

  // 초기화 확인 다이얼로그
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const statusTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

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
  const summaryIntervalSec = useAppSettingsStore((s) => s.summaryIntervalSec)

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
    getTranscripts(meetingId).then((transcripts) => {
      const finals: TranscriptFinalData[] = transcripts.map((t) => ({
        id: t.id,
        content: t.content,
        speaker_label: t.speaker_label,
        started_at_ms: t.started_at_ms,
        ended_at_ms: t.ended_at_ms,
        sequence_number: t.sequence_number,
        applied: t.applied_to_minutes ?? false,
      }))
      loadFinals(finals)
    }).catch(() => {})

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
  const onSystemChunkRef = useRef(sendSystemChunk)
  onSystemChunkRef.current = sendSystemChunk

  type ChunkMeta = { sequence: number; offsetMs: number }

  const onStop = useCallback(
    async (blob: Blob) => {
      await uploadAudio(meetingId, blob)
    },
    [meetingId]
  )

  const { isRecording, isPaused, error, start, stop, pause, resume, feedSystemAudio } = useAudioRecorder({
    onChunk: (pcm: Int16Array, meta: ChunkMeta) => onChunkRef.current(pcm, meta),
    onStop,
  })

  // feedSystemAudio를 ref로 관리 (콜백 안정성)
  const feedSystemAudioRef = useRef(feedSystemAudio)
  feedSystemAudioRef.current = feedSystemAudio

  const {
    isCapturing: isSystemCapturing,
    error: systemAudioError,
    start: startSystemCapture,
    stop: stopSystemCapture,
  } = useSystemAudioCapture({
    // VAD 처리된 청크 → STT 전송용
    onChunk: (pcm: Int16Array, meta: ChunkMeta) => onSystemChunkRef.current(pcm, meta),
    // VAD 전 원본 연속 PCM → 녹음 파일 믹싱용 (중복/에코 없음)
    onRawAudio: (pcm: Int16Array) => feedSystemAudioRef.current(pcm),
  })

  const handleStart = async () => {
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

    // 시스템 오디오 캡처 (활성화된 경우)
    if (systemAudioEnabled) {
      startSystemCapture(offsetMs, seqNum + 1000000).catch((err) =>
        console.warn('[SystemAudio] 시작 실패:', err)
      )
    }

    setMeetingApiStatus('recording')
    setStatus('recording')
  }

  const handlePause = () => {
    pause()
    // 일시정지 시 아직 적용되지 않은 기록을 AI 회의록에 반영
    triggerRealtimeSummary(meetingId).catch(() => {})
  }

  const handleStop = async () => {
    setIsStopping(true)
    showStatus('회의 종료 중... 기록을 회의록에 적용하고 있습니다', 10000)
    stop()
    stopSystemCapture()
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
      // 피드백 텍스트 초기화
      setFeedbackText('')
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

  // 피드백 전송
  const handleSendFeedback = async () => {
    const text = feedbackText.trim()
    if (!text || isSendingFeedback) return

    setIsSendingFeedback(true)
    showStatus('AI 피드백 반영 중...', 10000)
    try {
      await feedbackNotes(meetingId, text)
      setFeedbackText('')
      showStatus('피드백이 회의록에 반영되었습니다')
    } catch {
      showStatus('피드백 반영에 실패했습니다')
    } finally {
      setIsSendingFeedback(false)
    }
  }

  const handleFeedbackKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendFeedback()
    }
  }

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

  const isActive = status === 'recording'

  // 메모 토글
  const memoVisible = useUiStore((s) => s.memoVisible)
  const toggleMemo = useUiStore((s) => s.toggleMemo)

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
        const seqNum = latest.last_sequence_number ?? 0
        startSystemCapture(offsetMs, seqNum + 1000000).catch((err) =>
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
      })
      .catch(() => {})
  }, [meetingId])

  useEffect(() => {
    getSttSettings()
      .then((s) => setSttEngine(s.stt_engine))
      .catch(() => {})
  }, [])

  // 녹음 중(일시정지 아닌) 1초 카운트다운 → 0이면 AI 요약 트리거
  useEffect(() => {
    if (!isActive || isPaused) {
      setSummaryCountdown(0)
      return
    }

    // AI 피드백 반영 중이면 타이머 일시정지 (카운트다운 값 유지)
    if (isSendingFeedback) {
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
  }, [isActive, isPaused, isSendingFeedback, meetingId, summaryIntervalSec])

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
          <button
            onClick={handleNavigateBack}
            className="p-1.5 rounded-md hover:bg-gray-100 transition-colors"
            title="미리보기로"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900">회의실</h1>
          <button
            onClick={toggleMemo}
            className={`p-1.5 rounded-md transition-colors ${memoVisible ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
            title={memoVisible ? '메모 숨기기' : '메모 보기'}
          >
            <StickyNote className="w-4 h-4" />
          </button>
          <button
            onClick={useUiStore.getState().openSettings}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="설정"
          >
            <Settings className="w-4 h-4" />
          </button>
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

          {/* 시스템 오디오 토글 */}
          <div className="flex items-center gap-1.5" title="시스템 오디오 캡처 (온라인 회의 상대방 음성)">
            <Monitor className={`w-3.5 h-3.5 ${systemAudioEnabled ? 'text-purple-600' : 'text-gray-400'}`} />
            <Switch
              checked={systemAudioEnabled}
              onChange={handleToggleSystemAudio}
            />
          </div>

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
                onClick={isPaused ? resume : handlePause}
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

      {/* 3영역 리사이즈 레이아웃 */}
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
                {/* 메모 영역 (60%) */}
                <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50 shrink-0">
                  <h2 className="text-sm font-semibold text-gray-500">메모</h2>
                  <button
                    onClick={handleSaveMemo}
                    disabled={isSavingMemo}
                    className="px-3 py-1 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isSavingMemo ? '저장 중...' : '저장'}
                  </button>
                </div>
                <div className="overflow-auto" style={{ flex: '0 0 60%' }}>
                  <MeetingEditor editorRef={memoEditorRef} />
                </div>

                {/* 피드백 영역 (40%) */}
                <div className="flex flex-col border-t" style={{ flex: '0 0 40%' }}>
                  <h2 className="px-4 py-2 text-sm font-semibold text-gray-500 border-b bg-gray-50 shrink-0">
                    AI 피드백
                  </h2>
                  <div className="flex-1 flex flex-col p-3 gap-2 overflow-hidden">
                    <p className="text-xs text-gray-400 shrink-0">
                      AI에게 회의록 수정을 요청하세요
                    </p>
                    <textarea
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      onKeyDown={handleFeedbackKeyDown}
                      placeholder="예: 결정사항을 표로 정리해줘, 핵심 요약을 더 짧게 줄여줘..."
                      className="flex-1 resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                      disabled={isSendingFeedback}
                    />
                    <button
                      onClick={handleSendFeedback}
                      disabled={!feedbackText.trim() || isSendingFeedback}
                      className="shrink-0 px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isSendingFeedback ? '반영 중...' : '피드백 전송'}
                    </button>
                  </div>
                </div>
              </section>
            </Panel>
          </>
        )}
      </PanelGroup>

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
    </div>
  )
}
