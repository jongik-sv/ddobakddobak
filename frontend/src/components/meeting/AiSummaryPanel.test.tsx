import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

vi.mock('../../api/sttTermLearning', () => ({ getAiOriginal: vi.fn() }))

import { getAiOriginal } from '../../api/sttTermLearning'
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

  it('summaryError(realtime) 시 재시도 안내 실패 배지 표시', () => {
    useTranscriptStore.setState({ summaryError: { kind: 'realtime', message: 'LLM 오류' } })
    render(<AiSummaryPanel meetingId={1} />)
    const badge = screen.getByRole('alert')
    expect(badge).toHaveTextContent('요약 실패 — 다음 주기에 재시도합니다')
    // 상세 사유는 title(툴팁)로 제공
    expect(badge).toHaveAttribute('title', 'LLM 오류')
  })

  it('summaryError(final) 시 실패 사유를 배지에 표시', () => {
    useTranscriptStore.setState({ summaryError: { kind: 'final', message: '토큰 초과' } })
    render(<AiSummaryPanel meetingId={1} />)
    expect(screen.getByRole('alert')).toHaveTextContent('최종 요약 실패: 토큰 초과')
  })

  it('요약 진행 중에는 실패 배지 대신 스피너 표시', () => {
    useTranscriptStore.setState({
      summaryError: { kind: 'realtime', message: '오류' },
      isSummarizing: true,
      summarizationKind: 'realtime',
    })
    render(<AiSummaryPanel meetingId={1} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('요약 중...')).toBeInTheDocument()
  })

  it('summaryError 없으면 실패 배지 미표시', () => {
    render(<AiSummaryPanel meetingId={1} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('긴 실패 사유도 배지가 truncate로 처리하고 전체 사유는 title로 제공한다', () => {
    const longMessage = 'LLM 오류: ' + '아주 긴 오류 원문 '.repeat(50)
    useTranscriptStore.setState({ summaryError: { kind: 'final', message: longMessage } })
    render(<AiSummaryPanel meetingId={1} />)
    const badge = screen.getByRole('alert')
    // 레이아웃 보호: 줄바꿈 없이 말줄임 처리 (truncate = nowrap + ellipsis + overflow-hidden)
    expect(badge.className).toContain('truncate')
    expect(badge.className).toContain('max-w-')
    // 전체 사유는 툴팁으로 접근 가능
    expect(badge).toHaveAttribute('title', longMessage)
  })
})

describe('AiSummaryPanel AI 원본과 비교', () => {
  beforeEach(() => {
    useTranscriptStore.getState().reset()
    vi.mocked(getAiOriginal).mockReset()
  })

  it('canCompareAiOriginal 이면 ⋯ 메뉴에 "AI 원본과 비교", 기본(false)·hideExpand 에서는 ⋯ 없음', () => {
    const { unmount } = render(<AiSummaryPanel meetingId={1} />)
    expect(screen.queryByLabelText('더보기')).not.toBeInTheDocument()
    unmount()
    const r2 = render(<AiSummaryPanel meetingId={1} canCompareAiOriginal hideExpand />)
    expect(screen.queryByLabelText('더보기')).not.toBeInTheDocument()
    r2.unmount()
    render(<AiSummaryPanel meetingId={1} canCompareAiOriginal />)
    fireEvent.click(screen.getByLabelText('더보기'))
    expect(screen.getByText('AI 원본과 비교')).toBeInTheDocument()
  })

  it('메뉴 클릭 → 모달이 getAiOriginal 호출 후 diff와 시각 표시', async () => {
    vi.mocked(getAiOriginal).mockResolvedValue({
      available: true,
      ai_generated_at: '2026-11-20T01:00:00Z',
      human_edited_at: '2026-11-21T02:00:00Z',
      diff: [{ op: 'insert', text: '후판' }],
    })
    render(<AiSummaryPanel meetingId={5} canCompareAiOriginal />)
    fireEvent.click(screen.getByLabelText('더보기'))
    fireEvent.click(screen.getByText('AI 원본과 비교'))
    expect(await screen.findByText('후판')).toBeInTheDocument()
    expect(getAiOriginal).toHaveBeenCalledWith(5)
    expect(screen.getByText(/AI 생성/)).toBeInTheDocument()
    expect(screen.getByText(/마지막 사람 수정/)).toBeInTheDocument()
  })

  it('available false 면 안내', async () => {
    vi.mocked(getAiOriginal).mockResolvedValue({
      available: false, ai_generated_at: null, human_edited_at: null, diff: [],
    })
    render(<AiSummaryPanel meetingId={5} canCompareAiOriginal />)
    fireEvent.click(screen.getByLabelText('더보기'))
    fireEvent.click(screen.getByText('AI 원본과 비교'))
    expect(
      await screen.findByText('이 회의에는 AI 원본이 없습니다(기능 도입 전 회의 또는 녹음 중)'),
    ).toBeInTheDocument()
  })
})
