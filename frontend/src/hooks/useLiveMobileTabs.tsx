import { useMemo } from 'react'
import { FileText, Bot, PenLine, MessageCircle } from 'lucide-react'
import { RecordTabPanel } from '../components/meeting/RecordTabPanel'
import { AiChatPanel } from '../components/meeting/AiChatPanel'
import { AiSummaryPanel } from '../components/meeting/AiSummaryPanel'
import { SpeakerPanel } from '../components/meeting/SpeakerPanel'
import { MeetingEditor, customSchema } from '../components/editor/MeetingEditor'
import { ParticipantList } from '../components/meeting/ParticipantList'
import { MemoHeader } from '../components/meeting/MemoHeader'
import { CorrectionsSection } from '../components/meeting/CorrectionsSection'
import { triggerRealtimeSummary } from '../api/meetings'
import type { Participant, TermCorrection } from '../api/meetings'
import type { Tab } from '../components/layout/MobileTabLayout'
import type { BlockNoteEditor } from '@blocknote/core'

type MemoEditorRef = React.RefObject<BlockNoteEditor<typeof customSchema.blockSchema> | null>

interface UseLiveMobileTabsArgs {
  meetingId: number
  isActive: boolean
  isSharing: boolean
  isHost: boolean
  currentUserId: number
  onTransferRequest: (p: Participant) => void
  onNotesChange: (markdown: string) => void
  onSaveMemo: () => void
  isSavingMemo: boolean
  memoEditorRef: MemoEditorRef
  corrections: TermCorrection[]
  isApplyingCorrections: boolean
  onUpdateCorrection: (index: number, field: 'from' | 'to', value: string) => void
  onAddCorrection: () => void
  onRemoveCorrection: (index: number) => void
  onApplyCorrections: () => void
  /** 요약 탭 헤더에 끼울 요약 옵션 컨트롤 (페이지가 생성·게이팅) */
  summaryOptions?: React.ReactNode
}

/** MeetingLivePage 모바일 탭(기록/요약/AI챗/메모) 정의를 생성한다. */
export function useLiveMobileTabs({
  meetingId,
  isActive,
  isSharing,
  isHost,
  currentUserId,
  onTransferRequest,
  onNotesChange,
  onSaveMemo,
  isSavingMemo,
  memoEditorRef,
  corrections,
  isApplyingCorrections,
  onUpdateCorrection,
  onAddCorrection,
  onRemoveCorrection,
  onApplyCorrections,
  summaryOptions,
}: UseLiveMobileTabsArgs): Tab[] {
  return useMemo(() => [
    {
      id: 'transcript',
      label: '기록',
      icon: FileText,
      content: (
        <div className="h-full flex flex-col">
          {/* 화자 관리 accordion (기본 닫힘) */}
          <details className="border-b">
            <summary className="px-4 py-2 text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50">
              화자 관리
            </summary>
            <div className="px-2 pb-2">
              <SpeakerPanel meetingId={meetingId} isRecording={isActive} />
              {isSharing && (
                <div className="border-t mt-2 pt-2">
                  <ParticipantList
                    isHost={isHost}
                    currentUserId={currentUserId}
                    onTransferRequest={onTransferRequest}
                  />
                </div>
              )}
            </div>
          </details>
          <div className="flex-1 overflow-hidden">
            <RecordTabPanel
              meetingId={meetingId}
              currentTimeMs={0}
              onApply={() => triggerRealtimeSummary(meetingId)}
            />
          </div>
        </div>
      ),
    },
    {
      id: 'summary',
      label: '요약',
      icon: Bot,
      content: (
        <AiSummaryPanel meetingId={meetingId} isRecording={isActive} onNotesChange={onNotesChange} headerExtra={summaryOptions} />
      ),
    },
    {
      id: 'chat',
      label: 'AI 챗',
      icon: MessageCircle,
      content: <AiChatPanel scopeId={meetingId} />,
    },
    {
      id: 'memo',
      label: '메모',
      icon: PenLine,
      content: (
        <div className="h-full flex flex-col overflow-hidden">
          <MemoHeader onSave={onSaveMemo} isSaving={isSavingMemo} />
          <div className="flex-1 overflow-auto">
            <MeetingEditor editorRef={memoEditorRef} />
          </div>
          {/* 오타 수정 영역 */}
          <div className="flex flex-col border-t shrink-0" style={{ maxHeight: '40%' }}>
            <CorrectionsSection
              corrections={corrections}
              isApplyingCorrections={isApplyingCorrections}
              onUpdate={onUpdateCorrection}
              onAdd={onAddCorrection}
              onRemove={onRemoveCorrection}
              onApply={onApplyCorrections}
            />
          </div>
        </div>
      ),
    },
  ], [meetingId, isActive, isSharing, isHost, currentUserId, onTransferRequest, onNotesChange, onSaveMemo, isSavingMemo, memoEditorRef, corrections, isApplyingCorrections, onUpdateCorrection, onAddCorrection, onRemoveCorrection, onApplyCorrections, summaryOptions])
}
