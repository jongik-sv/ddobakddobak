import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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
    locked: false,
    locked_at: null,
    important: false,
    started_at: null,
    ended_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('EditMeetingDialog 참여 인원', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('참여 인원을 입력하면 onConfirm에 expected_participants로 전달한다', async () => {
    const onConfirm = vi.fn()
    render(
      <EditMeetingDialog
        meeting={makeMeeting()}
        meetingTypeList={meetingTypeList}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )

    const input = screen.getByPlaceholderText('비우면 자동 감지')
    await userEvent.clear(input)
    await userEvent.type(input, '5')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ expected_participants: 5 }))
  })

  it('비우면 null로 전달한다', async () => {
    const onConfirm = vi.fn()
    render(
      <EditMeetingDialog
        meeting={makeMeeting({ expected_participants: 3 })}
        meetingTypeList={meetingTypeList}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )

    const input = screen.getByPlaceholderText('비우면 자동 감지')
    await userEvent.clear(input)
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ expected_participants: null }))
  })
})

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

describe('EditMeetingDialog 예약 수정', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('비pending(completed) 회의는 예약 섹션을 노출하지 않는다', () => {
    render(
      <EditMeetingDialog
        meeting={makeMeeting({ status: 'completed' })}
        meetingTypeList={meetingTypeList}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('예약 시작')).not.toBeInTheDocument()
  })

  it('비pending 회의 저장 시 예약 키(트리플)를 포함하지 않는다', async () => {
    const onConfirm = vi.fn()
    render(
      <EditMeetingDialog
        meeting={makeMeeting({ status: 'completed' })}
        meetingTypeList={meetingTypeList}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    const arg = onConfirm.mock.calls[0][0]
    expect(arg).not.toHaveProperty('scheduled_start_time')
    expect(arg).not.toHaveProperty('auto_start_mode')
    expect(arg).not.toHaveProperty('recurrence_rule')
  })

  it('pending 회의는 예약 섹션을 노출하고 기존 예약 상태를 복원한다', () => {
    const iso = new Date('2026-06-25T10:00').toISOString()
    render(
      <EditMeetingDialog
        meeting={makeMeeting({ status: 'pending', scheduled_start_time: iso, auto_start_mode: 'auto' })}
        meetingTypeList={meetingTypeList}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const toggle = screen.getByLabelText('예약 시작') as HTMLInputElement
    expect(toggle.checked).toBe(true)
    expect((screen.getByLabelText('예약 날짜') as HTMLInputElement).value).toBe('2026-06-25')
    expect((screen.getByLabelText('자동') as HTMLInputElement).checked).toBe(true)
  })

  it('pending 예약 회의의 예약 토글을 끄고 저장하면 트리플 전부 null(해제)을 전달한다', async () => {
    const onConfirm = vi.fn()
    const iso = new Date('2026-06-25T10:00').toISOString()
    render(
      <EditMeetingDialog
        meeting={makeMeeting({ status: 'pending', scheduled_start_time: iso, auto_start_mode: 'auto' })}
        meetingTypeList={meetingTypeList}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByLabelText('예약 시작')) // OFF
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    const arg = onConfirm.mock.calls[0][0]
    expect(arg.scheduled_start_time).toBeNull()
    expect(arg.auto_start_mode).toBeNull()
    expect(arg.recurrence_rule).toBeNull()
  })

  it('pending 회의에 예약을 새로 켜고 저장하면 scheduled_start_time+auto_start_mode를 전달한다', async () => {
    const onConfirm = vi.fn()
    render(
      <EditMeetingDialog
        meeting={makeMeeting({ status: 'pending' })}
        meetingTypeList={meetingTypeList}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByLabelText('예약 시작')) // ON → 날짜 오늘 기본
    fireEvent.change(screen.getByLabelText('예약 날짜'), { target: { value: '2026-06-30' } })
    fireEvent.change(screen.getByLabelText('시'), { target: { value: '14' } })
    fireEvent.change(screen.getByLabelText('분'), { target: { value: '15' } })
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    const arg = onConfirm.mock.calls[0][0]
    expect(arg.scheduled_start_time).toBe(new Date('2026-06-30T14:15').toISOString())
    expect(arg.auto_start_mode).toBe('manual')
    expect(arg.recurrence_rule).toBeNull()
  })
})
