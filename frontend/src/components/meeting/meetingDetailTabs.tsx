import { FileText, Bot, StickyNote } from 'lucide-react'
import { BookmarkList } from './BookmarkList'
import { TranscriptPanel } from './TranscriptPanel'
import { SpeakerPanel } from './SpeakerPanel'
import { AiSummaryPanel } from './AiSummaryPanel'
import { MemoEditorPanel } from './MemoEditorPanel'
import { customSchema } from '../editor/MeetingEditor'
import type { Transcript } from '../../api/meetings'
import type { Bookmark as BookmarkType } from '../../api/bookmarks'
import type { Tab } from '../layout/MobileTabLayout'
import type { BlockNoteEditor } from '@blocknote/core'

type MemoEditorRef = React.RefObject<BlockNoteEditor<typeof customSchema.blockSchema> | null>

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
  onSaveMemo,
  isSavingMemo,
  summaryOptions,
  searchQuery,
  activeSearch,
  suppressAutoScroll,
}: BuildMeetingDetailTabsArgs): Tab[] {
  return [
    {
      id: 'transcript',
      label: '기록',
      icon: FileText,
      content: (
        <div className="h-full flex flex-col overflow-hidden">
          {bookmarksVisible && (
            <BookmarkList bookmarks={bookmarks} onSeek={onSeek} onDelete={onDeleteBookmark} onAdd={onAddBookmark} onEdit={onEditBookmark} />
          )}
          {/* 화자 accordion (기본 닫힘) — MeetingViewerPage 모바일과 동일 패턴 */}
          <details className="border-b">
            <summary className="px-4 py-2 text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50">
              화자
            </summary>
            <div className="px-2 pb-2">
              <SpeakerPanel meetingId={meetingId} isRecording={false} />
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
          <AiSummaryPanel meetingId={meetingId} isRecording={false} onNotesChange={onNotesChange} headerExtra={summaryOptions} />
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
          onSave={onSaveMemo}
          isSaving={isSavingMemo}
        />
      ),
    },
  ]
}
