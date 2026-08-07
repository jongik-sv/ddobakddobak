import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { MeetingActionHeader } from './MeetingActionHeader'
import type { Meeting } from '../../api/meetings'

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

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
    renderWithRouter(
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
    renderWithRouter(
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
    renderWithRouter(
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

describe('MeetingActionHeader ↩ 이전 배지', () => {
  it('previous_meeting_id 있음 → button, 클릭 시 해당 회의로 이동', () => {
    function LocationProbe() {
      return <div data-testid="location">{useLocation().pathname}</div>
    }
    render(
      <MemoryRouter initialEntries={['/meetings/1']}>
        <Routes>
          <Route
            path="/meetings/1"
            element={
              <MeetingActionHeader
                meeting={{ ...baseMeeting, previous_meeting_id: 42, previous_meeting_title: '이전 회의' }}
                isDesktop
                meetingTypeLabel=""
                onUpdateTitle={vi.fn()}
              />
            }
          />
          <Route path="/meetings/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    )
    const badge = screen.getByRole('button', { name: /이전 회의로 이동/ })
    expect(badge).toBeInTheDocument()
    fireEvent.click(badge)
    expect(screen.getByTestId('location')).toHaveTextContent('/meetings/42')
  })

  it('previous_meeting_id 없음(제목만) → non-clickable span, title 속성 없음', () => {
    renderWithRouter(
      <MeetingActionHeader
        meeting={{ ...baseMeeting, previous_meeting_id: null, previous_meeting_title: '이전 회의' }}
        isDesktop
        meetingTypeLabel=""
        onUpdateTitle={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: /이전 회의로 이동/ })).not.toBeInTheDocument()
    const badge = screen.getByText('↩ 이전')
    expect(badge.tagName).toBe('SPAN')
    expect(badge).not.toHaveAttribute('title')
  })
})
