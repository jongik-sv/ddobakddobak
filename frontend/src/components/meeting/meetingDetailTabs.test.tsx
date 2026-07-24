import { describe, it, expect } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import { createRef } from 'react'
import { buildMeetingDetailTabs } from './meetingDetailTabs'
import { SpeakerPanel } from './SpeakerPanel'
import { TranscriptPanel } from './TranscriptPanel'
import { AiSummaryPanel } from './AiSummaryPanel'
import { MemoEditorPanel } from './MemoEditorPanel'
import { BookmarkList } from './BookmarkList'

/** content 트리(중첩 JSX)에서 특정 컴포넌트 타입의 엘리먼트를 재귀 탐색한다. */
function findElement<P>(node: ReactNode, type: unknown): ReactElement<P> | null {
  if (node == null || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement<P>(child, type)
      if (found) return found
    }
    return null
  }
  const el = node as ReactElement<{ children?: ReactNode }>
  if (el.type === type) return el as unknown as ReactElement<P>
  const children = el.props?.children
  return children != null ? findElement<P>(children, type) : null
}

type BuildArgs = Parameters<typeof buildMeetingDetailTabs>[0]

function baseArgs(overrides: Partial<BuildArgs> = {}): BuildArgs {
  return {
    meetingId: 1,
    bookmarksVisible: false,
    bookmarks: [],
    transcripts: [],
    currentTimeMs: 0,
    isPlaying: false,
    onSeek: () => {},
    onDeleteBookmark: () => {},
    onNotesChange: () => {},
    memoEditorRef: createRef() as unknown as BuildArgs['memoEditorRef'],
    onSaveMemo: () => {},
    isSavingMemo: false,
    canEdit: true,
    ...overrides,
  }
}

describe('buildMeetingDetailTabs — idea 44 편집권 배선', () => {
  it('canEdit:false 이면 BookmarkList가 readOnly=true로 배선된다(locked 여부와 무관)', () => {
    const tabs = buildMeetingDetailTabs(baseArgs({
      locked: false,
      canEdit: false,
      bookmarksVisible: true,
      onAddBookmark: () => {},
    }))
    const transcriptTab = tabs.find((t) => t.id === 'transcript')!
    const bookmarkList = findElement<{ readOnly?: boolean }>(transcriptTab.content, BookmarkList)

    expect(bookmarkList?.props.readOnly).toBe(true)
  })


  it('canEdit:false, locked:false 이면 4개 편집 표면 모두 readOnly/editable=false로 게이팅된다', () => {
    const tabs = buildMeetingDetailTabs(baseArgs({ locked: false, canEdit: false }))
    const transcriptTab = tabs.find((t) => t.id === 'transcript')!
    const summaryTab = tabs.find((t) => t.id === 'summary')!
    const memoTab = tabs.find((t) => t.id === 'memo')!

    const speaker = findElement<{ readOnly?: boolean }>(transcriptTab.content, SpeakerPanel)
    const transcript = findElement<{ readOnly?: boolean }>(transcriptTab.content, TranscriptPanel)
    const summary = findElement<{ editable?: boolean }>(summaryTab.content, AiSummaryPanel)
    const memo = findElement<{ readOnly?: boolean }>(memoTab.content, MemoEditorPanel)

    expect(speaker?.props.readOnly).toBe(true)
    expect(transcript?.props.readOnly).toBe(true)
    expect(summary?.props.editable).toBe(false)
    expect(memo?.props.readOnly).toBe(true)
  })

  it('canEdit:true, locked:false 이면 4개 편집 표면 모두 편집 가능하다', () => {
    const tabs = buildMeetingDetailTabs(baseArgs({ locked: false, canEdit: true }))
    const transcriptTab = tabs.find((t) => t.id === 'transcript')!
    const summaryTab = tabs.find((t) => t.id === 'summary')!
    const memoTab = tabs.find((t) => t.id === 'memo')!

    expect(findElement<{ readOnly?: boolean }>(transcriptTab.content, SpeakerPanel)?.props.readOnly).toBe(false)
    expect(findElement<{ readOnly?: boolean }>(transcriptTab.content, TranscriptPanel)?.props.readOnly).toBe(false)
    expect(findElement<{ editable?: boolean }>(summaryTab.content, AiSummaryPanel)?.props.editable).toBe(true)
    expect(findElement<{ readOnly?: boolean }>(memoTab.content, MemoEditorPanel)?.props.readOnly).toBe(false)
  })

  it('canEdit:true, locked:true 조합이면 readOnly가 여전히 true(잠금 우선)', () => {
    const tabs = buildMeetingDetailTabs(baseArgs({ locked: true, canEdit: true }))
    const transcriptTab = tabs.find((t) => t.id === 'transcript')!
    const summaryTab = tabs.find((t) => t.id === 'summary')!
    const memoTab = tabs.find((t) => t.id === 'memo')!

    expect(findElement<{ readOnly?: boolean }>(transcriptTab.content, SpeakerPanel)?.props.readOnly).toBe(true)
    expect(findElement<{ readOnly?: boolean }>(transcriptTab.content, TranscriptPanel)?.props.readOnly).toBe(true)
    expect(findElement<{ editable?: boolean }>(summaryTab.content, AiSummaryPanel)?.props.editable).toBe(false)
    expect(findElement<{ readOnly?: boolean }>(memoTab.content, MemoEditorPanel)?.props.readOnly).toBe(true)
  })
})
