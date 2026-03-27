import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LiveRecord } from './LiveRecord'
import { useTranscriptStore } from '../../stores/transcriptStore'

describe('LiveRecord', () => {
  beforeEach(() => {
    useTranscriptStore.getState().reset()
  })

  it('빈 상태에서 빈 컨테이너 렌더', () => {
    const { container } = render(<LiveRecord />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('final 발화 텍스트 표시', () => {
    useTranscriptStore.getState().addFinal({
      id: 1,
      content: '안녕하세요',
      speaker_label: 'SPEAKER_00',
      started_at_ms: 0,
      ended_at_ms: 3000,
      sequence_number: 1,
      applied: false,
    })
    render(<LiveRecord />)
    expect(screen.getByText('안녕하세요')).toBeInTheDocument()
  })

  it('여러 final 발화 모두 표시', () => {
    useTranscriptStore.getState().addFinal({
      id: 1,
      content: '첫 번째 발화',
      speaker_label: 'SPEAKER_00',
      started_at_ms: 0,
      ended_at_ms: 3000,
      sequence_number: 1,
      applied: false,
    })
    useTranscriptStore.getState().addFinal({
      id: 2,
      content: '두 번째 발화',
      speaker_label: 'SPEAKER_01',
      started_at_ms: 3000,
      ended_at_ms: 6000,
      sequence_number: 2,
      applied: false,
    })
    render(<LiveRecord />)
    expect(screen.getByText('첫 번째 발화')).toBeInTheDocument()
    expect(screen.getByText('두 번째 발화')).toBeInTheDocument()
  })

  it('partial 텍스트 표시', () => {
    useTranscriptStore.setState({
      partial: { content: '현재 발화 중...', speaker_label: 'SPEAKER_00', started_at_ms: 6000 },
    })
    render(<LiveRecord />)
    expect(screen.getByText('현재 발화 중...')).toBeInTheDocument()
  })

  it('partial 텍스트에 data-testid="partial" 속성', () => {
    useTranscriptStore.setState({
      partial: { content: '현재 발화 중...', speaker_label: 'SPEAKER_00', started_at_ms: 0 },
    })
    render(<LiveRecord />)
    expect(screen.getByTestId('partial-text')).toBeInTheDocument()
  })

  it('final 텍스트는 partial 스타일 없음', () => {
    useTranscriptStore.getState().addFinal({
      id: 1,
      content: '확정 발화',
      speaker_label: 'SPEAKER_00',
      started_at_ms: 0,
      ended_at_ms: 3000,
      sequence_number: 1,
      applied: false,
    })
    render(<LiveRecord />)
    const finalEl = screen.getByText('확정 발화')
    // partial은 italic 스타일이 있어야 하지만 final은 없어야 함
    expect(finalEl.className).not.toContain('italic')
  })

  it('화자 레이블이 final 발화와 함께 표시', () => {
    useTranscriptStore.getState().addFinal({
      id: 1,
      content: '발화 내용',
      speaker_label: 'SPEAKER_00',
      started_at_ms: 0,
      ended_at_ms: 3000,
      sequence_number: 1,
      applied: false,
    })
    render(<LiveRecord />)
    expect(screen.getByText('SPEAKER_00')).toBeInTheDocument()
  })
})
