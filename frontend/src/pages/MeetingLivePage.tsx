import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { Settings, Monitor, Timer, Pencil } from 'lucide-react'
import { Switch } from '../components/ui/Switch'
import { useUiStore } from '../stores/uiStore'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { useMemoEditor } from '../hooks/useMemoEditor'
import { useLiveRecording } from '../hooks/useLiveRecording'
import { useLiveMobileTabs } from '../hooks/useLiveMobileTabs'
import { RecordTabPanel } from '../components/meeting/RecordTabPanel'
import { AiSummaryPanel } from '../components/meeting/AiSummaryPanel'
import { SpeakerPanel } from '../components/meeting/SpeakerPanel'
import { MeetingEditor } from '../components/editor/MeetingEditor'
import { updateMeeting, triggerRealtimeSummary, correctTerms, updateNotes } from '../api/meetings'
import type { Participant, TermCorrection, UpdateMeetingParams } from '../api/meetings'
import { useTranscriptStore } from '../stores/transcriptStore'
import { IS_TAURI, IS_MOBILE, SUMMARY_INTERVAL_OPTIONS, getMode } from '../config'
import { AttachmentSection } from '../components/meeting/AttachmentSection'
import { ShareButton } from '../components/meeting/ShareButton'
import { ParticipantList } from '../components/meeting/ParticipantList'
import { HostTransferDialog } from '../components/meeting/HostTransferDialog'
import HostDisconnectedBanner from '../components/meeting/HostDisconnectedBanner'
import { useAuthStore } from '../stores/authStore'
import { createBookmark } from '../api/bookmarks'
import { useMeetingTemplateStore } from '../stores/meetingTemplateStore'
import SaveTemplateDialog from '../components/meeting/SaveTemplateDialog'
import EditMeetingDialog from '../components/meeting/EditMeetingDialog'
import { usePromptTemplateStore } from '../stores/promptTemplateStore'
import { useMediaQuery, BREAKPOINTS } from '../hooks/useMediaQuery'
import { useMeetingAccess } from '../hooks/useMeetingAccess'
import { MeetingAccessFallback } from '../components/meeting/MeetingAccessFallback'
import MobileTabLayout from '../components/layout/MobileTabLayout'
import { MobileRecordControls } from '../components/meeting/MobileRecordControls'
import { CorrectionsSection } from '../components/meeting/CorrectionsSection'
import { MemoHeader } from '../components/meeting/MemoHeader'
import { BookmarkPopover } from '../components/meeting/BookmarkPopover'
import { DesktopRecordControls } from '../components/meeting/DesktopRecordControls'
import { LiveStatusBar } from '../components/meeting/LiveStatusBar'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { Dialog } from '../components/ui/Dialog'

export default function MeetingLivePage() {
  const { id } = useParams<{ id: string }>()
  const meetingId = Number(id)

  // 상태 메시지 (하단 상태바)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const statusTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const showStatus = useCallback((msg: string, durationMs = 3000) => {
    setStatusMessage(msg)
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    statusTimerRef.current = setTimeout(() => setStatusMessage(null), durationMs)
  }, [])

  // 오타 수정 상태
  const [corrections, setCorrections] = useState<TermCorrection[]>([{ from: '', to: '' }])
  const [isApplyingCorrections, setIsApplyingCorrections] = useState(false)

  // 메모 에디터 초기화 (useMemoEditor 이후 ref로 주입 — 순환 의존 회피)
  const clearMemoEditorRef = useRef<() => void>(() => {})

  // 라이브 세션(녹음/캡처/요약/세션상태) 컨트롤러
  const live = useLiveRecording(meetingId, {
    showStatus,
    isApplyingCorrections,
    clearMemoEditor: () => clearMemoEditorRef.current(),
  })
  const {
    meeting, setMeeting, meetingMemo, meetingApiStatus, sttEngine,
    isPaused, error, systemAudioError, isSystemCapturing,
    elapsedSeconds, summaryCountdown, summaryIntervalSec, setSummaryIntervalSec,
    systemAudioEnabled, handleToggleSystemAudio, isResetting, isStopping,
    isActive, isSharing, isHost, currentUserId,
    showResetConfirm, setShowResetConfirm, showLeaveBlock, setShowLeaveBlock,
    handleStart, handlePause, handleResume, handleStop,
    handleResetClick, handleResetConfirm, handleNavigateBack,
  } = live

  // 메모 에디터
  const memoCallbacks = useMemo(() => ({
    onSuccess: () => showStatus('메모가 저장되었습니다'),
    onError: () => showStatus('메모 저장에 실패했습니다'),
  }), [showStatus])
  const { memoEditorRef, isSavingMemo, handleSaveMemo } = useMemoEditor(meetingId, meetingMemo, memoCallbacks)
  clearMemoEditorRef.current = () => memoEditorRef.current?.replaceBlocks(memoEditorRef.current.document, [])

  // 회의 정보 수정 다이얼로그
  const [showEditDialog, setShowEditDialog] = useState(false)
  const meetingTypeList = usePromptTemplateStore((s) => s.meetingTypeList)

  // 템플릿 저장 다이얼로그 (회의 템플릿은 중앙 집중관리 — 관리자만 저장 가능)
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const addTemplate = useMeetingTemplateStore((s) => s.add)
  const currentUser = useAuthStore((s) => s.user)
  const canManageTemplates = currentUser?.role === 'admin' || getMode() === 'local'

  // 호스트 위임 다이얼로그
  const [transferTarget, setTransferTarget] = useState<Participant | null>(null)

  // 북마크 팝오버
  const [showBookmarkPopover, setShowBookmarkPopover] = useState(false)
  const [bookmarkLabel, setBookmarkLabel] = useState('')
  const bookmarkTimestampRef = useRef<number>(0)

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
  const markUserEdit = useTranscriptStore((s) => s.markUserEdit)
  const clientId = useTranscriptStore((s) => s.clientId)
  const handleNotesChange = useCallback(
    (markdown: string) => {
      markUserEdit()
      updateNotes(meetingId, markdown, clientId).catch((e) => console.error('[updateNotes] 저장 실패:', e))
    },
    [meetingId, clientId, markUserEdit]
  )

  // 메모/첨부 토글
  const memoVisible = useUiStore((s) => s.memoVisible)
  const toggleMemo = useUiStore((s) => s.toggleMemo)
  const attachmentsVisible = useUiStore((s) => s.attachmentsVisible)
  const toggleAttachments = useUiStore((s) => s.toggleAttachments)

  // 접근 권한 확인
  const { isLoading: accessLoading, error: accessError } = useMeetingAccess(meetingId)

  // 데스크톱/모바일 분기
  const isDesktop = useMediaQuery(BREAKPOINTS.lg)

  // 모바일 탭 정의
  const mobileTabs = useLiveMobileTabs({
    meetingId,
    isActive,
    isSharing,
    isHost,
    currentUserId,
    onTransferRequest: setTransferTarget,
    onNotesChange: handleNotesChange,
    onSaveMemo: handleSaveMemo,
    isSavingMemo,
    memoEditorRef,
    corrections,
    isApplyingCorrections,
    onUpdateCorrection: updateCorrection,
    onAddCorrection: addCorrectionRow,
    onRemoveCorrection: removeCorrectionRow,
    onApplyCorrections: handleApplyCorrections,
  })

  // 403/404 접근 가드 — 모든 hook 호출 이후에 위치
  if (!accessLoading && (accessError === 'forbidden' || accessError === 'not_found')) {
    return <MeetingAccessFallback error={accessError} />
  }

  return (
    <div className="flex flex-col h-full">

      {/* 헤더 컨트롤 바 (데스크톱 전용 — 모바일은 MobileRecordControls 사용) */}
      <DesktopRecordControls
        meetingId={meetingId}
        title={meeting?.title || '회의실'}
        isActive={isActive}
        isPaused={isPaused}
        elapsedSeconds={elapsedSeconds}
        summaryCountdown={summaryCountdown}
        summaryIntervalSec={summaryIntervalSec}
        onSummaryIntervalChange={setSummaryIntervalSec}
        error={error || systemAudioError}
        attachmentsVisible={attachmentsVisible}
        onToggleAttachments={toggleAttachments}
        memoVisible={memoVisible}
        onToggleMemo={toggleMemo}
        canManageTemplates={canManageTemplates}
        systemAudioEnabled={systemAudioEnabled}
        onToggleSystemAudio={handleToggleSystemAudio}
        isResetting={isResetting}
        isStopping={isStopping}
        onNavigateBack={handleNavigateBack}
        onShowEdit={() => setShowEditDialog(true)}
        onShowSaveTemplate={() => setShowSaveTemplate(true)}
        onOpenBookmark={handleOpenBookmark}
        onResetClick={handleResetClick}
        onStart={handleStart}
        onPause={handlePause}
        onResume={handleResume}
        onStop={handleStop}
      />

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
                  {/* 메모 영역 (60%) */}
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
        <>
          <MobileRecordControls
            title={meeting?.title || '회의실'}
            isRecording={isActive}
            isPaused={isPaused}
            elapsedSeconds={elapsedSeconds}
            onBack={handleNavigateBack}
            onStart={handleStart}
            onPause={handlePause}
            onResume={handleResume}
            onStop={handleStop}
            isStopping={isStopping}
          >
            {/* 더보기 바텀 시트 추가 옵션 */}
            <button
              onClick={() => setShowEditDialog(true)}
              className="flex items-center gap-2 py-2 text-sm text-gray-700 hover:text-gray-900"
            >
              <Pencil className="w-4 h-4" />
              회의 정보 수정
            </button>
            <ShareButton meetingId={meetingId} />
            {IS_TAURI && (
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-gray-600" />
                  <span className="text-sm text-gray-700">시스템 오디오</span>
                </div>
                <Switch
                  checked={systemAudioEnabled}
                  onChange={handleToggleSystemAudio}
                />
              </div>
            )}
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <Timer className="w-4 h-4 text-gray-600" />
                <span className="text-sm text-gray-700">AI 적용 주기</span>
              </div>
              <select
                value={summaryIntervalSec}
                onChange={(e) => setSummaryIntervalSec(Number(e.target.value))}
                className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white text-gray-700"
              >
                {SUMMARY_INTERVAL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            {/* 설정 변경은 PC/서버에서만 — 모바일에서는 숨김 */}
            {!IS_MOBILE && (
              <button
                onClick={useUiStore.getState().openSettings}
                className="flex items-center gap-2 py-2 text-sm text-gray-700 hover:text-gray-900"
              >
                <Settings className="w-4 h-4" />
                설정
              </button>
            )}
          </MobileRecordControls>
          <div className="flex-1 min-h-0">
            <MobileTabLayout
              tabs={mobileTabs}
              defaultTab="transcript"
            />
          </div>
        </>
      )}

      {/* 하단 상태바 */}
      <LiveStatusBar
        isSystemCapturing={isSystemCapturing}
        isActive={isActive}
        meetingApiStatus={meetingApiStatus}
        statusMessage={statusMessage}
        sttEngine={sttEngine}
      />

      {/* 회의 정보 수정 다이얼로그 */}
      {showEditDialog && meeting && (
        <EditMeetingDialog
          meeting={meeting}
          meetingTypeList={meetingTypeList}
          onConfirm={async (data: UpdateMeetingParams) => {
            const updated = await updateMeeting(meetingId, data)
            setMeeting(updated)
            setShowEditDialog(false)
            showStatus('회의 정보가 수정되었습니다')
          }}
          onClose={() => setShowEditDialog(false)}
        />
      )}

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
        <Dialog
          onClose={() => setShowLeaveBlock(false)}
          closeOnBackdrop={false}
          closeOnEsc={false}
          className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4"
        >
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
        </Dialog>
      )}

      {/* 초기화 확인 다이얼로그 */}
      {showResetConfirm && (
        <ConfirmDialog
          title="회의 초기화"
          message="모든 회의 내용(기록, 회의록, 액션아이템, 오디오)이 삭제됩니다. 초기화하시겠습니까?"
          confirmLabel="초기화"
          confirmClassName="px-4 py-2 rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-colors"
          onConfirm={handleResetConfirm}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}

      {/* 북마크 추가 팝오버 */}
      {showBookmarkPopover && (
        <BookmarkPopover
          timestampMs={bookmarkTimestampRef.current}
          label={bookmarkLabel}
          onLabelChange={setBookmarkLabel}
          onSave={handleSaveBookmark}
          onClose={() => setShowBookmarkPopover(false)}
        />
      )}

      {/* 호스트 연결 끊김 배너 */}
      <HostDisconnectedBanner meetingId={meetingId} />

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
