import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useTranscriptStore } from '../../stores/transcriptStore'

// Mock BlockNote dependencies to avoid browser-only APIs (mirrors AiSummaryPanel.test.tsx)
vi.mock('@blocknote/react', () => ({
  useCreateBlockNote: vi.fn(() => ({
    document: [],
    replaceBlocks: vi.fn(),
    transact: vi.fn((cb: any) => cb({ setMeta: vi.fn() })),
    tryParseMarkdownToBlocks: vi.fn().mockResolvedValue([]),
    blocksToMarkdownLossy: vi.fn().mockResolvedValue(''),
  })),
  BlockNoteView: vi.fn(({ children }: { children?: React.ReactNode }) => (
    <div data-testid="blocknote-view">{children}</div>
  )),
  SuggestionMenuController: () => null,
  getDefaultReactSlashMenuItems: vi.fn(() => []),
  createReactBlockSpec: vi.fn(() => ({})),
}))

vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: vi.fn(({ children }: { children?: React.ReactNode }) => (
    <div data-testid="blocknote-view">{children}</div>
  )),
}))

vi.mock('@blocknote/core', () => ({
  BlockNoteSchema: { create: vi.fn(() => ({ blockSpecs: {} })) },
  defaultBlockSpecs: {},
  insertOrUpdateBlockForSlashMenu: vi.fn(),
}))

vi.mock('./mermaidBlock', () => ({
  MermaidBlock: vi.fn(() => ({})),
  editorSchema: { blockSpecs: {} },
  codeBlocksToMermaid: vi.fn((b: unknown[]) => b),
  mermaidToCodeBlocks: vi.fn((b: unknown[]) => b),
}))

import { AiSummaryPanel } from './AiSummaryPanel'

const EXPAND_LABEL = '전체보기'
const MODAL_TESTID = 'ai-summary-fullview'

describe('AiSummaryPanel 전체보기(확대) 버튼', () => {
  beforeEach(() => {
    useTranscriptStore.getState().reset()
  })

  it('기본적으로 확대(전체보기) 버튼을 렌더한다', () => {
    render(<AiSummaryPanel meetingId={1} />)
    expect(screen.getByLabelText(EXPAND_LABEL)).toBeInTheDocument()
  })

  it('hideExpand=true면 확대 버튼을 렌더하지 않는다', () => {
    render(<AiSummaryPanel meetingId={1} hideExpand />)
    expect(screen.queryByLabelText(EXPAND_LABEL)).not.toBeInTheDocument()
  })

  it('확대 버튼 클릭 시 전체보기 모달이 표시된다', () => {
    render(<AiSummaryPanel meetingId={1} />)
    expect(screen.queryByTestId(MODAL_TESTID)).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(EXPAND_LABEL))
    expect(screen.getByTestId(MODAL_TESTID)).toBeInTheDocument()
  })

  it('모달 닫기 버튼 클릭 시 모달이 사라진다', () => {
    render(<AiSummaryPanel meetingId={1} />)
    fireEvent.click(screen.getByLabelText(EXPAND_LABEL))
    const modal = screen.getByTestId(MODAL_TESTID)
    expect(modal).toBeInTheDocument()
    // 모달 내부의 닫기 버튼 (aria-label="닫기")
    const closeBtn = screen.getByLabelText('닫기')
    fireEvent.click(closeBtn)
    expect(screen.queryByTestId(MODAL_TESTID)).not.toBeInTheDocument()
  })

  it('모달 내부의 AiSummaryPanel은 확대 버튼을 다시 렌더하지 않는다 (재귀 방지)', () => {
    render(<AiSummaryPanel meetingId={1} />)
    fireEvent.click(screen.getByLabelText(EXPAND_LABEL))
    expect(screen.getByTestId(MODAL_TESTID)).toBeInTheDocument()
    // 패널 외부(트리거)에서만 1개, 모달 안쪽은 hideExpand로 없음 → 총 1개
    expect(screen.getAllByLabelText(EXPAND_LABEL)).toHaveLength(1)
  })
})
