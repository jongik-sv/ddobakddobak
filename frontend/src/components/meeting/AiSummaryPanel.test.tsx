import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AiSummaryPanel } from './AiSummaryPanel'
import { useTranscriptStore } from '../../stores/transcriptStore'

describe('AiSummaryPanel', () => {
  beforeEach(() => {
    useTranscriptStore.getState().reset()
  })

  it('summary가 null일 때 준비 중 메시지 표시', () => {
    render(<AiSummaryPanel />)
    expect(screen.getByText('회의가 시작되면 AI가 요약을 생성합니다.')).toBeInTheDocument()
  })

  it('key_points 렌더링 확인', () => {
    useTranscriptStore.setState({
      summary: {
        type: 'summary_update',
        key_points: ['첫 번째 핵심 포인트', '두 번째 핵심 포인트'],
        decisions: [],
        updated_at: '2026-03-25T10:00:00Z',
      },
    })
    render(<AiSummaryPanel />)
    expect(screen.getByText('첫 번째 핵심 포인트')).toBeInTheDocument()
    expect(screen.getByText('두 번째 핵심 포인트')).toBeInTheDocument()
  })

  it('decisions 렌더링 확인', () => {
    useTranscriptStore.setState({
      summary: {
        type: 'summary_update',
        key_points: [],
        decisions: ['결정사항 A', '결정사항 B'],
        updated_at: '2026-03-25T10:00:00Z',
      },
    })
    render(<AiSummaryPanel />)
    expect(screen.getByText('결정사항 A')).toBeInTheDocument()
    expect(screen.getByText('결정사항 B')).toBeInTheDocument()
  })

  it('is_final=true일 때 최종 요약 배지 표시', () => {
    useTranscriptStore.setState({
      summary: {
        type: 'summary_update',
        key_points: ['핵심 내용'],
        decisions: [],
        updated_at: '2026-03-25T10:00:00Z',
        is_final: true,
      },
    })
    render(<AiSummaryPanel />)
    expect(screen.getByText('최종 요약')).toBeInTheDocument()
  })

  it('action_items 렌더링 확인 (있을 경우)', () => {
    useTranscriptStore.setState({
      summary: {
        type: 'summary_update',
        key_points: [],
        decisions: [],
        action_items: ['액션 아이템 1', '액션 아이템 2'],
        updated_at: '2026-03-25T10:00:00Z',
      },
    })
    render(<AiSummaryPanel />)
    expect(screen.getByText('액션 아이템 1')).toBeInTheDocument()
    expect(screen.getByText('액션 아이템 2')).toBeInTheDocument()
  })

  it('key_points와 decisions 모두 빈 배열일 때 빈 상태 메시지 표시', () => {
    useTranscriptStore.setState({
      summary: {
        type: 'summary_update',
        key_points: [],
        decisions: [],
        updated_at: '2026-03-25T10:00:00Z',
      },
    })
    render(<AiSummaryPanel />)
    expect(screen.getByText('아직 요약할 내용이 없습니다.')).toBeInTheDocument()
  })
})
