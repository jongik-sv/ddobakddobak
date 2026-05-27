import { useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { useTranscription } from '../hooks/useTranscription'
import { useViewerData } from '../hooks/useViewerData'
import { useTranscriptStore } from '../stores/transcriptStore'
import { useSharingStore } from '../stores/sharingStore'
import { useUiStore } from '../stores/uiStore'
import { RecordTabPanel } from '../components/meeting/RecordTabPanel'
import { AiSummaryPanel } from '../components/meeting/AiSummaryPanel'
import { SpeakerPanel } from '../components/meeting/SpeakerPanel'
import { ParticipantList } from '../components/meeting/ParticipantList'
import { ViewerHeader } from '../components/meeting/ViewerHeader'
import HostDisconnectedBanner from '../components/meeting/HostDisconnectedBanner'
import { useAuthStore } from '../stores/authStore'
import { useMeetingAccess } from '../hooks/useMeetingAccess'
import { MeetingAccessFallback } from '../components/meeting/MeetingAccessFallback'
import { FileText, Bot } from 'lucide-react'
import { useMediaQuery, BREAKPOINTS } from '../hooks/useMediaQuery'
import MobileTabLayout from '../components/layout/MobileTabLayout'
import type { Tab } from '../components/layout/MobileTabLayout'

export default function MeetingViewerPage() {
  const { id } = useParams<{ id: string }>()
  const meetingId = Number(id)
  const navigate = useNavigate()

  const recordingStopped = useSharingStore((s) => s.recordingStopped)
  const participantCount = useSharingStore((s) => s.participants.length)
  const sharingParticipants = useSharingStore((s) => s.participants)
  const authUser = useAuthStore((s) => s.user)
  const isHost = useMemo(() => {
    const host = sharingParticipants.find((p) => p.role === 'host')
    return host?.user_id === authUser?.id && !!authUser?.id
  }, [sharingParticipants, authUser?.id])

  useEffect(() => {
    useUiStore.setState({ sidebarOpen: false })
  }, [])

  const { meetingTitle, isLoaded, error } = useViewerData(meetingId)
  const { isLoading: accessLoading, error: accessError } = useMeetingAccess(meetingId)

  useTranscription(meetingId)

  useEffect(() => {
    return () => {
      useTranscriptStore.getState().reset()
      useSharingStore.getState().reset()
    }
  }, [])

  // viewer가 host로 승격되면 live 페이지로 이동
  useEffect(() => {
    if (isHost) navigate(`/meetings/${meetingId}`)
  }, [isHost, meetingId, navigate])

  const handleLeave = () => {
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
          {/* 화자/참여자 accordion (기본 닫힘) */}
          <details className="border-b">
            <summary className="px-4 py-2 text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50">
              화자 · 참여자
            </summary>
            <div className="px-2 pb-2">
              <SpeakerPanel meetingId={meetingId} isRecording={!recordingStopped} />
              <div className="border-t mt-2 pt-2">
                <ParticipantList isHost={false} currentUserId={0} />
              </div>
            </div>
          </details>
          <div className="flex-1 overflow-hidden">
            <RecordTabPanel meetingId={meetingId} currentTimeMs={0} />
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
  ], [meetingId, recordingStopped])

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
        <div className="text-gray-400 text-sm">회의 정보를 불러오는 중...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <ViewerHeader
        title={meetingTitle}
        participantCount={participantCount}
        isRecordingStopped={recordingStopped}
        onLeave={handleLeave}
      />
      <HostDisconnectedBanner meetingId={meetingId} />

      {/* 데스크톱: 좌우 분할 / 모바일: 탭 레이아웃 */}
      {isDesktop ? (
        <PanelGroup orientation="horizontal" className="flex-1 overflow-hidden">
          <Panel defaultSize={30} minSize={15}>
            <section className="h-full border-r overflow-hidden flex flex-col">
              <div className="flex-1 overflow-hidden">
                <RecordTabPanel
                  meetingId={meetingId}
                  currentTimeMs={0}
                />
              </div>
              <div className="border-t shrink-0">
                <SpeakerPanel meetingId={meetingId} isRecording={!recordingStopped} />
              </div>
              <div className="border-t shrink-0">
                <ParticipantList
                  isHost={false}
                  currentUserId={0}
                />
              </div>
            </section>
          </Panel>

          <PanelResizeHandle className="w-1 bg-gray-200 hover:bg-blue-400 transition-colors cursor-col-resize" />

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

      <div className="flex items-center justify-between px-4 h-7 border-t bg-gray-50 text-[11px] text-gray-500 shrink-0 select-none">
        <span className="text-gray-400">
          {recordingStopped ? '종료됨' : '실시간 참여 중'}
        </span>
        <span className="text-gray-400">읽기 전용</span>
      </div>
    </div>
  )
}
