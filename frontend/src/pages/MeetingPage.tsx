import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { useMeeting } from '../hooks/useMeeting'
import { useMeetingAccess } from '../hooks/useMeetingAccess'
import { useFileTranscriptionProgress } from '../hooks/useFileTranscriptionProgress'
import { useMemoEditor } from '../hooks/useMemoEditor'
import type { Transcript, TermCorrection } from '../api/meetings'
import { getTranscripts, reopenMeeting, regenerateStt, regenerateNotes, updateNotes, correctTerms, canEditMeeting } from '../api/meetings'
import { useAuthStore } from '../stores/authStore'
import { createAuthenticatedConsumer } from '../lib/actionCableAuth'
import { usePromptTemplateStore } from '../stores/promptTemplateStore'
import { MeetingPageSkeleton } from '../components/ui/Skeleton'
import { useTranscriptStore } from '../stores/transcriptStore'
import { useAudioPlayer } from '../hooks/useAudioPlayer'
import { AudioPlayer } from '../components/meeting/AudioPlayer'
import { MiniAudioPlayer } from '../components/meeting/MiniAudioPlayer'
import { TranscriptPanel } from '../components/meeting/TranscriptPanel'
import { SpeakerPanel } from '../components/meeting/SpeakerPanel'
import { AiSummaryPanel } from '../components/meeting/AiSummaryPanel'
import { SummaryOptionsControl } from '../components/meeting/SummaryOptionsControl'
import { useUiStore } from '../stores/uiStore'
import EditMeetingDialog from '../components/meeting/EditMeetingDialog'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { AttachmentSection } from '../components/meeting/AttachmentSection'
import { getBookmarks, deleteBookmark } from '../api/bookmarks'
import type { Bookmark as BookmarkType } from '../api/bookmarks'
import { useMediaQuery, BREAKPOINTS } from '../hooks/useMediaQuery'
import MobileTabLayout from '../components/layout/MobileTabLayout'
import { BookmarkList } from '../components/meeting/BookmarkList'
import { MemoEditorPanel } from '../components/meeting/MemoEditorPanel'
import { TranscribingProgress } from '../components/meeting/TranscribingProgress'
import { TermCorrectionDetails } from '../components/meeting/TermCorrectionDetails'
import { MeetingActionHeader } from '../components/meeting/MeetingActionHeader'
import { MeetingActions } from '../components/meeting/MeetingActions'
import { MeetingDetailTopBar } from '../components/meeting/MeetingDetailTopBar'
import { buildMeetingDetailTabs } from '../components/meeting/meetingDetailTabs'
import { MeetingSearchBar } from '../components/meeting/MeetingSearchBar'
import { useMeetingSearch } from '../hooks/useMeetingSearch'

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
  const isDesktop = useMediaQuery(BREAKPOINTS.lg)

  const { isLoading: accessLoading, error: accessError } = useMeetingAccess(meetingId)

  const { meeting, summary, isLoading, error: meetingError, updateTitle, updateMeetingInfo, deleteMeeting, refetch } =
    useMeeting(meetingId)
  const [showEditDialog, setShowEditDialog] = useState(false)

  // 소유권 게이팅: 수정 어포던스는 소유자/admin에게만 노출 (서버는 403으로 강제).
  const me = useAuthStore((s) => s.user)
  const canEdit = canEditMeeting(meeting, me)

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
  const markUserEdit = useTranscriptStore((s) => s.markUserEdit)
  const clientId = useTranscriptStore((s) => s.clientId)
  const loadFinals = useTranscriptStore((s) => s.loadFinals)
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
    // 에디터 즉시 비움(+보류 자동저장 취소, AiSummaryPanel null 처리) — 옛 회의록 잔상이
    // 대기 중 자동저장되면 last_user_edit_at 갱신으로 재생성 결과가 폐기된다.
    setMeetingNotes(null)
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
      markUserEdit()
      updateNotes(meetingId, markdown, clientId).catch((e) => console.error('[updateNotes] 저장 실패:', e))
    },
    [meetingId, clientId, markUserEdit]
  )

  // 오디오 상태 (AudioPlayer ↔ MiniAudioPlayer ↔ TranscriptPanel 공유)
  const audio = useAudioPlayer(meetingId)
  const [seekMs, setSeekMs] = useState<number | null>(null)
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [showFullPlayer, setShowFullPlayer] = useState(false)
  const [transcripts, setTranscripts] = useState<Transcript[]>([])

  // 북마크 상태
  const [bookmarks, setBookmarks] = useState<BookmarkType[]>([])
  const bookmarksVisible = useUiStore((s) => s.bookmarksVisible)
  const toggleBookmarks = useUiStore((s) => s.toggleBookmarks)

  // 페이지 내 검색 (전사 + AI요약)
  const search = useMeetingSearch(transcripts)
  const activeTranscriptSearch =
    search.current?.type === 'transcript'
      ? { transcriptId: search.current.transcriptId, occurrence: search.current.occurrence }
      : null

  // 모바일 탭 — 검색 매치 위치에 따라 기록/요약 탭 자동 전환 (controlled)
  const [mobileTab, setMobileTab] = useState('transcript')
  const currentMatchType = search.current?.type
  useEffect(() => {
    if (isDesktop || !currentMatchType || !search.effectiveQuery) return
    setMobileTab(currentMatchType === 'transcript' ? 'transcript' : 'summary')
  }, [isDesktop, currentMatchType, search.currentIndex, search.effectiveQuery])

  // meeting 상태가 completed로 바뀌면 트랜스크립트도 리로드 (파일 업로드 완료 시)
  useEffect(() => {
    if (meeting?.status === 'transcribing') return
    getTranscripts(meetingId).then((data) => {
      setTranscripts(data)
      // EditableTranscriptText의 낙관적 갱신이 즉시 화면에 반영되도록 store에도 적재.
      // TranscriptPanel은 store.finals를 override로 우선 조회한다.
      loadFinals(
        data.map((t) => ({
          id: t.id,
          content: t.content,
          speaker_label: t.speaker_label,
          speaker_name: t.speaker_name ?? null,
          started_at_ms: t.started_at_ms,
          ended_at_ms: t.ended_at_ms,
          sequence_number: t.sequence_number,
          applied: t.applied_to_minutes ?? true,
        })),
      )
    })
  }, [meetingId, meeting?.status, loadFinals])

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

  function handleSeek(ms: number) {
    setSeekMs(ms)
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
      <TranscribingProgress
        title={meeting?.title ?? '오디오 파일 변환 중'}
        progressPercent={progressPercent}
        message={progressMessage}
        isError={fileProgress.status === 'error'}
        error={fileProgress.error}
      />
    )
  }

  // 요약 옵션(압축율·재구조화) 컨트롤 — 소유자/admin 만. 데스크톱 패널·모바일 탭 공용.
  const summaryOptionsControl = meeting && canEdit ? (
    <SummaryOptionsControl meeting={meeting} onSave={updateMeetingInfo} />
  ) : undefined

  // 모바일 탭 정의
  const mobileTabs = buildMeetingDetailTabs({
    meetingId,
    bookmarksVisible,
    bookmarks,
    transcripts,
    currentTimeMs,
    onSeek: handleSeek,
    onDeleteBookmark: handleDeleteBookmark,
    onNotesChange: handleNotesChange,
    memoEditorRef,
    onSaveMemo: handleSaveMemo,
    isSavingMemo,
    summaryOptions: summaryOptionsControl,
    searchQuery: search.effectiveQuery,
    activeSearch: activeTranscriptSearch,
    suppressAutoScroll: !!search.effectiveQuery,
  })

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 상단 툴바 */}
      <MeetingDetailTopBar
        isDesktop={isDesktop}
        hasMeeting={!!meeting}
        attachmentsVisible={attachmentsVisible}
        memoVisible={memoVisible}
        bookmarksVisible={bookmarksVisible}
        searchOpen={search.isOpen}
        canEdit={canEdit}
        onBack={() => navigate('/')}
        onToggleAttachments={toggleAttachments}
        onShowEdit={() => setShowEditDialog(true)}
        onToggleMemo={toggleMemo}
        onToggleBookmarks={toggleBookmarks}
        onToggleSearch={() => (search.isOpen ? search.close() : search.open())}
        actions={meeting ? (
          <MeetingActions
            meeting={meeting}
            meetingId={meetingId}
            isDesktop={isDesktop}
            transcriptsCount={transcripts.length}
            isRegeneratingNotes={isRegeneratingNotes}
            onShowSttConfirm={() => setShowSttConfirm(true)}
            onShowNotesConfirm={() => setShowNotesConfirm(true)}
            onReopen={async () => {
              await reopenMeeting(meetingId)
              navigate(`/meetings/${meetingId}/live`)
            }}
            onGoLive={() => navigate(`/meetings/${meetingId}/live`)}
            onDelete={deleteMeeting}
            canEdit={canEdit}
          />
        ) : undefined}
      />

      {/* 페이지 내 검색 바 (전사 + AI요약) */}
      {search.isOpen && (
        <MeetingSearchBar
          query={search.query}
          onQueryChange={search.setQuery}
          matchCount={search.matches.length}
          currentIndex={search.currentIndex}
          onNext={search.next}
          onPrev={search.prev}
          onClose={search.close}
          focusTick={search.focusTick}
        />
      )}

      {/* 오디오 플레이어 (데스크톱) */}
      <div className="hidden lg:block">
        <AudioPlayer
          audio={audio}
          onTimeUpdate={setCurrentTimeMs}
          seekMs={seekMs}
          autoPlayOnSeek
        />
      </div>

      {/* 풀사이즈 플레이어 바텀 시트 (모바일) */}
      {showFullPlayer && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setShowFullPlayer(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="absolute bottom-0 left-0 right-0 bg-white border-t shadow-lg rounded-t-xl p-3 pb-safe" onClick={(e) => e.stopPropagation()}>
            <AudioPlayer
              audio={audio}
              onTimeUpdate={setCurrentTimeMs}
              seekMs={seekMs}
              autoPlayOnSeek
            />
          </div>
        </div>
      )}

      {/* 미니 오디오 플레이어 (모바일) */}
      {audio.hasAudio && audio.isReady && (
        <MiniAudioPlayer
          isPlaying={audio.isPlaying}
          currentTimeMs={audio.currentTimeMs}
          durationMs={audio.durationMs}
          onPlay={audio.play}
          onPause={audio.pause}
          onSeek={audio.seekTo}
          onExpand={() => setShowFullPlayer(true)}
        />
      )}

      {/* 제목 줄 (제목 인라인 편집 + 배지). 액션 버튼은 상단 툴바로 이동(MeetingActions). */}
      {meeting && (
        <MeetingActionHeader
          meeting={meeting}
          isDesktop={isDesktop}
          meetingTypeLabel={meetingTypeLabel}
          onUpdateTitle={updateTitle}
          canEdit={canEdit}
        />
      )}

      {/* 첨부 파일/링크 섹션 (명함 탭 선택 시 참석자 패널은 섹션 내부에서 표시) */}
      {attachmentsVisible && <AttachmentSection meetingId={meetingId} />}

      {/* 패널 레이아웃: 데스크톱(PanelGroup) / 모바일(MobileTabLayout) */}
      {isDesktop ? (
        <PanelGroup orientation="horizontal" className="flex-1 overflow-hidden min-h-0">
          {/* 트랜스크립트 + 북마크 패널 — 기본 25% */}
          <Panel defaultSize={25} minSize={15}>
            <div className="h-full flex flex-col overflow-hidden">
              {bookmarksVisible && (
                <BookmarkList bookmarks={bookmarks} onSeek={handleSeek} onDelete={handleDeleteBookmark} />
              )}
              <div className="flex-1 overflow-y-auto">
                <TranscriptPanel
                  meetingId={meetingId}
                  transcripts={transcripts}
                  currentTimeMs={currentTimeMs}
                  onSeek={handleSeek}
                  searchQuery={search.effectiveQuery}
                  activeSearch={activeTranscriptSearch}
                  suppressAutoScroll={!!search.effectiveQuery}
                />
              </div>
              {/* 배치 화자분리 결과 이름 변경/초기화 (MeetingViewerPage 데스크톱과 동일 패턴) */}
              <div className="border-t shrink-0">
                <SpeakerPanel meetingId={meetingId} isRecording={false} />
              </div>
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-gray-200 hover:bg-blue-400 transition-colors cursor-col-resize" />

          {/* AI 회의록 — 기본 45% */}
          <Panel defaultSize={45} minSize={20}>
            <div data-search-region="summary" className="h-full bg-gray-50 overflow-hidden flex flex-col min-h-0">
              <AiSummaryPanel
                meetingId={meetingId}
                isRecording={false}
                onNotesChange={handleNotesChange}
                headerExtra={summaryOptionsControl}
              />
            </div>
          </Panel>

          {memoVisible && (
            <>
              <PanelResizeHandle className="w-1 bg-gray-200 hover:bg-blue-400 transition-colors cursor-col-resize" />

              {/* 메모 + Decision Log — 기본 30% */}
              <Panel defaultSize={30} minSize={15}>
                <MemoEditorPanel
                  meetingId={meetingId}
                  editorRef={memoEditorRef}
                  onSave={handleSaveMemo}
                  isSaving={isSavingMemo}
                />
              </Panel>
            </>
          )}
        </PanelGroup>
      ) : (
        <MobileTabLayout
          tabs={mobileTabs}
          activeTab={mobileTab}
          onTabChange={setMobileTab}
        />
      )}

      {/* 오타 수정 섹션 */}
      {meeting?.status === 'completed' && (
        <TermCorrectionDetails
          corrections={corrections}
          status={correctionStatus}
          isApplying={isApplyingCorrections}
          onUpdate={updateCorrection}
          onAdd={addCorrectionRow}
          onRemove={removeCorrectionRow}
          onApply={handleApplyCorrections}
        />
      )}

      {/* 미니 오디오 플레이어(fixed bottom)가 하단 콘텐츠를 가리지 않도록 스페이서 (모바일) */}
      {audio.hasAudio && audio.isReady && (
        <div aria-hidden className="lg:hidden shrink-0 h-[calc(3rem+env(safe-area-inset-bottom))]" />
      )}

      {/* STT 재생성 확인 다이얼로그 */}
      {showSttConfirm && (
        <ConfirmDialog
          title="STT 재생성"
          message="기존 트랜스크립트와 회의록이 모두 삭제되고, 저장된 오디오로 처음부터 다시 생성됩니다. 계속하시겠습니까?"
          confirmLabel="재생성"
          onConfirm={handleRegenerateStt}
          onCancel={() => setShowSttConfirm(false)}
        />
      )}

      {/* 회의록 재생성 확인 다이얼로그 */}
      {showNotesConfirm && (
        <ConfirmDialog
          title="회의록 재생성"
          message="기존 회의록을 삭제하고 전체 트랜스크립트를 바탕으로 처음부터 다시 생성합니다. 계속하시겠습니까?"
          confirmLabel="재생성"
          onConfirm={handleRegenerateNotes}
          onCancel={() => setShowNotesConfirm(false)}
        />
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
