import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AiSummaryPanel } from './AiSummaryPanel'
import { useTranscriptStore } from '../../stores/transcriptStore'

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
