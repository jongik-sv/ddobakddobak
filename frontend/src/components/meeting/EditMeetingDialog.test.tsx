import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EditMeetingDialog from './EditMeetingDialog'
import type { Meeting } from '../../api/meetings'
import { useAuthStore } from '../../stores/authStore'
import { useProjectStore } from '../../stores/projectStore'
import type { Project } from '../../api/projects'

vi.mock('../../api/tags', () => ({
  getTags: vi.fn().mockResolvedValue([]),
  createTag: vi.fn(),
}))

const { mockUpdateMeetingOwner, mockGetProjectMembers } = vi.hoisted(() => ({
  mockUpdateMeetingOwner: vi.fn(),
  mockGetProjectMembers: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../api/meetings', async () => {
  const actual = await vi.importActual<typeof import('../../api/meetings')>('../../api/meetings')
  return {
    ...actual,
    getMeetings: vi.fn().mockResolvedValue({ meetings: [] }),
    updateMeetingOwner: mockUpdateMeetingOwner,
  }
})

vi.mock('../../api/projects', () => ({
  getProjectMembers: mockGetProjectMembers,
}))

vi.mock('../../api/domainFiles', () => ({
  getMeetingDomainFiles: vi.fn(async () => ({ selected: [], inherited: [], excluded: [] })),
  listDomainFiles: vi.fn(async () => ({ domain_files: [] })),
  setMeetingDomainFiles: vi.fn(),
  getFolderDomainFiles: vi.fn(async () => ({ domain_files: [], inherited: [] })),
  setFolderDomainFiles: vi.fn(),
  getProjectDomainFiles: vi.fn(async () => ({ domain_files: [] })),
  setProjectDomainFiles: vi.fn(),
  createDomainFile: vi.fn(),
  uploadDomainFile: vi.fn(),
  updateDomainFile: vi.fn(),
  deleteDomainFile: vi.fn(),
  mergeDomainTerms: vi.fn(),
  extractDomainTerms: vi.fn(),
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

function makeProject(o: Partial<Project> = {}): Project {
  return {
    id: 7, name: 'P', description: null, icon_type: null, icon_value: null,
    color: null, personal: false, role: 'member', member_count: 2, meeting_count: 0, owner: null, ...o,
  }
}

describe('EditMeetingDialog 참석자/참여 인원 필드 제거', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('참석자, 참여 인원 입력 필드를 더 이상 렌더링하지 않는다', () => {
    render(
      <EditMeetingDialog
        meeting={makeMeeting()}
        meetingTypeList={meetingTypeList}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByText('참석자')).not.toBeInTheDocument()
    expect(screen.queryByText('참여 인원')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('비우면 자동 감지')).not.toBeInTheDocument()
  })

  it('저장 payload에 attendees/expected_participants를 포함하지 않는다', async () => {
    const onConfirm = vi.fn()
    render(
      <EditMeetingDialog
        meeting={makeMeeting({ attendees: '홍길동', expected_participants: 3 })}
        meetingTypeList={meetingTypeList}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    const arg = onConfirm.mock.calls[0][0]
    expect(arg).not.toHaveProperty('attendees')
    expect(arg).not.toHaveProperty('expected_participants')
  })
})

describe('EditMeetingDialog 도메인 파일', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('도메인 파일 섹션을 렌더링한다', () => {
    render(
      <EditMeetingDialog
        meeting={makeMeeting({ project_id: 7 })}
        meetingTypeList={meetingTypeList}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('도메인 파일')).toBeInTheDocument()
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

describe('EditMeetingDialog 소유자 이관', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProjectMembers.mockResolvedValue([])
    useAuthStore.setState({ user: null })
    useProjectStore.setState({ projects: [] } as never)
  })

  it('소유자 본인도 아니고 admin/manager도 아니면 소유자 셀렉트가 보이지 않는다', () => {
    useAuthStore.setState({ user: { id: 2, email: 'm@x.com', name: 'M', role: 'member' } } as never)
    render(
      <EditMeetingDialog
        meeting={makeMeeting({ project_id: 7, created_by: { id: 1, name: 'Owner' } })}
        meetingTypeList={meetingTypeList}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByRole('combobox', { name: '소유자' })).not.toBeInTheDocument()
  })

  it('manager이지만 이 회의 프로젝트의 관리자가 아니면 보이지 않는다', () => {
    useAuthStore.setState({ user: { id: 2, email: 'mg@x.com', name: 'Mg', role: 'manager' } } as never)
    useProjectStore.setState({ projects: [makeProject({ role: 'member' })] } as never)
    render(
      <EditMeetingDialog
        meeting={makeMeeting({ project_id: 7, created_by: { id: 1, name: 'Owner' } })}
        meetingTypeList={meetingTypeList}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByRole('combobox', { name: '소유자' })).not.toBeInTheDocument()
  })

  it('현재 소유자 본인이면 보인다', async () => {
    useAuthStore.setState({ user: { id: 1, email: 'o@x.com', name: 'Owner', role: 'member' } } as never)
    render(
      <EditMeetingDialog
        meeting={makeMeeting({ project_id: 7, created_by: { id: 1, name: 'Owner' } })}
        meetingTypeList={meetingTypeList}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(await screen.findByRole('combobox', { name: '소유자' })).toBeInTheDocument()
  })

  it('manager + 이 회의 프로젝트의 관리자면 보인다', async () => {
    useAuthStore.setState({ user: { id: 2, email: 'mg@x.com', name: 'Mg', role: 'manager' } } as never)
    useProjectStore.setState({ projects: [makeProject({ role: 'admin' })] } as never)
    render(
      <EditMeetingDialog
        meeting={makeMeeting({ project_id: 7, created_by: { id: 1, name: 'Owner' } })}
        meetingTypeList={meetingTypeList}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(await screen.findByRole('combobox', { name: '소유자' })).toBeInTheDocument()
  })

  it('소유자를 변경하고 저장하면 updateMeetingOwner가 호출된다', async () => {
    mockGetProjectMembers.mockResolvedValue([
      { user_id: 1, name: 'Owner', email: 'o@x.com', role: 'admin' },
      { user_id: 2, name: 'Other', email: 'other@x.com', role: 'member' },
    ])
    mockUpdateMeetingOwner.mockResolvedValue(makeMeeting())
    useAuthStore.setState({ user: { id: 1, email: 'o@x.com', name: 'Owner', role: 'admin' } } as never)
    const onConfirm = vi.fn()
    render(
      <EditMeetingDialog
        meeting={makeMeeting({ id: 42, project_id: 7, created_by: { id: 1, name: 'Owner' } })}
        meetingTypeList={meetingTypeList}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )
    const select = await screen.findByRole('combobox', { name: '소유자' })
    fireEvent.change(select, { target: { value: '2' } })
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(mockUpdateMeetingOwner).toHaveBeenCalledWith(42, 2))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('소유자를 바꾸지 않고 저장하면 updateMeetingOwner를 호출하지 않는다', async () => {
    mockGetProjectMembers.mockResolvedValue([
      { user_id: 1, name: 'Owner', email: 'o@x.com', role: 'admin' },
    ])
    useAuthStore.setState({ user: { id: 1, email: 'o@x.com', name: 'Owner', role: 'admin' } } as never)
    const onConfirm = vi.fn()
    render(
      <EditMeetingDialog
        meeting={makeMeeting({ id: 42, project_id: 7, created_by: { id: 1, name: 'Owner' } })}
        meetingTypeList={meetingTypeList}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )
    await screen.findByRole('combobox', { name: '소유자' })
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalled())
    expect(mockUpdateMeetingOwner).not.toHaveBeenCalled()
  })
})
