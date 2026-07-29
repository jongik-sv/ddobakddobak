import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MeetingListTable } from './MeetingListTable'
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

function renderTable(meetings: Meeting[], onToggleImportant = vi.fn()) {
  render(
    <MeetingListTable
      childFolders={[]}
      meetings={meetings}
      searchQuery=""
      folders={[]}
      isDesktop
      meetingTypeMap={{}}
      sortField="created_at"
      sortDirection="desc"
      onSort={noop}
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

describe('MeetingListTable 중요/잠금 표시', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 1, email: 'me@x.com', name: '나', role: 'member' } })
  })

  it('중요 별 클릭 시 onToggleImportant가 해당 회의로 호출된다', () => {
    const meeting = makeMeeting({ id: 7, important: false })
    const onToggle = renderTable([meeting])
    fireEvent.click(screen.getByRole('button', { name: '중요 표시' }))
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }))
  })

  it('잠긴 회의 行에는 잠금 아이콘이 보이고 중요 별이 비활성화된다', () => {
    renderTable([makeMeeting({ locked: true, important: true })])
    expect(screen.getByLabelText('잠긴 회의')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '중요 해제' })).toBeDisabled()
  })

  it('D\'Flow 미전송 회의는 배지가 없다', () => {
    renderTable([makeMeeting({})])
    expect(screen.queryByText(/D'Flow/)).not.toBeInTheDocument()
  })

  it('D\'Flow 전송된 회의는 "D\'Flow ✓" 배지를 표시한다', () => {
    renderTable([makeMeeting({ dflow_synced_at: '2026-03-25T12:00:00Z', dflow_needs_resync: false })])
    expect(screen.getByText("D'Flow ✓")).toBeInTheDocument()
  })

  it('D\'Flow 재전송 필요 회의는 "D\'Flow 재전송 필요" 배지를 표시한다', () => {
    renderTable([makeMeeting({ dflow_synced_at: '2026-03-25T12:00:00Z', dflow_needs_resync: true })])
    expect(screen.getByText("D'Flow 재전송 필요")).toBeInTheDocument()
    expect(screen.queryByText("D'Flow ✓")).not.toBeInTheDocument()
  })
})
