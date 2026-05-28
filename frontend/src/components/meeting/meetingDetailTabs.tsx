import { FileText, Bot, StickyNote } from 'lucide-react'
import { BookmarkList } from './BookmarkList'
import { TranscriptPanel } from './TranscriptPanel'
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
  onNotesChange: (markdown: string) => void
  memoEditorRef: MemoEditorRef
  onSaveMemo: () => void
  isSavingMemo: boolean
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
  onNotesChange,
  memoEditorRef,
  onSaveMemo,
  isSavingMemo,
}: BuildMeetingDetailTabsArgs): Tab[] {
  return [
    {
      id: 'transcript',
      label: '기록',
      icon: FileText,
      content: (
        <div className="h-full flex flex-col overflow-hidden">
          {bookmarksVisible && (
            <BookmarkList bookmarks={bookmarks} onSeek={onSeek} onDelete={onDeleteBookmark} />
          )}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <TranscriptPanel
              meetingId={meetingId}
              transcripts={transcripts}
              currentTimeMs={currentTimeMs}
              onSeek={onSeek}
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
        <div className="h-full bg-gray-50 overflow-hidden flex flex-col min-h-0">
          <AiSummaryPanel meetingId={meetingId} isRecording={false} onNotesChange={onNotesChange} />
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
