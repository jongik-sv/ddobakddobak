import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useTranscriptStore } from '../../stores/transcriptStore'

// idea.md #40: 오타교정·회의록 재생성 같은 외부발 갱신이 updateBlocks()에서
// editor.replaceBlocks()로 문서 전체를 치환하면(블록 ID 전면 재생성) BlockNote가
// 스크롤을 맨 위로 초기화한다. 이 테스트는 그 초기화를 replaceBlocks 스텁 안에서
// 흉내 내고, AiSummaryPanel이 rAF 복원 로직으로 scrollTop을 되돌리는지 검증한다.
let scrollEl: HTMLElement | null = null

const replaceBlocksSpy = vi.fn(() => {
  // 실 BlockNote가 문서 전체 치환 시 스크롤을 0으로 되돌리는 것을 흉내
  if (scrollEl) scrollEl.scrollTop = 0
})
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
  createReactInlineContentSpec: vi.fn(() => ({})),
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

describe('AiSummaryPanel — 외부발 갱신 시 스크롤 위치 복원 (idea.md #40)', () => {
  beforeEach(() => {
    scrollEl = null
    replaceBlocksSpy.mockClear()
    setMetaSpy.mockClear()
    transactSpy.mockClear()
    tryParseMarkdownToBlocksSpy.mockClear()
    tryParseMarkdownToBlocksSpy.mockResolvedValue([])
    useTranscriptStore.getState().reset()
  })

  it('오타교정 등 외부발 setMeetingNotes로 문서가 치환돼도 scrollTop이 복원된다', async () => {
    render(<AiSummaryPanel meetingId={1} />)
    scrollEl = screen.getByTestId('blocknote-view').parentElement as HTMLElement

    // 마운트 시 null-branch 클리어가 한 번 발생 — 정착될 때까지 대기 후 스파이 초기화
    await waitFor(() => expect(replaceBlocksSpy).toHaveBeenCalled())
    replaceBlocksSpy.mockClear()

    // 사용자가 스크롤을 내려둔 상태를 시뮬레이션
    scrollEl.scrollTop = 150

    // 외부발 갱신(오타교정 적용 결과 등)이 store를 직접 갱신
    tryParseMarkdownToBlocksSpy.mockResolvedValue([{ type: 'paragraph', content: '교정된 내용' }])
    useTranscriptStore.getState().setMeetingNotes('# 교정된 회의록\n내용')

    // replaceBlocks 스텁이 스크롤을 0으로 리셋(BlockNote의 실제 동작 흉내)한 뒤,
    // 이중 rAF 복원 로직이 이전 스크롤 위치(150)로 되돌려야 한다.
    // (rAF가 waitFor의 폴링보다 먼저 발화할 수 있어 0으로 리셋되는 중간 상태는
    // 별도로 단언하지 않는다 — 최종 복원 결과만 검증)
    await waitFor(() => expect(replaceBlocksSpy).toHaveBeenCalled())
    await waitFor(() => expect(scrollEl?.scrollTop).toBe(150))
  })
})
