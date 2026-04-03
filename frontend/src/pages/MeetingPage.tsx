import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Pencil, ArrowLeft, StickyNote, Paperclip, Bookmark, Trash2 } from 'lucide-react'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { useMeeting } from '../hooks/useMeeting'
import { useMeetingAccess } from '../hooks/useMeetingAccess'
import { useFileTranscriptionProgress } from '../hooks/useFileTranscriptionProgress'
import { useMemoEditor } from '../hooks/useMemoEditor'
import type { Transcript, TermCorrection } from '../api/meetings'
import { getTranscripts, reopenMeeting, regenerateStt, regenerateNotes, updateNotes, correctTerms } from '../api/meetings'
import { createAuthenticatedConsumer } from '../lib/actionCableAuth'
import { usePromptTemplateStore } from '../stores/promptTemplateStore'
import { MeetingPageSkeleton } from '../components/ui/Skeleton'
import { useTranscriptStore } from '../stores/transcriptStore'
import { AudioPlayer } from '../components/meeting/AudioPlayer'
import { TranscriptPanel } from '../components/meeting/TranscriptPanel'
import { ExportButton } from '../components/meeting/ExportButton'
import { AiSummaryPanel } from '../components/meeting/AiSummaryPanel'
import { MeetingEditor } from '../components/editor/MeetingEditor'
import { useUiStore } from '../stores/uiStore'
import EditMeetingDialog from '../components/meeting/EditMeetingDialog'
import { AttachmentSection } from '../components/meeting/AttachmentSection'
import { getBookmarks, deleteBookmark } from '../api/bookmarks'
import type { Bookmark as BookmarkType } from '../api/bookmarks'

// ──────────────────────────────────────────────
// 회의 상세 페이지
// ──────────────────────────────────────────────

/**
 * 회의 상세 페이지 — 2컬럼 레이아웃 (에디터 + AI요약 + ActionItems)
 */
export default function MeetingPage() {
  const { id } = useParams<{ id: string }>()
  const meetingId = Number(id)
  const navigate = useNavigate()

  const { isLoading: accessLoading, error: accessError } = useMeetingAccess(meetingId)

  const { meeting, summary, isLoading, error: meetingError, updateTitle, updateMeetingInfo, deleteMeeting, refetch } =
    useMeeting(meetingId)
  const [showEditDialog, setShowEditDialog] = useState(false)

  const meetingTypeList = usePromptTemplateStore((s) => s.meetingTypeList)
  const meetingTypeMap = usePromptTemplateStore((s) => s.meetingTypeMap)

  const meetingTypeLabel = meeting ? (meetingTypeMap[meeting.meeting_type] ?? meeting.meeting_type) : ''

  // 파일 변환 진행률 (transcribing 상태일 때만 구독)
  const isTranscribing = meeting?.status === 'transcribing'
  const fileProgress = useFileTranscriptionProgress(isTranscribing ? meetingId : null)

  useEffect(() => {
    if (fileProgress.status === 'complete') {
      // 변환 완료 → 데이터 리페치
      refetch()
    }
  }, [fileProgress.status, refetch])

  // 기존 AI 회의록을 transcriptStore에 로드 (AiSummaryPanel이 읽음)
  const setMeetingNotes = useTranscriptStore((s) => s.setMeetingNotes)
  const resetTranscriptStore = useTranscriptStore((s) => s.reset)
  useEffect(() => {
    resetTranscriptStore()
  }, [meetingId, resetTranscriptStore])
  useEffect(() => {
    if (summary?.notes_markdown) {
      setMeetingNotes(summary.notes_markdown)
    }
  }, [summary?.notes_markdown, setMeetingNotes])

  // 오타 수정 상태
  const [corrections, setCorrections] = useState<TermCorrection[]>([{ from: '', to: '' }])
  const [isApplyingCorrections, setIsApplyingCorrections] = useState(false)
  const [correctionStatus, setCorrectionStatus] = useState('')

  const handleApplyCorrections = async () => {
    const valid = corrections.filter((c) => c.from.trim() && c.to.trim())
    if (valid.length === 0 || isApplyingCorrections) return

    setIsApplyingCorrections(true)
    setCorrectionStatus('반영 중...')
    try {
      const result = await correctTerms(meetingId, valid)
      setCorrections([{ from: '', to: '' }])
      if (result.notes_markdown) {
        setMeetingNotes(result.notes_markdown)
      }
      // 트랜스크립트 리로드
      if (result.corrected_transcripts > 0) {
        getTranscripts(meetingId).then(setTranscripts)
      }
      setCorrectionStatus(
        result.corrected_transcripts > 0
          ? `완료 (트랜스크립트 ${result.corrected_transcripts}건 수정)`
          : '완료'
      )
      setTimeout(() => setCorrectionStatus(''), 3000)
    } catch {
      setCorrectionStatus('반영 실패')
      setTimeout(() => setCorrectionStatus(''), 3000)
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

  // 회의록 재생성 상태
  const [isRegeneratingNotes, setIsRegeneratingNotes] = useState(false)
  const [showSttConfirm, setShowSttConfirm] = useState(false)
  const [showNotesConfirm, setShowNotesConfirm] = useState(false)

  // 회의록 재생성 완료 감지용 ActionCable 구독
  useEffect(() => {
    if (!isRegeneratingNotes) return

    const consumer = createAuthenticatedConsumer()
    const sub = consumer.subscriptions.create(
      { channel: 'TranscriptionChannel', meeting_id: meetingId },
      {
        received(data: Record<string, unknown>) {
          if (data.type === 'meeting_notes_update') {
            setIsRegeneratingNotes(false)
            setMeetingNotes((data.notes_markdown as string) ?? '')
            refetch()
          }
        },
      }
    )
    return () => {
      sub.unsubscribe()
      consumer.disconnect()
    }
  }, [isRegeneratingNotes, meetingId, setMeetingNotes, refetch])

  async function handleRegenerateStt() {
    setShowSttConfirm(false)
    try {
      await regenerateStt(meetingId)
      refetch()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '재생성에 실패했습니다'
      alert(msg)
    }
  }

  async function handleRegenerateNotes() {
    setShowNotesConfirm(false)
    setIsRegeneratingNotes(true)
    try {
      await regenerateNotes(meetingId)
    } catch (e: unknown) {
      setIsRegeneratingNotes(false)
      const msg = e instanceof Error ? e.message : '재생성에 실패했습니다'
      alert(msg)
    }
  }

  // 메모 에디터 + 토글
  const memoVisible = useUiStore((s) => s.memoVisible)
  const toggleMemo = useUiStore((s) => s.toggleMemo)
  const attachmentsVisible = useUiStore((s) => s.attachmentsVisible)
  const toggleAttachments = useUiStore((s) => s.toggleAttachments)
  const { memoEditorRef, isSavingMemo, handleSaveMemo } = useMemoEditor(meetingId, meeting?.memo)

  const handleNotesChange = useCallback(
    (markdown: string) => {
      updateNotes(meetingId, markdown).catch((e) => console.error('[updateNotes] 저장 실패:', e))
    },
    [meetingId]
  )

  // 오디오 seek 상태 (AudioPlayer ↔ TranscriptPanel 공유)
  const [seekMs, setSeekMs] = useState<number | null>(null)
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [transcripts, setTranscripts] = useState<Transcript[]>([])

  // 북마크 상태
  const [bookmarks, setBookmarks] = useState<BookmarkType[]>([])
  const bookmarksVisible = useUiStore((s) => s.bookmarksVisible)
  const toggleBookmarks = useUiStore((s) => s.toggleBookmarks)

  // meeting 상태가 completed로 바뀌면 트랜스크립트도 리로드 (파일 업로드 완료 시)
  useEffect(() => {
    if (meeting?.status === 'transcribing') return
    getTranscripts(meetingId).then(setTranscripts)
  }, [meetingId, meeting?.status])

  // 북마크 로드
  useEffect(() => {
    getBookmarks(meetingId).then(setBookmarks).catch(() => {})
  }, [meetingId])

  async function handleDeleteBookmark(bookmarkId: number) {
    try {
      await deleteBookmark(meetingId, bookmarkId)
      setBookmarks((prev) => prev.filter((b) => b.id !== bookmarkId))
    } catch {
      // ignore
    }
  }

  function formatMs(ms: number) {
    const totalSec = Math.floor(ms / 1000)
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    return h > 0
      ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  function handleSeek(ms: number) {
    setSeekMs(ms)
  }

  // 제목 인라인 편집 상태
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editingTitleValue, setEditingTitleValue] = useState('')

  function handleTitleClick() {
    if (meeting) {
      setEditingTitleValue(meeting.title)
      setIsEditingTitle(true)
    }
  }

  async function handleTitleSubmit() {
    if (editingTitleValue.trim()) {
      await updateTitle(editingTitleValue.trim())
    }
    setIsEditingTitle(false)
  }

  function handleTitleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      handleTitleSubmit()
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false)
    }
  }

  // 권한 에러 처리
  if (!accessLoading && accessError === 'forbidden') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-4">
        <h2 className="text-lg font-semibold text-gray-800">접근 권한이 없습니다</h2>
        <p className="text-sm text-gray-500 text-center">
          이 회의록은 같은 팀 소속 멤버만 볼 수 있습니다.
        </p>
      </div>
    )
  }

  if (!accessLoading && accessError === 'not_found') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-4">
        <h2 className="text-lg font-semibold text-gray-800">회의록을 찾을 수 없습니다</h2>
        <p className="text-sm text-gray-500">삭제되었거나 존재하지 않는 회의입니다.</p>
      </div>
    )
  }

  if (accessLoading || isLoading) {
    return <MeetingPageSkeleton />
  }

  if (meetingError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-red-500 text-sm">오류: {meetingError}</div>
      </div>
    )
  }

  // 파일 변환 중 → 진행률 표시
  if (isTranscribing) {
    const progressPercent = fileProgress.progress
    const progressMessage = fileProgress.message || (
      progressPercent < 10 ? '오디오 파일 처리 준비 중...' :
      progressPercent < 70 ? '음성 인식 중...' :
      progressPercent < 95 ? 'AI 회의록 생성 중...' :
      '마무리 중...'
    )

    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-6">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center gap-4 p-8 rounded-xl bg-white border shadow-sm">
            <svg className="w-12 h-12 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
            <h2 className="text-lg font-semibold text-gray-900">
              {meeting?.title ?? '오디오 파일 변환 중'}
            </h2>
            <p className="text-sm text-gray-500">{progressMessage}</p>

            {/* 진행률 바 */}
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="text-xs text-gray-400">{progressPercent}%</p>

            {fileProgress.status === 'error' && (
              <div className="mt-2 p-3 rounded-md bg-red-50 text-sm text-red-600 w-full">
                오류: {fileProgress.error}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 페이지 제목 */}
      <div className="px-6 py-4 bg-white border-b shrink-0 flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="p-1.5 rounded-md hover:bg-gray-100 transition-colors"
          title="목록으로 돌아가기"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <h1 className="text-xl font-bold text-gray-900">회의 미리보기</h1>
        <button
          onClick={toggleAttachments}
          className={`p-1.5 rounded-md transition-colors ${attachmentsVisible ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
          title={attachmentsVisible ? '첨부 숨기기' : '첨부 보기'}
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <button
          onClick={toggleMemo}
          className={`p-1.5 rounded-md transition-colors ${memoVisible ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
          title={memoVisible ? '메모 숨기기' : '메모 보기'}
        >
          <StickyNote className="w-4 h-4" />
        </button>
        <button
          onClick={toggleBookmarks}
          className={`p-1.5 rounded-md transition-colors ${bookmarksVisible ? 'text-amber-600 bg-amber-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
          title={bookmarksVisible ? '북마크 숨기기' : '북마크 보기'}
        >
          <Bookmark className="w-4 h-4" />
        </button>
      </div>

      {/* 오디오 플레이어 */}
      <AudioPlayer
        meetingId={meetingId}
        onTimeUpdate={setCurrentTimeMs}
        seekMs={seekMs}
        autoPlayOnSeek
      />

      {/* 헤더 */}
      <div className="flex items-center justify-between px-6 py-3 border-b bg-white shrink-0">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {isEditingTitle ? (
            <input
              type="text"
              value={editingTitleValue}
              onChange={(e) => setEditingTitleValue(e.target.value)}
              onBlur={handleTitleSubmit}
              onKeyDown={handleTitleKeyDown}
              className="text-lg font-semibold text-gray-900 border-b-2 border-blue-500 outline-none bg-transparent flex-1 min-w-0"
              autoFocus
            />
          ) : (
            <h1
              className="text-lg font-semibold text-gray-900 truncate cursor-pointer hover:text-blue-700"
              onClick={handleTitleClick}
              title="클릭하여 제목 편집"
            >
              {meeting?.title ?? '회의'}
            </h1>
          )}
          {meeting?.status && (
            <span className="shrink-0 px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">
              {meeting.status}
            </span>
          )}
          {meetingTypeLabel && (
            <span className="shrink-0 px-2 py-0.5 text-xs rounded-full bg-blue-50 text-blue-600 border border-blue-200">
              {meetingTypeLabel}
            </span>
          )}
          {meeting?.tags?.map((tag) => (
            <span
              key={tag.id}
              className="shrink-0 px-2 py-0.5 text-xs rounded-full text-white"
              style={{ backgroundColor: tag.color }}
            >
              {tag.name}
            </span>
          ))}
          {meeting && (
            <button
              onClick={() => setShowEditDialog(true)}
              className="shrink-0 p-1 rounded hover:bg-gray-100 transition-colors"
              title="회의 정보 수정"
            >
              <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {meeting?.status === 'completed' && (
            <>
              {meeting.has_audio_file && (
                <button
                  onClick={() => setShowSttConfirm(true)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                >
                  STT 재생성
                </button>
              )}
              {transcripts.length > 0 && (
                <button
                  onClick={() => setShowNotesConfirm(true)}
                  disabled={isRegeneratingNotes}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRegeneratingNotes ? (
                    <span className="flex items-center gap-1">
                      <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      재생성 중...
                    </span>
                  ) : '회의록 재생성'}
                </button>
              )}
              <button
                onClick={async () => {
                  await reopenMeeting(meetingId)
                  navigate(`/meetings/${meetingId}/live`)
                }}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors"
              >
                회의 재개
              </button>
            </>
          )}
          {(meeting?.status === 'pending' || meeting?.status === 'recording') && (
            <button
              onClick={() => navigate(`/meetings/${meetingId}/live`)}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              회의 진행
            </button>
          )}
          <ExportButton
            meetingId={meetingId}
            meetingTitle={meeting?.title}
            meetingDate={meeting?.started_at ?? meeting?.created_at}
          />
          <button
            onClick={deleteMeeting}
            className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
          >
            삭제
          </button>
        </div>
      </div>

      {/* 첨부 파일/링크 섹션 */}
      {attachmentsVisible && <AttachmentSection meetingId={meetingId} />}

      {/* 3패널 리사이즈 레이아웃 */}
      <PanelGroup orientation="horizontal" className="flex-1 overflow-hidden min-h-0">
        {/* 트랜스크립트 + 북마크 패널 — 기본 25% */}
        <Panel defaultSize={25} minSize={15}>
          <div className="h-full flex flex-col overflow-hidden">
            {/* 북마크 섹션 */}
            {bookmarksVisible && bookmarks.length > 0 && (
              <div className="border-b shrink-0 max-h-48 overflow-y-auto">
                <div className="px-3 py-2 bg-amber-50 border-b">
                  <h3 className="text-xs font-semibold text-amber-700 flex items-center gap-1">
                    <Bookmark className="w-3 h-3" />
                    북마크 ({bookmarks.length})
                  </h3>
                </div>
                <ul className="divide-y divide-gray-100">
                  {bookmarks.map((b) => (
                    <li
                      key={b.id}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-amber-50 cursor-pointer group"
                      onClick={() => handleSeek(b.timestamp_ms)}
                    >
                      <span className="text-xs font-mono text-amber-600 shrink-0">
                        {formatMs(b.timestamp_ms)}
                      </span>
                      <span className="text-xs text-gray-700 truncate flex-1">
                        {b.label || '(라벨 없음)'}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteBookmark(b.id)
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-gray-400 hover:text-red-500 transition-all"
                        title="삭제"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex-1 overflow-y-auto">
              <TranscriptPanel
                transcripts={transcripts}
                currentTimeMs={currentTimeMs}
                onSeek={handleSeek}
              />
            </div>
          </div>
        </Panel>

        <PanelResizeHandle className="w-1 bg-gray-200 hover:bg-blue-400 transition-colors cursor-col-resize" />

        {/* AI 회의록 — 기본 45% */}
        <Panel defaultSize={45} minSize={20}>
          <div className="h-full bg-gray-50 overflow-hidden flex flex-col min-h-0">
            <AiSummaryPanel meetingId={meetingId} isRecording={false} onNotesChange={handleNotesChange} />
          </div>
        </Panel>

        {memoVisible && (
          <>
            <PanelResizeHandle className="w-1 bg-gray-200 hover:bg-blue-400 transition-colors cursor-col-resize" />

            {/* 메모 — 기본 30% */}
            <Panel defaultSize={30} minSize={15}>
              <section data-testid="memo-editor" className="h-full flex flex-col overflow-hidden">
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
                <div className="flex-1 overflow-auto">
                  <MeetingEditor editorRef={memoEditorRef} />
                </div>
              </section>
            </Panel>
          </>
        )}
      </PanelGroup>

      {/* 오타 수정 섹션 */}
      {meeting?.status === 'completed' && (
        <div className="border-t bg-white px-6 py-3 shrink-0">
          <details className="group">
            <summary className="cursor-pointer text-sm font-semibold text-gray-500 select-none flex items-center gap-2">
              <span className="transition-transform group-open:rotate-90">&rsaquo;</span>
              오타 수정
              {correctionStatus && (
                <span className="text-xs font-normal text-blue-500 ml-2">{correctionStatus}</span>
              )}
            </summary>
            <div className="mt-2 flex flex-col gap-2 max-w-2xl">
              <p className="text-xs text-gray-400">
                잘못된 용어를 올바른 용어로 일괄 치환합니다 (회의록 + 트랜스크립트)
              </p>
              {corrections.map((c, i) => (
                <div key={i} className="flex items-center gap-1">
                  <input
                    type="text"
                    value={c.from}
                    onChange={(e) => updateCorrection(i, 'from', e.target.value)}
                    placeholder="잘못된 용어"
                    className="flex-1 min-w-0 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                    disabled={isApplyingCorrections}
                  />
                  <span className="text-gray-400 text-xs shrink-0">&rarr;</span>
                  <input
                    type="text"
                    value={c.to}
                    onChange={(e) => updateCorrection(i, 'to', e.target.value)}
                    placeholder="올바른 용어"
                    className="flex-1 min-w-0 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                    disabled={isApplyingCorrections}
                  />
                  <button
                    onClick={() => removeCorrectionRow(i)}
                    className="shrink-0 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-red-500 text-sm"
                    title="삭제"
                  >
                    &times;
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <button
                  onClick={addCorrectionRow}
                  disabled={isApplyingCorrections}
                  className="text-xs text-blue-500 hover:text-blue-700"
                >
                  + 용어 추가
                </button>
                <button
                  onClick={handleApplyCorrections}
                  disabled={!corrections.some((c) => c.from.trim() && c.to.trim()) || isApplyingCorrections}
                  className="ml-auto px-4 py-1.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isApplyingCorrections ? '반영 중...' : '오타 수정 적용'}
                </button>
              </div>
            </div>
          </details>
        </div>
      )}

      {/* STT 재생성 확인 다이얼로그 */}
      {showSttConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-2">STT 재생성</h3>
            <p className="text-sm text-gray-600 mb-4">
              기존 트랜스크립트와 회의록이 모두 삭제되고, 저장된 오디오로 처음부터 다시 생성됩니다. 계속하시겠습니까?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSttConfirm(false)}
                className="px-3 py-1.5 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                취소
              </button>
              <button
                onClick={handleRegenerateStt}
                className="px-3 py-1.5 text-sm rounded-md bg-amber-500 text-white hover:bg-amber-600"
              >
                재생성
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 회의록 재생성 확인 다이얼로그 */}
      {showNotesConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-2">회의록 재생성</h3>
            <p className="text-sm text-gray-600 mb-4">
              기존 회의록을 삭제하고 전체 트랜스크립트를 바탕으로 처음부터 다시 생성합니다. 계속하시겠습니까?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowNotesConfirm(false)}
                className="px-3 py-1.5 text-sm rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                취소
              </button>
              <button
                onClick={handleRegenerateNotes}
                className="px-3 py-1.5 text-sm rounded-md bg-amber-500 text-white hover:bg-amber-600"
              >
                재생성
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 회의 정보 수정 다이얼로그 */}
      {showEditDialog && meeting && (
        <EditMeetingDialog
          meeting={meeting}
          meetingTypeList={meetingTypeList}
          onConfirm={async (data) => {
            await updateMeetingInfo(data)
            setShowEditDialog(false)
          }}
          onClose={() => setShowEditDialog(false)}
        />
      )}
    </div>
  )
}
