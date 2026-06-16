import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { useTranscriptStore } from '../../stores/transcriptStore'

// ── Capture the editor object the component uses so we can assert on transact ──
const replaceBlocksSpy = vi.fn()
const setMetaSpy = vi.fn()
const transactSpy = vi.fn((cb: (tr: { setMeta: typeof setMetaSpy }) => unknown) =>
  cb({ setMeta: setMetaSpy }),
)
const tryParseMarkdownToBlocksSpy = vi.fn().mockResolvedValue([])

vi.mock('@blocknote/react', () => ({
  useCreateBlockNote: vi.fn(() => ({
    document: [],
    replaceBlocks: replaceBlocksSpy,
    transact: transactSpy,
    tryParseMarkdownToBlocks: tryParseMarkdownToBlocksSpy,
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

import { AiSummaryPanel, isSuspiciousEmptySave } from './AiSummaryPanel'

describe('isSuspiciousEmptySave (Defense 2 pure helper)', () => {
  it('empty-over-nonempty → true (destructive auto-save)', () => {
    expect(isSuspiciousEmptySave('', 'some notes')).toBe(true)
  })

  it('nonempty-over-nonempty → false', () => {
    expect(isSuspiciousEmptySave('new content', 'old content')).toBe(false)
  })

  it('nonempty-over-empty → false', () => {
    expect(isSuspiciousEmptySave('new content', '')).toBe(false)
  })

  it('empty-over-empty → false (nothing to lose)', () => {
    expect(isSuspiciousEmptySave('', '')).toBe(false)
  })

  it('whitespace-only next over nonempty prev → true (whitespace treated as empty)', () => {
    expect(isSuspiciousEmptySave('   \n\t  ', 'real content')).toBe(true)
  })

  it('whitespace-only prev → treated as empty, so not suspicious', () => {
    expect(isSuspiciousEmptySave('', '   \n  ')).toBe(false)
  })
})

describe('AiSummaryPanel — Defense 1: programmatic inject excluded from undo history', () => {
  beforeEach(() => {
    replaceBlocksSpy.mockClear()
    setMetaSpy.mockClear()
    transactSpy.mockClear()
    tryParseMarkdownToBlocksSpy.mockClear()
    tryParseMarkdownToBlocksSpy.mockResolvedValue([])
    useTranscriptStore.getState().reset()
  })

  it('null-branch clear wraps replaceBlocks in transact with addToHistory:false', () => {
    // reset() → meetingNotes === null → null branch runs the empty-clear inject.
    render(<AiSummaryPanel meetingId={1} />)
    expect(transactSpy).toHaveBeenCalled()
    expect(setMetaSpy).toHaveBeenCalledWith('addToHistory', false)
    expect(replaceBlocksSpy).toHaveBeenCalled()
  })

  it('async notes-inject (non-null meetingNotes) wraps replaceBlocks in transact with addToHistory:false', async () => {
    // Non-empty parse result so the inject path actually runs replaceBlocks.
    tryParseMarkdownToBlocksSpy.mockResolvedValue([
      { type: 'paragraph', content: '내용' },
    ])
    render(<AiSummaryPanel meetingId={1} />)
    // null-branch clear fired synchronously on mount; clear so we assert the inject.
    transactSpy.mockClear()
    setMetaSpy.mockClear()
    replaceBlocksSpy.mockClear()
    // Set a real markdown string → updateBlocks() effect parses then injects.
    useTranscriptStore.getState().setMeetingNotes('# 실제 회의록\n내용')
    await waitFor(() => expect(replaceBlocksSpy).toHaveBeenCalled())
    expect(tryParseMarkdownToBlocksSpy).toHaveBeenCalledWith('# 실제 회의록\n내용')
    expect(transactSpy).toHaveBeenCalled()
    expect(setMetaSpy).toHaveBeenCalledWith('addToHistory', false)
  })
})
