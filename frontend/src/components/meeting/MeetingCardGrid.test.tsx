import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MeetingCardGrid } from './MeetingCardGrid'
import type { Meeting } from '../../api/meetings'
import { useAuthStore } from '../../stores/authStore'

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 1,
    title: '회의 A',
    status: 'completed',
    meeting_type: 'general',
    created_by: { id: 1, name: '소유자' },
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
    editable: true,
    started_at: null,
    ended_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const noop = () => {}

function renderGrid(meetings: Meeting[], onToggleImportant = vi.fn()) {
  render(
    <MeetingCardGrid
      childFolders={[]}
      meetings={meetings}
      searchQuery=""
      folders={[]}
      selectedFolderId="all"
      isDesktop
      meetingTypeMap={{}}
      onFolderSelect={noop}
      onMeetingOpen={noop}
      onEdit={noop}
      onMove={noop}
      onMoveProject={noop}
      onDelete={noop}
      onStop={noop}
      onExport={noop}
      onToggleImportant={onToggleImportant}
    />,
  )
  return onToggleImportant
}

describe('MeetingCardGrid 중요/잠금 표시', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 1, email: 'me@x.com', name: '나', role: 'member' } })
  })

  it('중요 별 클릭 시 onToggleImportant가 해당 회의로 호출된다', () => {
    const meeting = makeMeeting({ id: 7, important: false })
    const onToggle = renderGrid([meeting])
    fireEvent.click(screen.getByRole('button', { name: '중요 표시' }))
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }))
  })

  it('잠긴 회의 카드에는 잠금 아이콘이 보이고 중요 별이 비활성화된다', () => {
    renderGrid([makeMeeting({ locked: true, important: true })])
    expect(screen.getByLabelText('잠긴 회의')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '중요 해제' })).toBeDisabled()
  })

  it('예약된 pending 회의는 예약중 배지와 예약 정보 줄을 표시한다', () => {
    renderGrid([
      makeMeeting({
        status: 'pending',
        scheduled_start_time: '2026-03-09T07:05:00',
        auto_start_mode: 'auto',
      }),
    ])
    expect(screen.getByText('예약중')).toBeInTheDocument()
    expect(screen.queryByText('대기중')).not.toBeInTheDocument()
    expect(screen.getByText(/2026\.03\.09 07:05 · 자동/)).toBeInTheDocument()
  })

  it('예약 정보 없는 pending 회의는 대기중 배지를 유지한다', () => {
    renderGrid([makeMeeting({ status: 'pending', scheduled_start_time: null })])
    expect(screen.getByText('대기중')).toBeInTheDocument()
    expect(screen.queryByText('예약중')).not.toBeInTheDocument()
  })
})
