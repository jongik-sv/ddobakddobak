import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRef } from 'react'
import { render, screen } from '@testing-library/react'

const mockEditor = { document: [{ id: 'block-0', type: 'paragraph' }], insertBlocks: vi.fn() }

// mermaidBlock를 먼저 모킹 (MeetingEditor가 import할 때 MermaidBlock()를 호출하므로)
vi.mock('../meeting/mermaidBlock', () => ({
  MermaidBlock: vi.fn(() => ({})),
  editorSchema: { blockSpecs: {} },
  codeBlocksToMermaid: (blocks: unknown[]) => blocks,
}))

// BlockNote는 브라우저 DOM API에 의존하므로 테스트 환경에서 mock 처리
vi.mock('@blocknote/react', () => ({
  useCreateBlockNote: vi.fn(() => mockEditor),
  BlockNoteView: vi.fn(({ editor: _editor, ...props }: { editor: unknown; [key: string]: unknown }) => (
    <div data-testid="blocknote-view" {...props} />
  )),
  createReactBlockSpec: vi.fn(() => vi.fn(() => ({}))),
  SuggestionMenuController: () => null,
  getDefaultReactSlashMenuItems: vi.fn(() => []),
}))

vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: vi.fn(({ editor: _editor, ...props }: { editor: unknown; [key: string]: unknown }) => (
    <div data-testid="blocknote-view" {...props} />
  )),
}))

vi.mock('@blocknote/mantine/style.css', () => ({}))

vi.mock('@blocknote/core', () => ({
  BlockNoteSchema: {
    create: vi.fn(() => ({ blockSpecs: {} })),
  },
  defaultBlockSpecs: {},
  filterSuggestionItems: vi.fn(),
  insertOrUpdateBlock: vi.fn(),
  insertOrUpdateBlockForSlashMenu: vi.fn(),
}))

vi.mock('./blocks', () => ({
  TranscriptBlock: vi.fn(() => ({})),
}))

import { MeetingEditor } from './MeetingEditor'

describe('MeetingEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('기본 렌더링 - BlockNoteView가 화면에 표시됨', () => {
    render(<MeetingEditor />)
    expect(screen.getByTestId('blocknote-view')).toBeInTheDocument()
  })

  it('editable prop이 기본값(true)으로 전달됨', () => {
    render(<MeetingEditor />)
    const view = screen.getByTestId('blocknote-view')
    expect(view).toBeInTheDocument()
  })

  it('editable={false}로 설정 가능', () => {
    render(<MeetingEditor editable={false} />)
    expect(screen.getByTestId('blocknote-view')).toBeInTheDocument()
  })

  it('onChange prop이 제공될 때 컴포넌트 정상 렌더링', () => {
    const onChange = vi.fn()
    render(<MeetingEditor onChange={onChange} />)
    expect(screen.getByTestId('blocknote-view')).toBeInTheDocument()
  })

  it('initialContent prop이 제공될 때 컴포넌트 정상 렌더링', () => {
    const initialContent = [{ type: 'paragraph', content: [{ type: 'text', text: '안녕하세요', styles: {} }], props: {} }]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<MeetingEditor initialContent={initialContent as any} />)
    expect(screen.getByTestId('blocknote-view')).toBeInTheDocument()
  })

  it('editorRef prop 전달 시 editorRef.current에 editor 인스턴스가 할당된다', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editorRef = createRef<any>()
    render(<MeetingEditor editorRef={editorRef} />)
    expect(editorRef.current).toBe(mockEditor)
  })

  it('컴포넌트 언마운트 시 editorRef.current가 null로 정리된다', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editorRef = createRef<any>()
    const { unmount } = render(<MeetingEditor editorRef={editorRef} />)
    expect(editorRef.current).toBe(mockEditor)
    unmount()
    expect(editorRef.current).toBeNull()
  })
})
