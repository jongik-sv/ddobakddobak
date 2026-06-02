import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EditMeetingDialog from './EditMeetingDialog'
import type { Meeting } from '../../api/meetings'

vi.mock('../../api/tags', () => ({
  getTags: vi.fn().mockResolvedValue([]),
  createTag: vi.fn(),
}))

const meetingTypeList = [
  { value: 'general', label: '일반' },
  { value: 'standup', label: '스탠드업' },
]

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 1,
    title: '회의 제목',
    status: 'completed',
    meeting_type: 'general',
    created_by: { id: 1, name: '사용자1' },
    brief_summary: null,
    folder_id: null,
    audio_duration_ms: 0,
    last_transcript_end_ms: 0,
    last_sequence_number: 0,
    memo: null,
    attendees: null,
    shared: true,
    started_at: null,
    ended_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('EditMeetingDialog 공유 토글', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('공유 토글이 렌더링된다', () => {
    render(
      <EditMeetingDialog
        meeting={makeMeeting()}
        meetingTypeList={meetingTypeList}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/모든 사용자에게 공유/)).toBeInTheDocument()
  })

  it('초기값이 meeting.shared(true)를 반영한다', () => {
    render(
      <EditMeetingDialog
        meeting={makeMeeting({ shared: true })}
        meetingTypeList={meetingTypeList}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const toggle = screen.getByLabelText(/모든 사용자에게 공유/) as HTMLInputElement
    expect(toggle.checked).toBe(true)
  })

  it('초기값이 meeting.shared(false)를 반영한다', () => {
    render(
      <EditMeetingDialog
        meeting={makeMeeting({ shared: false })}
        meetingTypeList={meetingTypeList}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const toggle = screen.getByLabelText(/모든 사용자에게 공유/) as HTMLInputElement
    expect(toggle.checked).toBe(false)
  })

  it('shared가 undefined면 기본 true로 켜진다', () => {
    render(
      <EditMeetingDialog
        meeting={makeMeeting({ shared: undefined as unknown as boolean })}
        meetingTypeList={meetingTypeList}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const toggle = screen.getByLabelText(/모든 사용자에게 공유/) as HTMLInputElement
    expect(toggle.checked).toBe(true)
  })

  it('onConfirm 페이로드에 shared가 포함된다 (토글 끄면 false)', async () => {
    const onConfirm = vi.fn()
    render(
      <EditMeetingDialog
        meeting={makeMeeting({ shared: true })}
        meetingTypeList={meetingTypeList}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByLabelText(/모든 사용자에게 공유/))
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ shared: false }))
  })

  it('onConfirm 페이로드에 shared가 포함된다 (토글 유지하면 true)', async () => {
    const onConfirm = vi.fn()
    render(
      <EditMeetingDialog
        meeting={makeMeeting({ shared: true })}
        meetingTypeList={meetingTypeList}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ shared: true }))
  })
})
