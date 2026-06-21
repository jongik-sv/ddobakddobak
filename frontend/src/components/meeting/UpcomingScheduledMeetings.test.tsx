import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { UpcomingScheduledMeetings } from './UpcomingScheduledMeetings'
import type { ScheduledMeeting } from '../../api/meetings'

const { mockGetScheduledMeetings, mockNavigate } = vi.hoisted(() => ({
  mockGetScheduledMeetings: vi.fn(),
  mockNavigate: vi.fn(),
}))

vi.mock('../../api/meetings', () => ({
  getScheduledMeetings: mockGetScheduledMeetings,
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

function makeMeeting(over: Partial<ScheduledMeeting>): ScheduledMeeting {
  return {
    id: 1,
    title: '예약 회의',
    status: 'pending',
    meeting_type: 'general',
    created_by: { id: 1, name: '사용자' },
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
    started_at: null,
    ended_at: null,
    created_at: '',
    scheduled_start_time: '2026-06-20T01:00:00.000Z',
    auto_start_mode: 'auto',
    missed: false,
    ...over,
  }
}

function renderSection() {
  return render(
    <MemoryRouter>
      <UpcomingScheduledMeetings />
    </MemoryRouter>,
  )
}

describe('UpcomingScheduledMeetings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('다가오는 예약이 없으면 아무것도 렌더하지 않는다', async () => {
    mockGetScheduledMeetings.mockResolvedValue([makeMeeting({ id: 1, missed: true })])
    const { container } = renderSection()
    await waitFor(() => expect(mockGetScheduledMeetings).toHaveBeenCalled())
    expect(screen.queryByText('예약된 회의')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('다가오는(missed=false) 항목만 렌더하고 missed는 제외한다', async () => {
    mockGetScheduledMeetings.mockResolvedValue([
      makeMeeting({ id: 10, title: '다가오는 회의', missed: false }),
      makeMeeting({ id: 11, title: '놓친 회의', missed: true }),
    ])
    renderSection()
    expect(await screen.findByText('예약된 회의')).toBeInTheDocument()
    expect(screen.getByText('다가오는 회의')).toBeInTheDocument()
    expect(screen.queryByText('놓친 회의')).not.toBeInTheDocument()
  })

  it('scheduled_start_time 오름차순으로 정렬한다', async () => {
    mockGetScheduledMeetings.mockResolvedValue([
      makeMeeting({ id: 1, title: '나중 회의', scheduled_start_time: '2026-06-22T05:00:00.000Z' }),
      makeMeeting({ id: 2, title: '먼저 회의', scheduled_start_time: '2026-06-21T05:00:00.000Z' }),
    ])
    renderSection()
    await screen.findByText('예약된 회의')
    const titles = screen.getAllByRole('heading', { level: 3 }).map((el) => el.textContent)
    expect(titles).toEqual(['먼저 회의', '나중 회의'])
  })

  it('항목 클릭 → 회의 상세로 네비게이트', async () => {
    mockGetScheduledMeetings.mockResolvedValue([
      makeMeeting({ id: 42, title: '클릭 회의', missed: false }),
    ])
    renderSection()
    fireEvent.click(await screen.findByText('클릭 회의'))
    expect(mockNavigate).toHaveBeenCalledWith('/meetings/42')
  })

  it('조회 실패 시 조용히 빈 목록으로 처리한다(throw 안 함)', async () => {
    mockGetScheduledMeetings.mockRejectedValue(new Error('network'))
    const { container } = renderSection()
    await waitFor(() => expect(mockGetScheduledMeetings).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
