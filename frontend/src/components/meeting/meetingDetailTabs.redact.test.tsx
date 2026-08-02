import { describe, it, expect, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import { isValidElement } from 'react'
import { buildMeetingDetailTabs } from './meetingDetailTabs'
import { TranscriptPanel } from './TranscriptPanel'

// useLiveMobileTabs.test.tsx:56 과 같은 트리 순회 헬퍼 (그 파일은 로컬 정의라 재사용 불가)
function findElement<P>(node: ReactNode, type: unknown): ReactElement<P> | null {
  if (!isValidElement(node)) return null
  if (node.type === type) return node as ReactElement<P>
  const children = (node.props as { children?: ReactNode }).children
  if (Array.isArray(children)) {
    for (const c of children) {
      const found = findElement<P>(c, type)
      if (found) return found
    }
    return null
  }
  return findElement<P>(children, type)
}

type PanelProps = {
  canRedact?: boolean
  dflowSynced?: boolean
  onRedacted?: (r: unknown) => void
}

function buildArgs(overrides: Record<string, unknown> = {}) {
  return {
    meetingId: 1,
    bookmarksVisible: false,
    bookmarks: [],
    transcripts: [],
    currentTimeMs: 0,
    isPlaying: false,
    onSeek: vi.fn(),
    onDeleteBookmark: vi.fn(),
    onNotesChange: vi.fn(),
    memoEditorRef: { current: null },
    onSaveMemo: vi.fn(),
    isSavingMemo: false,
    canEdit: true,
    ...overrides,
  } as Parameters<typeof buildMeetingDetailTabs>[0]
}

describe('meetingDetailTabs 절단 prop 스레딩 (모바일 탭 경로)', () => {
  it('canRedact·dflowSynced·onRedacted를 TranscriptPanel로 전달한다', () => {
    const onRedacted = vi.fn()
    const tabs = buildMeetingDetailTabs(buildArgs({ canRedact: true, dflowSynced: false, onRedacted }))
    const transcriptTab = tabs.find((t) => t.id === 'transcript')

    const panel = findElement<PanelProps>(transcriptTab!.content, TranscriptPanel)

    expect(panel?.props.canRedact).toBe(true)
    expect(panel?.props.dflowSynced).toBe(false)
    expect(panel?.props.onRedacted).toBe(onRedacted)
  })

  it('전달하지 않으면 canRedact가 undefined라 TranscriptPanel 기본값(false)이 적용된다', () => {
    const tabs = buildMeetingDetailTabs(buildArgs())
    const transcriptTab = tabs.find((t) => t.id === 'transcript')

    const panel = findElement<PanelProps>(transcriptTab!.content, TranscriptPanel)

    expect(panel?.props.canRedact).toBeUndefined()
  })
})
