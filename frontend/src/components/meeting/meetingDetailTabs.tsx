import { FileText, Bot, StickyNote, MessageCircle } from 'lucide-react'
import { BookmarkList } from './BookmarkList'
import { TranscriptPanel } from './TranscriptPanel'
import { SpeakerPanel } from './SpeakerPanel'
import { AiSummaryPanel } from './AiSummaryPanel'
import { MemoEditorPanel } from './MemoEditorPanel'
import { AiChatPanel } from './AiChatPanel'
import { customSchema } from '../editor/MeetingEditor'
import type { Transcript } from '../../api/meetings'
import type { Bookmark as BookmarkType } from '../../api/bookmarks'
import type { Tab } from '../layout/MobileTabLayout'
import type { BlockNoteEditor } from '@blocknote/core'

type MemoEditorRef = React.RefObject<BlockNoteEditor<typeof customSchema.blockSchema> | null>
type OnEditorReady = (editor: BlockNoteEditor<typeof customSchema.blockSchema>) => void

interface BuildMeetingDetailTabsArgs {
  meetingId: number
  bookmarksVisible: boolean
  bookmarks: BookmarkType[]
  transcripts: Transcript[]
  currentTimeMs: number
  onSeek: (ms: number) => void
  onDeleteBookmark: (bookmarkId: number) => void
  onAddBookmark?: () => void
  onEditBookmark?: (bookmarkId: number, label: string) => void
  onNotesChange: (markdown: string) => void
  memoEditorRef: MemoEditorRef
  onMemoEditorReady?: OnEditorReady
  onSaveMemo: () => void
  isSavingMemo: boolean
  /** 요약 탭 헤더에 끼울 요약 옵션 컨트롤 (페이지가 생성·게이팅) */
  summaryOptions?: React.ReactNode
  /** 페이지 내 검색어 (전사 하이라이트용) */
  searchQuery?: string
  /** 현재 활성 전사 매치 */
  activeSearch?: { transcriptId: number; occurrence: number } | null
  /** 검색 중 오디오 싱크 자동 스크롤 억제 */
  suppressAutoScroll?: boolean
  /** 잠긴 회의면 전사·화자·회의록 편집을 막는다 (읽기 전용). 기본 false. */
  locked?: boolean
  /** AI 회의록(요약) 아래에 끼울 노드(오타수정·오타사전 등). 페이지가 생성. */
  belowSummary?: React.ReactNode
}

/** 회의 상세 모바일 탭(기록/요약/메모) 정의를 생성한다. (순수 함수 — 훅 아님) */
export function buildMeetingDetailTabs({
  meetingId,
  bookmarksVisible,
  bookmarks,
  transcripts,
  currentTimeMs,
  onSeek,
  onDeleteBookmark,
  onAddBookmark,
  onEditBookmark,
  onNotesChange,
  memoEditorRef,
  onMemoEditorReady,
  onSaveMemo,
  isSavingMemo,
  summaryOptions,
  searchQuery,
  activeSearch,
  suppressAutoScroll,
  locked = false,
  belowSummary,
}: BuildMeetingDetailTabsArgs): Tab[] {
  return [
    {
      id: 'transcript',
      label: '기록',
      icon: FileText,
      content: (
        <div className="h-full flex flex-col overflow-hidden">
          {bookmarksVisible && (
            <BookmarkList bookmarks={bookmarks} onSeek={onSeek} onDelete={onDeleteBookmark} onAdd={onAddBookmark} onEdit={onEditBookmark} readOnly={locked} />
          )}
          {/* 화자 accordion (기본 닫힘) — MeetingViewerPage 모바일과 동일 패턴 */}
          <details className="border-b">
            <summary className="px-4 py-2 text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50">
              화자
            </summary>
            <div className="px-2 pb-2">
              <SpeakerPanel meetingId={meetingId} isRecording={false} readOnly={locked} />
            </div>
          </details>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <TranscriptPanel
              meetingId={meetingId}
              transcripts={transcripts}
              currentTimeMs={currentTimeMs}
              onSeek={onSeek}
              searchQuery={searchQuery}
              activeSearch={activeSearch}
              suppressAutoScroll={suppressAutoScroll}
              readOnly={locked}
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
        <div data-search-region="summary" className="h-full bg-gray-50 overflow-hidden flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <AiSummaryPanel meetingId={meetingId} isRecording={false} editable={!locked} onNotesChange={onNotesChange} headerExtra={summaryOptions} />
          </div>
          {belowSummary}
        </div>
      ),
    },
    {
      id: 'memo',
      label: '메모',
      icon: StickyNote,
      content: (
        <MemoEditorPanel
          meetingId={meetingId}
          editorRef={memoEditorRef}
          onEditorReady={onMemoEditorReady}
          onSave={onSaveMemo}
          isSaving={isSavingMemo}
          readOnly={locked}
        />
      ),
    },
    {
      id: 'chat',
      label: 'AI 챗',
      icon: MessageCircle,
      content: <AiChatPanel meetingId={meetingId} onSeek={onSeek} />,
    },
  ]
}
