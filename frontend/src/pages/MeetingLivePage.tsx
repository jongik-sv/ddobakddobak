import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { Settings, Monitor, Timer, Pencil, RotateCcw } from 'lucide-react'
import { Switch } from '../components/ui/Switch'
import { useUiStore } from '../stores/uiStore'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { useMemoEditor } from '../hooks/useMemoEditor'
import { useToastStore } from '../stores/toastStore'
import { useRecordingStore } from '../stores/recordingStore'
import { useLiveTermCorrections } from '../hooks/useLiveTermCorrections'
import { useLiveBookmark } from '../hooks/useLiveBookmark'
import { useLiveMobileTabs } from '../hooks/useLiveMobileTabs'
import { useNavigationGuards } from '../hooks/useNavigationGuards'
import { RecordTabPanel } from '../components/meeting/RecordTabPanel'
import { AiSummaryPanel } from '../components/meeting/AiSummaryPanel'
import { SummaryOptionsControl } from '../components/meeting/SummaryOptionsControl'
import { SpeakerPanel } from '../components/meeting/SpeakerPanel'
import { MeetingEditor } from '../components/editor/MeetingEditor'
import { getMeeting, updateMeeting, updateNotes, resetMeetingContent, getTranscripts, getSummary, canEditMeeting } from '../api/meetings'
import type { Meeting, UpdateMeetingParams } from '../api/meetings'
import { getClientId } from '../lib/clientId'
import { mapTranscriptsToFinals } from '../lib/transcriptMapper'
import { useTranscriptStore } from '../stores/transcriptStore'
import { useRecordingSignalsStore } from '../stores/recordingSignalsStore'
import { IS_TAURI, IS_MOBILE, SUMMARY_INTERVAL_OPTIONS, getMode } from '../config'
import { AttachmentSection } from '../components/meeting/AttachmentSection'
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
import { MeetingPathBreadcrumb } from '../components/meeting/MeetingPathBreadcrumb'
import { LiveStatusBar } from '../components/meeting/LiveStatusBar'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { planLiveBaselineLoad } from './meetingLiveBaseline'

export default function MeetingLivePage() {
  const { id } = useParams<{ id: string }>()
  const meetingId = Number(id)
  const location = useLocation()
  const navigate = useNavigate()

  // 녹음 세션 스토어 — 페이지는 읽기 + 인텐트 전송만(녹음 본체는 앱-레벨 헤드리스 세션 소유).
  const rec = useRecordingStore()
  const isThisSession = rec.activeMeetingId === meetingId
  const isActive = rec.status === 'recording' && isThisSession

  // 상태 메시지 (하단 상태바) — 전역 토스트 스토어 경유
  const statusMessage = useToastStore((s) => s.message)
  const showStatus = useToastStore((s) => s.showStatus)

  // 표시 데이터(제목/메모 등)는 페이지가 자체 로드 — 세션 상태와 분리.
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [meetingMemo, setMeetingMemo] = useState<string | null>(null)
  useEffect(() => {
    getMeeting(meetingId)
      .then((m) => {
        setMeeting(m)
        if (m.memo) setMeetingMemo(m.memo)
      })
      .catch(() => {})
  }, [meetingId])

  // 활성 녹음 세션이 없을 때만(활성이면 세션 훅이 store를 publish) 표시값을 서버 요약 주기로 동기화.
  // rec.setSummaryInterval을 쓰면 다른 세션 핸들러가 호출될 수 있어 setState로 직접 반영한다.
  useEffect(() => {
    if (rec.activeMeetingId != null || !meeting) return
    if (typeof meeting.summary_interval_sec === 'number') {
      useRecordingStore.setState({ summaryIntervalSec: meeting.summary_interval_sec })
    }
  }, [meeting, rec.activeMeetingId])

  // 이 회의의 베이스라인(전사+요약)을 DB에서 로드/복원.
  // idle이면 reset 후 로드. 녹음 중 이 회의로 복귀하면(중간 경로 reset으로 store가 비거나
  // 라이브 신규 발화만 남은 경우) 히스토리를 복원한다 — 판정은 planLiveBaselineLoad.
  // finals는 라이브 신규를 보존하려 DB와 union(클로버 방지), 요약은 라이브 실시간 요약을 덮지 않게 비었을 때만.
  useEffect(() => {
    const store = useTranscriptStore.getState()
    const plan = planLiveBaselineLoad({
      activeMeetingId: rec.activeMeetingId,
      meetingId,
      notesEmpty: store.meetingNotes === null,
    })
    if (!plan.loadFinals && !plan.loadSummary) return
    let cancelled = false
    if (plan.reset) store.reset()
    if (plan.loadFinals) {
      getTranscripts(meetingId)
        .then((t) => {
          if (cancelled) return
          const dbFinals = mapTranscriptsToFinals(t)
          if (plan.reset) {
            useTranscriptStore.getState().loadFinals(dbFinals)
          } else {
            // DB 히스토리 + 현재(라이브 신규) finals를 id로 union — 라이브가 더 최신이라 우선.
            const byId = new Map(dbFinals.map((f) => [f.id, f] as const))
            for (const f of useTranscriptStore.getState().finals) byId.set(f.id, f)
            useTranscriptStore.getState().loadFinals([...byId.values()])
          }
        })
        .catch(() => {})
    }
    if (plan.loadSummary) {
      getSummary(meetingId)
        .then((s) => { if (!cancelled && s?.notes_markdown) useTranscriptStore.getState().setMeetingNotes(s.notes_markdown) })
        .catch(() => {})
    }
    return () => { cancelled = true }
  }, [meetingId, rec.activeMeetingId])

  // 라이브 상태(이 세션이 활성일 때만 store 값, 아니면 뷰 기본값)
  const isPaused = isThisSession ? rec.isPaused : false
  const elapsedSeconds = isThisSession ? rec.elapsedSeconds : 0
  const summaryCountdown = isThisSession ? rec.summaryCountdown : 0
  const summaryIntervalSec = rec.summaryIntervalSec
  const canManualSummary = isThisSession ? rec.canManualSummary : false
  const systemAudioEnabled = isThisSession ? rec.systemAudioEnabled : false
  const isResetting = isThisSession ? rec.isResetting : false
  const isStopping = isThisSession ? rec.isStopping : false
  const error = isThisSession ? rec.error : null
  const sttEngine = rec.sttEngine
  const activeSttMode = rec.activeSttMode
  // meetingApiStatus: 세션 활성 시 store, 아니면 fetch한 회의 상태.
  // LiveStatusBar는 'transcribing'을 받지 않으므로 'completed'로 좁힘.
  const meetingApiStatus: 'pending' | 'recording' | 'completed' | null = isThisSession
    ? rec.meetingApiStatus
    : meeting
      ? (meeting.status === 'transcribing' ? 'completed' : meeting.status)
      : null

  // 라이브 인텐트(store로 전달 — 핸들러는 헤드리스 세션이 registerHandlers로 등록)
  const handleStart = useCallback(() => rec.start(meetingId), [rec, meetingId])
  const handlePause = rec.pause
  const handleResume = rec.resume
  const handleStop = rec.requestStop
  const handleManualSummary = rec.manualSummary
  const handleToggleSystemAudio = rec.toggleSystemAudio
  // 요약 주기 변경: store 표시값/타이머 반영 + 서버 영속.
  // 활성 세션이면 훅의 영속 setter(onSetSummaryInterval)가 이미 저장하므로, 비활성일 때만 여기서 PUT(이중 저장 방지).
  const setSummaryIntervalSec = useCallback(
    (sec: number) => {
      rec.setSummaryInterval(sec)
      if (!isThisSession) updateMeeting(meetingId, { summary_interval_sec: sec }).catch(() => {})
    },
    [rec, isThisSession, meetingId],
  )

  // 초기화: 다이얼로그 가시성은 페이지-로컬, 실제 초기화는 store 인텐트(+ 메모 에디터 clear는 페이지-로컬).
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const handleResetClick = useCallback(() => setShowResetConfirm(true), [])

  // 네비게이션 정책: 녹음/STT 중엔 뒤로가기·탭 닫기를 보호(확인 후에만 이탈).
  const { handleNavigateBack, showLeaveConfirm, confirmLeave, cancelLeave } =
    useNavigationGuards(meetingId, isActive)

  // 오타 수정 (state + 핸들러)
  const {
    corrections, isApplyingCorrections, handleApplyCorrections,
    updateCorrection, addCorrectionRow, removeCorrectionRow,
  } = useLiveTermCorrections(meetingId, showStatus)

  // isApplyingCorrections를 store에 흘림(요약 게이팅 등 세션이 참조)
  useEffect(() => {
    useRecordingStore.getState().setApplyingCorrections(isApplyingCorrections)
  }, [isApplyingCorrections])

  // 다른 세션이 이미 녹음 중 → 읽기전용 뷰어로 라우팅 (단일 녹음 세션 보장).
  // 헤드리스 세션은 idle 상태에서 신뢰성 있게 처리 못 하므로 페이지-레벨에서 처리.
  const recordingDenied = useRecordingSignalsStore((s) => s.recordingDenied)
  useEffect(() => {
    if (recordingDenied) navigate(`/meetings/${meetingId}/viewer`, { replace: true })
  }, [recordingDenied, meetingId, navigate])

  // 라이브 진입 시 기기 점유 검사 — 다른 기기가 활성 녹음 중(하트비트 신선)이면 뷰어로 보낸다.
  // 채널 denied 신호는 이쪽이 청크를 보내야만 오므로, 첫 발화 전 침묵 구간은 이 검사가 커버한다.
  // 같은 기기의 새로고침 복귀(recording_client_id === 내 clientId)는 절대 리다이렉트하지 않는다.
  useEffect(() => {
    if (!meeting || isActive) return
    if (meeting.status !== 'recording' || !meeting.recorder_active) return
    const occupant = meeting.recording_client_id
    if (!occupant || occupant === getClientId()) return
    showStatus('다른 기기에서 녹음 중입니다', 5000)
    navigate(`/meetings/${meetingId}/viewer`, { replace: true })
  }, [meeting, isActive, meetingId, navigate, showStatus])

  // 예약 회의 자동시작: 스케줄러가 state.autoStart=true로 네비게이트 → 마운트 후 1회 rec.start().
  // ref 가드로 리렌더 간 중복 호출 방지 + nav state 소비(뒤로/새로고침 재트리거 차단).
  const autoStartFiredRef = useRef(false)
  useEffect(() => {
    const autoStart = (location.state as { autoStart?: boolean } | null)?.autoStart
    if (!autoStart || autoStartFiredRef.current) return
    if (meetingApiStatus === 'recording' || isActive) return
    autoStartFiredRef.current = true
    rec.start(meetingId)
    showStatus('회의를 시작합니다', 4000)
    // nav state 소비: 같은 경로로 replace 해 history 항목에서 autoStart 제거.
    navigate(location.pathname, { replace: true, state: {} })
  }, [location.state, location.pathname, meetingApiStatus, isActive, rec, meetingId, showStatus, navigate])

  // 메모 에디터
  const memoCallbacks = useMemo(() => ({
    onSuccess: () => showStatus('메모가 저장되었습니다'),
    onError: () => showStatus('메모 저장에 실패했습니다'),
  }), [showStatus])
  const { memoEditorRef, isSavingMemo, handleSaveMemo } = useMemoEditor(meetingId, meetingMemo, memoCallbacks)

  const handleResetConfirm = useCallback(async () => {
    // 페이지가 직접 초기화 — reset은 보통 세션 미마운트 상태에서만 도달 가능(activeMeetingId=null),
    // 세션 핸들러(_handlers)가 null이라 store 인텐트 위임은 무음 실패한다.
    await resetMeetingContent(meetingId)
    useTranscriptStore.getState().markReset()
    useTranscriptStore.getState().reset()
    useTranscriptStore.getState().setMeetingNotes(null)
    // 메모 에디터 초기화 (페이지-로컬)
    memoEditorRef.current?.replaceBlocks(memoEditorRef.current.document, [])
    const m = await getMeeting(meetingId).catch(() => null)
    if (m) setMeeting(m)
    setShowResetConfirm(false)
  }, [meetingId, memoEditorRef])

  // 회의 정보 수정 다이얼로그
  const [showEditDialog, setShowEditDialog] = useState(false)
  const meetingTypeList = usePromptTemplateStore((s) => s.meetingTypeList)

  // 템플릿 저장 다이얼로그 (회의 템플릿은 중앙 집중관리 — 관리자만 저장 가능)
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const addTemplate = useMeetingTemplateStore((s) => s.add)
  const currentUser = useAuthStore((s) => s.user)
  const canManageTemplates = currentUser?.role === 'admin' || getMode() === 'local'

  // 회의 시작/초기화 어포던스 게이팅(소유자 ∨ admin). 로드 전(null)엔 노출 유지 — 권한은 서버가 403/409로 강제.
  const canEdit = meeting ? canEditMeeting(meeting, currentUser) : true

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

  // 요약 옵션(압축율·재구조화) 컨트롤. PATCH 후 기존 full 필드 보존 위해 merge.
  const summaryOptionsControl = meeting ? (
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
        title={meeting?.title || '회의실'}
        isActive={isActive}
        isPaused={isPaused}
        elapsedSeconds={elapsedSeconds}
        summaryCountdown={summaryCountdown}
        summaryIntervalSec={summaryIntervalSec}
        onSummaryIntervalChange={setSummaryIntervalSec}
        error={error}
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
        canEdit={canEdit}
        onStart={handleStart}
        onPause={handlePause}
        onResume={handleResume}
        onStop={handleStop}
        onManualSummary={handleManualSummary}
        canManualSummary={canManualSummary}
      />

      {meeting && (
        <MeetingPathBreadcrumb
          projectName={meeting.project_name}
          folderPath={meeting.folder_path}
          className="hidden lg:flex px-4 py-1 border-b border-border bg-card/50"
        />
      )}

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
                />
              </div>
              <div className="border-t shrink-0">
                <SpeakerPanel meetingId={meetingId} isRecording={isActive} collapsible />
              </div>
            </section>
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-blue-400 transition-colors cursor-col-resize" />

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
              <PanelResizeHandle className="w-1 bg-border hover:bg-blue-400 transition-colors cursor-col-resize" />

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
            canEdit={canEdit}
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
              className="flex items-center gap-2 py-2 text-sm text-foreground hover:text-foreground"
            >
              <Pencil className="w-4 h-4" />
              회의 정보 수정
            </button>
            {IS_TAURI && (
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">시스템 오디오</span>
                </div>
                <Switch
                  checked={systemAudioEnabled}
                  onChange={handleToggleSystemAudio}
                />
              </div>
            )}
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <Timer className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-foreground">AI 적용 주기</span>
              </div>
              <select
                value={summaryIntervalSec}
                onChange={(e) => setSummaryIntervalSec(Number(e.target.value))}
                className="text-sm border border-border rounded-md px-2 py-1 bg-background text-foreground"
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
                className="flex items-center gap-2 py-2 text-sm text-foreground hover:text-foreground"
              >
                <Settings className="w-4 h-4" />
                설정
              </button>
            )}
            {!isActive && canEdit && (
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
          {meeting && (
            <MeetingPathBreadcrumb
              projectName={meeting.project_name}
              folderPath={meeting.folder_path}
              className="lg:hidden px-3 py-1 border-b border-border bg-card/50"
            />
          )}
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
        isSystemCapturing={false}
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
            setMeeting({ ...meeting, ...updated })
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

      {/* 녹음/STT 중 뒤로가기 보호 확인 다이얼로그 */}
      {showLeaveConfirm && (
        <ConfirmDialog
          title="회의 진행 중"
          message="녹음/STT가 진행 중입니다. 회의 화면에서 나가시겠습니까?"
          confirmLabel="나가기"
          onConfirm={confirmLeave}
          onCancel={cancelLeave}
        />
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
          // eslint-disable-next-line react-hooks/refs -- 팝오버 열기(handleOpenBookmark) 시점에만 세팅되고 열림 중 불변 (기존 패턴)
          timestampMs={bookmarkTimestampRef.current}
          label={bookmarkLabel}
          onLabelChange={setBookmarkLabel}
          onSave={handleSaveBookmark}
          onClose={() => setShowBookmarkPopover(false)}
        />
      )}
    </div>
  )
}
