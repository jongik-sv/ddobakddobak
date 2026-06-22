import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useTranscriptStore } from '../../stores/transcriptStore'

// Mock BlockNote dependencies to avoid browser-only APIs
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

// appSettingsStore mock — controlled per test via mockDiarizationEnabled
let mockDiarizationEnabled = true
vi.mock('../../stores/appSettingsStore', () => ({
  useAppSettingsStore: (sel: (s: { diarizationEnabled: boolean }) => unknown) =>
    sel({ diarizationEnabled: mockDiarizationEnabled }),
}))

import { AiSummaryPanel } from './AiSummaryPanel'

const HINT_TEXT = '화자분리가 완료되었습니다.'

function setupTranscript({
  meetingNotes = null as string | null,
  finalsCount = 1,
  isSummarizing = false,
} = {}) {
  const store = useTranscriptStore.getState()
  store.reset()
  if (finalsCount > 0) {
    // addFinal expects the store shape — use setState directly for simplicity
    useTranscriptStore.setState({
      finals: Array.from({ length: finalsCount }, (_, i) => ({
        id: i + 1,
        content: `발화 ${i + 1}`,
        speaker_label: `SPEAKER_0${i}`,
        speaker_name: null,
        started_at_ms: i * 1000,
        ended_at_ms: (i + 1) * 1000,
        sequence_number: i + 1,
        applied: true,
      })),
    })
  }
  useTranscriptStore.setState({ meetingNotes, isSummarizing })
}

// setupTranscript는 finalsCount만큼 화자라벨을 SPEAKER_00, SPEAKER_01 … 로 생성하므로
// finalsCount>=2면 distinct 화자 2명 이상(실제 분리됨), finalsCount===1이면 단일 화자(분리 안 됨).
describe('AiSummaryPanel 힌트 노출 조건', () => {
  beforeEach(() => {
    mockDiarizationEnabled = true
    useTranscriptStore.getState().reset()
  })

  it('화자 2명 이상 분리 + 나머지 조건 충족 시 힌트 렌더', () => {
    // diarizationEnabled=true, meetingNotes=null, distinct 화자>1, !isSummarizing
    setupTranscript({ meetingNotes: null, finalsCount: 2, isSummarizing: false })
    render(<AiSummaryPanel meetingId={1} />)
    expect(screen.getByText(HINT_TEXT, { exact: false })).toBeInTheDocument()
  })

  it("meetingNotes='' (빈 문자열)일 때도 (화자 2명 이상) 힌트 렌더", () => {
    setupTranscript({ meetingNotes: '', finalsCount: 2, isSummarizing: false })
    render(<AiSummaryPanel meetingId={1} />)
    expect(screen.getByText(HINT_TEXT, { exact: false })).toBeInTheDocument()
  })

  it('화자가 1명뿐이면(실제 분리 안 됨) 힌트 미표시', () => {
    // 버그 회귀: 전사가 모두 한 화자인데 "화자분리 완료" 안내가 뜨던 문제
    setupTranscript({ meetingNotes: null, finalsCount: 1, isSummarizing: false })
    render(<AiSummaryPanel meetingId={1} />)
    expect(screen.queryByText(HINT_TEXT, { exact: false })).not.toBeInTheDocument()
  })

  it('diarizationEnabled=false면 힌트 미표시', () => {
    mockDiarizationEnabled = false
    setupTranscript({ meetingNotes: null, finalsCount: 2, isSummarizing: false })
    render(<AiSummaryPanel meetingId={1} />)
    expect(screen.queryByText(HINT_TEXT, { exact: false })).not.toBeInTheDocument()
  })

  it('meetingNotes가 존재하면 힌트 미표시', () => {
    setupTranscript({ meetingNotes: '기존 회의록 내용', finalsCount: 2, isSummarizing: false })
    render(<AiSummaryPanel meetingId={1} />)
    expect(screen.queryByText(HINT_TEXT, { exact: false })).not.toBeInTheDocument()
  })

  it('finals가 비어 있으면 힌트 미표시', () => {
    setupTranscript({ meetingNotes: null, finalsCount: 0, isSummarizing: false })
    render(<AiSummaryPanel meetingId={1} />)
    expect(screen.queryByText(HINT_TEXT, { exact: false })).not.toBeInTheDocument()
  })

  it('isSummarizing=true이면 힌트 미표시', () => {
    setupTranscript({ meetingNotes: null, finalsCount: 2, isSummarizing: true })
    render(<AiSummaryPanel meetingId={1} />)
    expect(screen.queryByText(HINT_TEXT, { exact: false })).not.toBeInTheDocument()
  })
})
