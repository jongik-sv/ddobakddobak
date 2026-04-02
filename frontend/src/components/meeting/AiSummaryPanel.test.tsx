import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useTranscriptStore } from '../../stores/transcriptStore'

// Mock BlockNote dependencies to avoid browser-only APIs
vi.mock('@blocknote/react', () => ({
  useCreateBlockNote: vi.fn(() => ({
    document: [],
    replaceBlocks: vi.fn(),
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

describe('AiSummaryPanel', () => {
  beforeEach(() => {
    useTranscriptStore.getState().reset()
  })

  it('AI 회의록 헤더 표시', () => {
    render(<AiSummaryPanel meetingId={1} />)
    expect(screen.getByText('AI 회의록')).toBeInTheDocument()
  })

  it('editable=false일 때 저장 버튼 미표시', () => {
    render(<AiSummaryPanel meetingId={1} editable={false} />)
    expect(screen.queryByText('저장')).not.toBeInTheDocument()
    expect(screen.queryByText('저장됨')).not.toBeInTheDocument()
  })

  it('isRecording=true일 때 자동 저장 표시', () => {
    render(<AiSummaryPanel meetingId={1} isRecording={true} />)
    expect(screen.getByText('자동 저장')).toBeInTheDocument()
  })

  it('isRecording=false일 때 저장됨 버튼 표시', () => {
    render(<AiSummaryPanel meetingId={1} isRecording={false} />)
    expect(screen.getByText('저장됨')).toBeInTheDocument()
  })
})
