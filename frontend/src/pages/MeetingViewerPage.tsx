import { useEffect } from 'react'
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

export default function MeetingViewerPage() {
  const { id } = useParams<{ id: string }>()
  const meetingId = Number(id)
  const navigate = useNavigate()

  const recordingStopped = useSharingStore((s) => s.recordingStopped)
  const participants = useSharingStore((s) => s.participants)

  // 뷰어 진입 시 사이드바 닫기
  useEffect(() => {
    useUiStore.setState({ sidebarOpen: false })
  }, [])

  // 초기 데이터 로드 (회의 정보, 전사, 요약, 참여자)
  const { meetingTitle, isLoaded } = useViewerData(meetingId)

  // TranscriptionChannel 구독 (실시간 전사 수신, sendChunk는 사용하지 않음)
  useTranscription(meetingId)

  // 언마운트 시 스토어 정리
  useEffect(() => {
    return () => {
      useTranscriptStore.getState().reset()
      useSharingStore.getState().reset()
    }
  }, [])

  const handleLeave = () => {
    navigate('/meetings')
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
      {/* 뷰어 헤더 */}
      <ViewerHeader
        title={meetingTitle}
        participantCount={participants.length}
        isRecordingStopped={recordingStopped}
        onLeave={handleLeave}
      />

      {/* 2영역 리사이즈 레이아웃 */}
      <PanelGroup orientation="horizontal" className="flex-1 overflow-hidden">
        {/* 기록 + 화자 + 참여자 영역 — 기본 30% */}
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

        {/* AI 회의록 영역 — 기본 70% */}
        <Panel defaultSize={70} minSize={20}>
          <section
            data-testid="ai-minutes"
            className="h-full overflow-hidden flex flex-col"
          >
            <AiSummaryPanel meetingId={meetingId} isRecording={!recordingStopped} editable={false} />
          </section>
        </Panel>
      </PanelGroup>

      {/* 하단 상태바 */}
      <div className="flex items-center justify-between px-4 h-7 border-t bg-gray-50 text-[11px] text-gray-500 shrink-0 select-none">
        <span className="text-gray-400">
          {recordingStopped ? '종료됨' : '실시간 참여 중'}
        </span>
        <span className="text-gray-400">읽기 전용</span>
      </div>
    </div>
  )
}
