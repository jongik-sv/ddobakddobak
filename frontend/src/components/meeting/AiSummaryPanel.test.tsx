import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useTranscriptStore } from '../../stores/transcriptStore'

// jsdom에 matchMedia가 없으므로 폴리필
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

// mermaidBlock는 jsdom에서 createReactBlockSpec이 동작하지 않으므로 모킹
vi.mock('./mermaidBlock', async () => {
  const { BlockNoteSchema, defaultBlockSpecs } = await import('@blocknote/core')
  return {
    editorSchema: BlockNoteSchema.create({ blockSpecs: defaultBlockSpecs }),
    codeBlocksToMermaid: (blocks: unknown[]) => blocks,
  }
})

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
