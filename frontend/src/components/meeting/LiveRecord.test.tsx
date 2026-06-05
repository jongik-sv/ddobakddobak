import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LiveRecord } from './LiveRecord'
import { useTranscriptStore } from '../../stores/transcriptStore'

describe('LiveRecord', () => {
  beforeEach(() => {
    useTranscriptStore.getState().reset()
  })

  it('빈 상태에서 빈 컨테이너 렌더', () => {
    const { container } = render(<LiveRecord meetingId={1} />)
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
    render(<LiveRecord meetingId={1} />)
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
    render(<LiveRecord meetingId={1} />)
    expect(screen.getByText('첫 번째 발화')).toBeInTheDocument()
    expect(screen.getByText('두 번째 발화')).toBeInTheDocument()
  })

  it('partial 텍스트 표시', () => {
    useTranscriptStore.setState({
      partial: { content: '현재 발화 중...', speaker_label: 'SPEAKER_00', started_at_ms: 6000 },
    })
    render(<LiveRecord meetingId={1} />)
    expect(screen.getByText('현재 발화 중...')).toBeInTheDocument()
  })

  it('partial 텍스트에 data-testid="partial" 속성', () => {
    useTranscriptStore.setState({
      partial: { content: '현재 발화 중...', speaker_label: 'SPEAKER_00', started_at_ms: 0 },
    })
    render(<LiveRecord meetingId={1} />)
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
    render(<LiveRecord meetingId={1} />)
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
    render(<LiveRecord meetingId={1} />)
    expect(screen.getByText('SPEAKER_00')).toBeInTheDocument()
  })

  it('editable=false면 전사 텍스트가 읽기전용(편집 affordance 없음)', () => {
    useTranscriptStore.getState().addFinal({
      id: 1,
      content: '읽기전용 발화',
      speaker_label: 'SPEAKER_00',
      started_at_ms: 0,
      ended_at_ms: 3000,
      sequence_number: 1,
      applied: false,
    })
    render(<LiveRecord meetingId={-1} editable={false} />)
    const el = screen.getByText('읽기전용 발화')
    // 비편집: contentEditable 비활성 + 포커스 불가(tabIndex=-1)
    expect(el).toHaveAttribute('contenteditable', 'false')
    expect(el).toHaveAttribute('tabindex', '-1')
  })

  it('segmentOffsetsMs 제공 시 표시 시간은 무음컷 병합 타임라인(started_at_ms 아님)', () => {
    // 원본 started_at_ms=41000(무음 갭 포함 절대 타임라인)이지만 병합 오디오는 무음컷 → 30000.
    // 표시 시간이 41초로 나오면 재생 오디오(30초)와 안 맞는다(bug1). 병합 오프셋으로 표시해야 함.
    useTranscriptStore.getState().addFinal({
      id: 1,
      content: '마지막 발화',
      speaker_label: '',
      started_at_ms: 41000,
      ended_at_ms: 43000,
      sequence_number: 1,
      applied: false,
    })
    render(<LiveRecord meetingId={-1} editable={false} segmentOffsetsMs={[30000]} />)
    expect(screen.getByText('00:30')).toBeInTheDocument()
    expect(screen.queryByText('00:41')).not.toBeInTheDocument()
  })

  it('segmentOffsetsMs 없으면(온라인) 기존대로 started_at_ms 표시', () => {
    useTranscriptStore.getState().addFinal({
      id: 1,
      content: '발화',
      speaker_label: '',
      started_at_ms: 41000,
      ended_at_ms: 43000,
      sequence_number: 1,
      applied: false,
    })
    render(<LiveRecord meetingId={1} />)
    expect(screen.getByText('00:41')).toBeInTheDocument()
  })

  it('editable 미지정(기본 true)이면 편집 가능 affordance 유지', () => {
    useTranscriptStore.getState().addFinal({
      id: 1,
      content: '편집가능 발화',
      speaker_label: 'SPEAKER_00',
      started_at_ms: 0,
      ended_at_ms: 3000,
      sequence_number: 1,
      applied: false,
    })
    render(<LiveRecord meetingId={1} />)
    const el = screen.getByText('편집가능 발화')
    expect(el).toHaveAttribute('tabindex', '0')
  })
})
