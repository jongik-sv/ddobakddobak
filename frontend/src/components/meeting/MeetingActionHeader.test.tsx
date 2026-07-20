import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MeetingActionHeader } from './MeetingActionHeader'
import type { Meeting } from '../../api/meetings'

const baseMeeting: Meeting = {
  id: 1,
  title: '테스트 회의',
  status: 'completed',
  meeting_type: 'general',
  created_by: { id: 1, name: '테스터' },
  brief_summary: null,
  folder_id: null,
  audio_duration_ms: 0,
  last_transcript_end_ms: 0,
  last_sequence_number: 0,
  memo: null,
  attendees: null,
  shared: true,
  locked: false,
  locked_at: null,
  important: false,
  started_at: '2026-03-25T10:00:00Z',
  ended_at: '2026-03-25T11:00:00Z',
  created_at: '2026-03-25T10:00:00Z',
}

describe('MeetingActionHeader D\'Flow 배지', () => {
  it('미전송(dflow_synced_at 없음) → 배지 없음', () => {
    render(
      <MeetingActionHeader
        meeting={baseMeeting}
        isDesktop
        meetingTypeLabel=""
        onUpdateTitle={vi.fn()}
      />
    )
    expect(screen.queryByText(/D'Flow/)).not.toBeInTheDocument()
  })

  it('전송됨 + 재전송 불필요 → "D\'Flow ✓"', () => {
    render(
      <MeetingActionHeader
        meeting={{ ...baseMeeting, dflow_synced_at: '2026-03-25T12:00:00Z', dflow_needs_resync: false }}
        isDesktop
        meetingTypeLabel=""
        onUpdateTitle={vi.fn()}
      />
    )
    expect(screen.getByText("D'Flow ✓")).toBeInTheDocument()
  })

  it('재전송 필요 → "D\'Flow 재전송 필요" (동기화 시각이 있어도 우선)', () => {
    render(
      <MeetingActionHeader
        meeting={{ ...baseMeeting, dflow_synced_at: '2026-03-25T12:00:00Z', dflow_needs_resync: true }}
        isDesktop
        meetingTypeLabel=""
        onUpdateTitle={vi.fn()}
      />
    )
    expect(screen.getByText("D'Flow 재전송 필요")).toBeInTheDocument()
    expect(screen.queryByText("D'Flow ✓")).not.toBeInTheDocument()
  })
})
