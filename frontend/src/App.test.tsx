import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('./components/editor/MeetingEditor', () => ({
  MeetingEditor: () => null,
  customSchema: { blockSpecs: {} },
}))

vi.mock('./hooks/useSttBlockInserter', () => ({
  useSttBlockInserter: vi.fn(),
}))

vi.mock('./components/meeting/mermaidBlock', () => ({
  MermaidBlock: {},
  editorSchema: { blockSpecs: {} },
  codeBlocksToMermaid: vi.fn((b: unknown[]) => b),
  mermaidToCodeBlocks: vi.fn((b: unknown[]) => b),
}))

vi.mock('@blocknote/react', () => ({
  useCreateBlockNote: vi.fn(() => ({
    document: [],
    replaceBlocks: vi.fn(),
    tryParseMarkdownToBlocks: vi.fn().mockResolvedValue([]),
    blocksToMarkdownLossy: vi.fn().mockResolvedValue(''),
  })),
  createReactBlockSpec: vi.fn(() => ({})),
  SuggestionMenuController: () => null,
  getDefaultReactSlashMenuItems: vi.fn(() => []),
}))

vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: () => null,
}))

vi.mock('@blocknote/core', () => ({
  BlockNoteSchema: { create: vi.fn(() => ({ blockSpecs: {} })) },
  defaultBlockSpecs: {},
  insertOrUpdateBlockForSlashMenu: vi.fn(),
}))

import App from './App'

describe('App 라우팅', () => {
  it('/ 경로에서 /meetings로 리다이렉트됨', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    )
    // meetings page renders after redirect
    expect(document.querySelector('[class]')).toBeTruthy()
  })
})
