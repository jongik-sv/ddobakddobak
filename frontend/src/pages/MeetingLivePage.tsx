import { useState, useCallback, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { useAudioRecorder } from '../hooks/useAudioRecorder'
import { useTranscription } from '../hooks/useTranscription'
import { RecordTabPanel } from '../components/meeting/RecordTabPanel'
import { AiSummaryPanel } from '../components/meeting/AiSummaryPanel'
import { SpeakerPanel } from '../components/meeting/SpeakerPanel'
import { MeetingEditor } from '../components/editor/MeetingEditor'
import type { BlockNoteEditor } from '@blocknote/core'
import type { customSchema } from '../components/editor/MeetingEditor'
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

  const [status, setStatus] = useState<MeetingStatus>('idle')
  const [meetingApiStatus, setMeetingApiStatus] = useState<'pending' | 'recording' | 'completed' | null>(null)
  const [sttEngine, setSttEngine] = useState<string | null>(null)
  const [summaryCountdown, setSummaryCountdown] = useState<number>(0)
  const [audioDurationMs, setAudioDurationMs] = useState(0)
  const [lastSeqNum, setLastSeqNum] = useState(0)

  // 메모 에디터 ref + 반영 상태
  const memoEditorRef = useRef<BlockNoteEditor<typeof customSchema.blockSpecs> | null>(null)
  const [isSendingMemo, setIsSendingMemo] = useState(false)

  // 피드백 상태
  const [feedbackText, setFeedbackText] = useState('')
  const [isSendingFeedback, setIsSendingFeedback] = useState(false)

  // 초기화 확인 다이얼로그
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const statusTimerRef = useRef<ReturnType<typeof setTimeout>>()

  // 녹음 중 뒤로가기 차단
  const [showLeaveBlock, setShowLeaveBlock] = useState(false)

  const showStatus = useCallback((msg: string, durationMs = 3000) => {
    setStatusMessage(msg)
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    statusTimerRef.current = setTimeout(() => setStatusMessage(null), durationMs)
  }, [])

  const reset = useTranscriptStore((s) => s.reset)
  const loadFinals = useTranscriptStore((s) => s.loadFinals)
  const setMeetingNotes = useTranscriptStore((s) => s.setMeetingNotes)
  const summaryIntervalSec = useAppSettingsStore((s) => s.summaryIntervalSec)

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

  const { sendChunk } = useTranscription(meetingId)

  const onChunkRef = useRef(sendChunk)
  onChunkRef.current = sendChunk

  type ChunkMeta = { sequence: number; offsetMs: number }

  const onStop = useCallback(
    async (blob: Blob) => {
      await uploadAudio(meetingId, blob)
    },
    [meetingId]
  )

  const { isRecording, isPaused, error, start, stop, pause, resume } = useAudioRecorder({
    onChunk: (pcm: Int16Array, meta: ChunkMeta) => onChunkRef.current(pcm, meta),
    onStop,
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
    const offsetMs = latest.audio_duration_ms ?? 0
    const seqNum = latest.last_sequence_number ?? 0
    setAudioDurationMs(offsetMs)
    setLastSeqNum(seqNum)

    await start(offsetMs, seqNum + 1)
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

  // 메모 내용을 AI 회의록에 반영
  const handleApplyMemo = async () => {
    const editor = memoEditorRef.current
    if (!editor || isSendingMemo) return

    let markdown: string
    try {
      markdown = await editor.blocksToMarkdownLossy(editor.document)
    } catch {
      alert('메모 내용을 읽을 수 없습니다.')
      return
    }

    if (!markdown.trim()) {
      alert('메모가 비어있습니다.')
      return
    }

    setIsSendingMemo(true)
    showStatus('메모를 회의록에 반영 중...', 10000)
    try {
      await feedbackNotes(meetingId, `다음 메모 내용을 회의록에 자연스럽게 반영해주세요:\n\n${markdown}`)
      // 메모 비우기
      editor.replaceBlocks(editor.document, [])
      showStatus('메모가 회의록에 반영되었습니다')
    } catch (err) {
      console.error('메모 반영 실패:', err)
      showStatus('메모 반영에 실패했습니다')
    } finally {
      setIsSendingMemo(false)
    }
  }

  // 사용자가 AI 회의록을 직접 편집 시 백엔드에 저장
  const handleNotesChange = useCallback(
    (markdown: string) => {
      updateNotes(meetingId, markdown).catch((e) => console.error('[updateNotes] 저장 실패:', e))
    },
    [meetingId]
  )

  const isActive = status === 'recording'

  // 녹음 중 브라우저 뒤로가기/새로고침 차단
  useEffect(() => {
    if (!isActive) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isActive])

  const handleNavigateBack = () => {
    if (isActive) {
      setShowLeaveBlock(true)
      return
    }
    navigate('/meetings')
  }

  useEffect(() => {
    getMeeting(meetingId)
      .then((m) => {
        setMeetingApiStatus(m.status as 'pending' | 'recording' | 'completed')
        setAudioDurationMs(m.audio_duration_ms ?? 0)
        setLastSeqNum(m.last_sequence_number ?? 0)
        if (m.status === 'completed') {
          // 오디오 플레이어는 회의 상세 페이지에서 표시
        }
        // recording 상태여도 status를 idle로 유지 → "회의 시작" 버튼 표시
        // 브라우저 정책상 사용자 클릭 없이 마이크/AudioContext 활성화 불가
      })
      .catch(() => {})
  }, [meetingId])

  useEffect(() => {
    getSttSettings()
      .then((s) => setSttEngine(s.stt_engine))
      .catch(() => {})
  }, [])

  // 녹음 중(일시정지 아닌) 1초 카운트다운 → 0이면 AI 요약 트리거
  // AI 피드백/메모 전송 중에는 타이머 일시정지 후 재개
  useEffect(() => {
    if (!isActive || isPaused) {
      setSummaryCountdown(0)
      return
    }

    // AI 피드백 또는 메모 반영 중이면 타이머 일시정지 (카운트다운 값 유지)
    if (isSendingFeedback || isSendingMemo) {
      return
    }

    // 재개 시 기존 카운트다운 유지, 새로 시작할 때만 초기화
    setSummaryCountdown((prev) => prev > 0 ? prev : summaryIntervalSec)

    const interval = setInterval(() => {
      setSummaryCountdown((prev) => {
        if (prev <= 1) {
          showStatus('기록을 회의록에 적용 중...', 5000)
          triggerRealtimeSummary(meetingId)
            .then(() => showStatus('회의록 적용 완료'))
            .catch(() => {})
          return summaryIntervalSec
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [isActive, isPaused, isSendingFeedback, isSendingMemo, meetingId, summaryIntervalSec])

  return (
    <div className="flex flex-col h-screen">

      {/* 헤더 컨트롤 바 */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-white shadow-sm shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={handleNavigateBack}
            className="px-2 py-1 rounded-md text-sm text-gray-500 hover:bg-gray-100 transition-colors"
            title="회의 목록으로"
          >
            ← 목록
          </button>
          <h1 className="text-lg font-semibold text-gray-900">회의실</h1>
        </div>

        <div className="flex items-center gap-2">
          {error && <span className="text-sm text-red-500">{error}</span>}

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
      <PanelGroup direction="horizontal" className="flex-1 overflow-hidden">
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
                onClick={handleApplyMemo}
                disabled={isSendingMemo}
                className="px-3 py-1 rounded-md text-xs font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSendingMemo ? '반영 중...' : '회의록에 반영'}
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
      </PanelGroup>

      {/* 하단 상태바 */}
      <div className="flex items-center justify-between px-4 h-7 border-t bg-gray-50 text-[11px] text-gray-500 shrink-0 select-none">
        <div className="flex items-center gap-3">
          {/* 녹음 상태 */}
          {isRecording && !isPaused && (
            <span data-testid="recording-indicator" className="flex items-center gap-1 text-red-500 font-medium">
              <span className="inline-block w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
              녹음 중
            </span>
          )}
          {isPaused && (
            <span className="flex items-center gap-1 text-yellow-600 font-medium">
              <span className="inline-block w-1.5 h-1.5 bg-yellow-500 rounded-full" />
              일시정지
            </span>
          )}
          {!isActive && meetingApiStatus === 'completed' && (
            <span className="text-gray-400">종료됨</span>
          )}
          {!isActive && meetingApiStatus === 'pending' && (
            <span className="text-gray-400">대기 중</span>
          )}

          {/* 타이머 */}
          {summaryCountdown > 0 && (
            <span className="flex items-center gap-1.5 font-mono tabular-nums">
              다음 적용
              <span className="inline-flex items-center gap-1">
                <span className="text-blue-600 font-semibold">{summaryCountdown}s</span>
                <span className="w-12 h-1 bg-gray-200 rounded-full overflow-hidden inline-block align-middle">
                  <span
                    className="block h-full bg-blue-500 rounded-full transition-all duration-1000 ease-linear"
                    style={{ width: `${((summaryIntervalSec - summaryCountdown) / summaryIntervalSec) * 100}%` }}
                  />
                </span>
              </span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* 상태 메시지 */}
          {statusMessage && (
            <span className="text-blue-600 font-medium truncate max-w-xs">{statusMessage}</span>
          )}

          {/* STT 모델 */}
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
