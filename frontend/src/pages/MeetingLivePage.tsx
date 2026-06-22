import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { Settings, Monitor, Timer, Pencil, RotateCcw } from 'lucide-react'
import { Switch } from '../components/ui/Switch'
import { useUiStore } from '../stores/uiStore'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { useMemoEditor } from '../hooks/useMemoEditor'
import { useToastStore } from '../stores/toastStore'
import { useLiveRecording } from '../hooks/useLiveRecording'
import { useLiveTermCorrections } from '../hooks/useLiveTermCorrections'
import { useLiveBookmark } from '../hooks/useLiveBookmark'
import { useLiveMobileTabs } from '../hooks/useLiveMobileTabs'
import { RecordTabPanel } from '../components/meeting/RecordTabPanel'
import { AiSummaryPanel } from '../components/meeting/AiSummaryPanel'
import { SummaryOptionsControl } from '../components/meeting/SummaryOptionsControl'
import { SpeakerPanel } from '../components/meeting/SpeakerPanel'
import { MeetingEditor } from '../components/editor/MeetingEditor'
import { updateMeeting, triggerRealtimeSummary, updateNotes } from '../api/meetings'
import type { Participant, UpdateMeetingParams } from '../api/meetings'
import { useTranscriptStore } from '../stores/transcriptStore'
import { IS_TAURI, IS_MOBILE, SUMMARY_INTERVAL_OPTIONS, getMode } from '../config'
import { AttachmentSection } from '../components/meeting/AttachmentSection'
import { ShareButton } from '../components/meeting/ShareButton'
import { ParticipantList } from '../components/meeting/ParticipantList'
import { HostTransferDialog } from '../components/meeting/HostTransferDialog'
import HostDisconnectedBanner from '../components/meeting/HostDisconnectedBanner'
import { useAuthStore } from '../stores/authStore'
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
import { RightTabsPanel } from '../components/meeting/RightTabsPanel'
import { BookmarkPopover } from '../components/meeting/BookmarkPopover'
import { DesktopRecordControls } from '../components/meeting/DesktopRecordControls'
import { LiveStatusBar } from '../components/meeting/LiveStatusBar'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { StopMeetingDialog } from '../components/meeting/StopMeetingDialog'
import { Dialog } from '../components/ui/Dialog'

export default function MeetingLivePage() {
  const { id } = useParams<{ id: string }>()
  const meetingId = Number(id)
  const location = useLocation()
  const navigate = useNavigate()

  // 상태 메시지 (하단 상태바) — 전역 토스트 스토어 경유
  const statusMessage = useToastStore((s) => s.message)
  const showStatus = useToastStore((s) => s.showStatus)

  // 오타 수정 (state + 핸들러) — useLiveRecording 이전에 호출(isApplyingCorrections 주입)
  const {
    corrections, isApplyingCorrections, handleApplyCorrections,
    updateCorrection, addCorrectionRow, removeCorrectionRow,
  } = useLiveTermCorrections(meetingId, showStatus)

  // 메모 에디터 초기화 (useMemoEditor 이후 ref로 주입 — 순환 의존 회피)
  const clearMemoEditorRef = useRef<() => void>(() => {})

  // 라이브 세션(녹음/캡처/요약/세션상태) 컨트롤러
  const live = useLiveRecording(meetingId, {
    isApplyingCorrections,
    clearMemoEditor: () => clearMemoEditorRef.current(),
  })
  const {
    meeting, setMeeting, meetingMemo, meetingApiStatus, sttEngine, activeSttMode,
    isPaused, error, systemAudioError, isSystemCapturing,
    elapsedSeconds, summaryCountdown, summaryIntervalSec, setSummaryIntervalSec,
    systemAudioEnabled, handleToggleSystemAudio, isResetting, isStopping,
    isActive, isSharing, isHost, currentUserId,
    showResetConfirm, setShowResetConfirm, showLeaveBlock, setShowLeaveBlock,
    handleStart, handlePause, handleResume, handleStop,
    handleManualSummary, canManualSummary,
    showStopConfirm, confirmStopSummarize, confirmStopSkip, cancelStop,
    handleResetClick, handleResetConfirm, handleNavigateBack,
  } = live

  // 예약 회의 자동시작: 스케줄러가 state.autoStart=true로 네비게이트 → 마운트 후 1회 handleStart().
  // ref 가드로 리렌더 간 중복 호출 방지 + nav state 소비(뒤로/새로고침 재트리거 차단).
  const autoStartFiredRef = useRef(false)
  useEffect(() => {
    const autoStart = (location.state as { autoStart?: boolean } | null)?.autoStart
    if (!autoStart || autoStartFiredRef.current) return
    if (meetingApiStatus === 'recording' || isActive) return
    autoStartFiredRef.current = true
    handleStart()
    showStatus('회의를 시작합니다', 4000)
    // nav state 소비: 같은 경로로 replace 해 history 항목에서 autoStart 제거.
    navigate(location.pathname, { replace: true, state: {} })
  }, [location.state, location.pathname, meetingApiStatus, isActive, handleStart, showStatus, navigate])

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

  // 북마크 팝오버 + Ctrl+B 단축키
  const {
    showBookmarkPopover, setShowBookmarkPopover, bookmarkLabel, setBookmarkLabel,
    bookmarkTimestampRef, handleOpenBookmark, handleSaveBookmark,
  } = useLiveBookmark({ meetingId, elapsedSeconds, isActive, showStatus })

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

  // 요약 옵션(압축율·재구조화) 컨트롤 — 솔로 녹음자 또는 공유 host 만. PATCH 후 기존 full 필드 보존 위해 merge.
  const summaryOptionsControl = meeting && (!isSharing || isHost) ? (
    <SummaryOptionsControl
      meeting={meeting}
      onSave={async (params) => {
        const updated = await updateMeeting(meetingId, params)
        setMeeting({ ...meeting, ...updated })
      }}
    />
  ) : undefined

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
    summaryOptions: summaryOptionsControl,
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
        onManualSummary={handleManualSummary}
        canManualSummary={canManualSummary}
      />

      {/* 첨부 파일/링크 섹션 */}
      {attachmentsVisible && <AttachmentSection meetingId={meetingId} />}

      {/* 데스크톱: 3영역 리사이즈 레이아웃 / 모바일: 탭 레이아웃 */}
      {isDesktop ? (
        <PanelGroup orientation="horizontal" className="flex-1 overflow-hidden">
          {/* 기록 + 화자 영역 — 기본 22% */}
          <Panel defaultSize={22} minSize={15}>
            <section className="h-full border-r overflow-hidden flex flex-col">
              <div className="flex-1 overflow-hidden">
                <RecordTabPanel
                  meetingId={meetingId}
                  currentTimeMs={0}
                  onApply={() => triggerRealtimeSummary(meetingId)}
                />
              </div>
              <div className="border-t shrink-0">
                <SpeakerPanel meetingId={meetingId} isRecording={isActive} collapsible />
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

          {/* AI 회의록 영역 — 기본 48% */}
          <Panel defaultSize={48} minSize={20}>
            <section
              data-testid="ai-minutes"
              className="h-full border-r overflow-hidden flex flex-col"
            >
              <AiSummaryPanel
                meetingId={meetingId}
                isRecording={isActive}
                onNotesChange={handleNotesChange}
                headerExtra={summaryOptionsControl}
              />
            </section>
          </Panel>

          {memoVisible && (
            <>
              <PanelResizeHandle className="w-1 bg-gray-200 hover:bg-blue-400 transition-colors cursor-col-resize" />

              {/* 메모 + 오타수정 + AI 챗 탭 — 나머지 30% */}
              <Panel defaultSize={30} minSize={15}>
                <RightTabsPanel
                  meetingId={meetingId}
                  memo={
                    <section
                      data-testid="memo-editor"
                      className="h-full flex flex-col overflow-hidden"
                    >
                      <MemoHeader onSave={handleSaveMemo} isSaving={isSavingMemo} />
                      <div className="flex-1 overflow-auto">
                        <MeetingEditor editorRef={memoEditorRef} />
                      </div>
                    </section>
                  }
                  corrections={
                    <div className="h-full flex flex-col overflow-hidden">
                      <CorrectionsSection
                        corrections={corrections}
                        isApplyingCorrections={isApplyingCorrections}
                        onUpdate={updateCorrection}
                        onAdd={addCorrectionRow}
                        onRemove={removeCorrectionRow}
                        onApply={handleApplyCorrections}
                      />
                    </div>
                  }
                />
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
            onManualSummary={handleManualSummary}
            canManualSummary={canManualSummary}
            isStopping={isStopping}
          >
            {(closeMore) => (
            <>
            {/* 더보기 바텀 시트 추가 옵션 */}
            <button
              onClick={() => { closeMore(); setShowEditDialog(true) }}
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
                onClick={() => { closeMore(); useUiStore.getState().openSettings() }}
                className="flex items-center gap-2 py-2 text-sm text-gray-700 hover:text-gray-900"
              >
                <Settings className="w-4 h-4" />
                설정
              </button>
            )}
            {!isActive && (
              <button
                onClick={() => { closeMore(); handleResetClick() }}
                disabled={isResetting}
                className="flex items-center gap-2 py-2 text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
              >
                <RotateCcw className="w-4 h-4" />
                {isResetting ? '초기화 중...' : '회의 초기화'}
              </button>
            )}
            </>
            )}
          </MobileRecordControls>
          <div className="flex-1 min-h-0">
            <MobileTabLayout
              tabs={mobileTabs}
              defaultTab="chat"
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
        activeSttMode={activeSttMode}
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

      {showStopConfirm && (
        <StopMeetingDialog
          onSummarize={confirmStopSummarize}
          onSkip={confirmStopSkip}
          onCancel={cancelStop}
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
