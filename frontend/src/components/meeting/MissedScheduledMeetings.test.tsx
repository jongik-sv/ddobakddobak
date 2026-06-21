import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MissedScheduledMeetings } from './MissedScheduledMeetings'
import type { ScheduledMeeting } from '../../api/meetings'

const { mockGetScheduledMeetings, mockDismissSchedule, mockNavigate } = vi.hoisted(() => ({
  mockGetScheduledMeetings: vi.fn(),
  mockDismissSchedule: vi.fn(),
  mockNavigate: vi.fn(),
}))

vi.mock('../../api/meetings', () => ({
  getScheduledMeetings: mockGetScheduledMeetings,
  dismissSchedule: mockDismissSchedule,
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
    missed: true,
    ...over,
  }
}

function renderSection() {
  return render(
    <MemoryRouter>
      <MissedScheduledMeetings />
    </MemoryRouter>,
  )
}

describe('MissedScheduledMeetings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('놓친 예약이 없으면 아무것도 렌더하지 않는다', async () => {
    mockGetScheduledMeetings.mockResolvedValue([
      makeMeeting({ id: 1, missed: false }),
    ])
    const { container } = renderSection()
    await waitFor(() => expect(mockGetScheduledMeetings).toHaveBeenCalled())
    expect(screen.queryByText('놓친 예약 회의')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('missed 항목을 제목과 함께 렌더한다', async () => {
    mockGetScheduledMeetings.mockResolvedValue([
      makeMeeting({ id: 10, title: '월요 정기회의', missed: true }),
      makeMeeting({ id: 11, title: '다가오는 회의', missed: false }),
    ])
    renderSection()
    expect(await screen.findByText('놓친 예약 회의')).toBeInTheDocument()
    expect(screen.getByText('월요 정기회의')).toBeInTheDocument()
    // missed=false 항목은 표시하지 않는다
    expect(screen.queryByText('다가오는 회의')).not.toBeInTheDocument()
  })

  it('닫기 → dismissSchedule(id) 호출 + 목록에서 제거', async () => {
    mockGetScheduledMeetings.mockResolvedValue([
      makeMeeting({ id: 20, title: '닫을 회의', missed: true }),
    ])
    mockDismissSchedule.mockResolvedValue({})
    renderSection()
    await screen.findByText('닫을 회의')

    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(mockDismissSchedule).toHaveBeenCalledWith(20))
    await waitFor(() => expect(screen.queryByText('닫을 회의')).not.toBeInTheDocument())
  })

  it('지금 시작 → autoStart state로 라이브 페이지 네비게이트', async () => {
    mockGetScheduledMeetings.mockResolvedValue([
      makeMeeting({ id: 30, title: '시작할 회의', missed: true }),
    ])
    renderSection()
    await screen.findByText('시작할 회의')

    fireEvent.click(screen.getByRole('button', { name: '지금 시작' }))
    expect(mockNavigate).toHaveBeenCalledWith('/meetings/30/live', {
      state: { autoStart: true },
    })
  })

  it('조회 실패 시 조용히 빈 목록으로 처리한다(throw 안 함)', async () => {
    mockGetScheduledMeetings.mockRejectedValue(new Error('network'))
    const { container } = renderSection()
    await waitFor(() => expect(mockGetScheduledMeetings).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
