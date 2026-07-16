import { useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { useTranscription } from '../hooks/useTranscription'
import { useViewerData } from '../hooks/useViewerData'
import { useTranscriptStore } from '../stores/transcriptStore'
import { useRecordingSignalsStore } from '../stores/recordingSignalsStore'
import { useUiStore } from '../stores/uiStore'
import { RecordTabPanel } from '../components/meeting/RecordTabPanel'
import { AiSummaryPanel } from '../components/meeting/AiSummaryPanel'
import { SpeakerPanel } from '../components/meeting/SpeakerPanel'
import { ViewerHeader } from '../components/meeting/ViewerHeader'
import { useMeetingAccess } from '../hooks/useMeetingAccess'
import { MeetingAccessFallback } from '../components/meeting/MeetingAccessFallback'
import { FileText, Bot } from 'lucide-react'
import { useMediaQuery, BREAKPOINTS } from '../hooks/useMediaQuery'
import MobileTabLayout from '../components/layout/MobileTabLayout'
import type { Tab } from '../components/layout/MobileTabLayout'

/** 읽기전용 뷰어 — 다른 기기에서 녹음 중인 회의의 전사/회의록을 실시간으로 지켜본다. */
export default function MeetingViewerPage() {
  const { id } = useParams<{ id: string }>()
  const meetingId = Number(id)
  const navigate = useNavigate()

  const recordingStopped = useRecordingSignalsStore((s) => s.recordingStopped)
  const recordingPausedSignal = useRecordingSignalsStore((s) => s.recordingPaused)

  useEffect(() => {
    useUiStore.setState({ sidebarOpen: false })
  }, [])

  const { meetingTitle, locked, paused: initialPaused, isLoaded, error } = useViewerData(meetingId)
  // 일시정지 표시: 채널 신호(recording_paused/resumed)가 '이 회의'의 것일 때만 신호 우선,
  // 아니면(신호 미수신·타 회의 신호) 진입 시 REST 스냅샷으로 폴백 — 타 회의 신호 누수 차단.
  const isPaused = recordingPausedSignal?.meetingId === meetingId
    ? recordingPausedSignal.paused
    : initialPaused
  const { isLoading: accessLoading, error: accessError } = useMeetingAccess(meetingId)

  useTranscription(meetingId)

  useEffect(() => {
    return () => {
      useTranscriptStore.getState().reset()
      useRecordingSignalsStore.getState().reset()
    }
  }, [])

  const handleBack = () => {
    navigate('/meetings')
  }

  const isDesktop = useMediaQuery(BREAKPOINTS.lg)

  const mobileTabs: Tab[] = useMemo(() => [
    {
      id: 'transcript',
      label: '기록',
      icon: FileText,
      content: (
        <div className="h-full flex flex-col">
          {/* 화자 accordion (기본 닫힘) */}
          <details className="border-b">
            <summary className="px-4 py-2 text-sm font-medium text-foreground cursor-pointer hover:bg-muted">
              화자
            </summary>
            <div className="px-2 pb-2">
              <SpeakerPanel meetingId={meetingId} isRecording={!recordingStopped} readOnly={locked} />
            </div>
          </details>
          <div className="flex-1 overflow-hidden">
            <RecordTabPanel meetingId={meetingId} currentTimeMs={0} readOnly={locked} />
          </div>
        </div>
      ),
    },
    {
      id: 'summary',
      label: 'AI 회의록',
      icon: Bot,
      content: (
        <AiSummaryPanel meetingId={meetingId} isRecording={!recordingStopped} editable={false} />
      ),
    },
  ], [meetingId, recordingStopped, locked])

  if (!accessLoading && (accessError === 'forbidden' || accessError === 'not_found')) {
    return <MeetingAccessFallback error={accessError} />
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-500 text-sm">{error}</div>
      </div>
    )
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground text-sm">회의 정보를 불러오는 중...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <ViewerHeader
        title={meetingTitle}
        isRecordingStopped={recordingStopped}
        isPaused={isPaused}
        onBack={handleBack}
      />

      {/* 데스크톱: 좌우 분할 / 모바일: 탭 레이아웃 */}
      {isDesktop ? (
        <PanelGroup orientation="horizontal" className="flex-1 overflow-hidden">
          <Panel defaultSize={30} minSize={15}>
            <section className="h-full border-r overflow-hidden flex flex-col">
              <div className="flex-1 overflow-hidden">
                <RecordTabPanel
                  meetingId={meetingId}
                  currentTimeMs={0}
                  readOnly={locked}
                />
              </div>
              <div className="border-t shrink-0">
                <SpeakerPanel meetingId={meetingId} isRecording={!recordingStopped} collapsible readOnly={locked} />
              </div>
            </section>
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-blue-400 transition-colors cursor-col-resize" />

          <Panel defaultSize={70} minSize={20}>
            <section
              data-testid="ai-minutes"
              className="h-full overflow-hidden flex flex-col"
            >
              <AiSummaryPanel meetingId={meetingId} isRecording={!recordingStopped} editable={false} />
            </section>
          </Panel>
        </PanelGroup>
      ) : (
        <div className="flex-1 min-h-0">
          <MobileTabLayout tabs={mobileTabs} defaultTab="transcript" />
        </div>
      )}

      <div className="flex items-center justify-between px-4 h-7 border-t bg-muted text-[11px] text-muted-foreground shrink-0 select-none">
        <span className="text-muted-foreground">
          {recordingStopped ? '종료됨' : isPaused ? '다른 기기에서 녹음 중 — 일시정지' : '다른 기기에서 녹음 중'}
        </span>
        <span className="text-muted-foreground">읽기 전용</span>
      </div>
    </div>
  )
}
