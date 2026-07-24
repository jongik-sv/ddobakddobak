import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { createRef } from 'react'
import { useLiveMobileTabs } from './useLiveMobileTabs'
import { SpeakerPanel } from '../components/meeting/SpeakerPanel'
import { RecordTabPanel } from '../components/meeting/RecordTabPanel'
import { AiSummaryPanel } from '../components/meeting/AiSummaryPanel'
import { MeetingEditor } from '../components/editor/MeetingEditor'

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

type HookArgs = Parameters<typeof useLiveMobileTabs>[0]

function baseArgs(overrides: Partial<HookArgs> = {}): HookArgs {
  return {
    meetingId: 1,
    isActive: false,
    onNotesChange: () => {},
    onSaveMemo: () => {},
    isSavingMemo: false,
    memoEditorRef: createRef() as unknown as HookArgs['memoEditorRef'],
    corrections: [],
    isApplyingCorrections: false,
    onUpdateCorrection: () => {},
    onAddCorrection: () => {},
    onRemoveCorrection: () => {},
    onApplyCorrections: () => {},
    canEdit: true,
    ...overrides,
  }
}

describe('useLiveMobileTabs — idea 44 편집권 배선', () => {
  it('canEdit:false 이면 summary 탭이 editable=false, transcript 탭의 SpeakerPanel/RecordTabPanel이 readOnly=true, memo 탭의 MeetingEditor가 editable=false로 렌더된다', () => {
    const { result } = renderHook(() => useLiveMobileTabs(baseArgs({ canEdit: false })))
    const transcriptTab = result.current.find((t) => t.id === 'transcript')!
    const summaryTab = result.current.find((t) => t.id === 'summary')!
    const memoTab = result.current.find((t) => t.id === 'memo')!

    expect(findElement<{ readOnly?: boolean }>(transcriptTab.content, SpeakerPanel)?.props.readOnly).toBe(true)
    expect(findElement<{ readOnly?: boolean }>(transcriptTab.content, RecordTabPanel)?.props.readOnly).toBe(true)
    expect(findElement<{ editable?: boolean }>(summaryTab.content, AiSummaryPanel)?.props.editable).toBe(false)
    expect(findElement<{ editable?: boolean }>(memoTab.content, MeetingEditor)?.props.editable).toBe(false)
  })

  it('canEdit:true 이면 4개 편집 표면 모두 편집 가능하다', () => {
    const { result } = renderHook(() => useLiveMobileTabs(baseArgs({ canEdit: true })))
    const transcriptTab = result.current.find((t) => t.id === 'transcript')!
    const summaryTab = result.current.find((t) => t.id === 'summary')!
    const memoTab = result.current.find((t) => t.id === 'memo')!

    expect(findElement<{ readOnly?: boolean }>(transcriptTab.content, SpeakerPanel)?.props.readOnly).toBe(false)
    expect(findElement<{ readOnly?: boolean }>(transcriptTab.content, RecordTabPanel)?.props.readOnly).toBe(false)
    expect(findElement<{ editable?: boolean }>(summaryTab.content, AiSummaryPanel)?.props.editable).toBe(true)
    expect(findElement<{ editable?: boolean }>(memoTab.content, MeetingEditor)?.props.editable).toBe(true)
  })
})
