import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ProjectMembersPanel from './ProjectMembersPanel'
import { useAuthStore } from '../../stores/authStore'
import {
  getProjectMembers,
  getProjectInvites,
  addProjectMember,
  updateProjectMember,
} from '../../api/projects'
import { confirmDialog } from '../../lib/confirmDialog'
import type { Project, ProjectMember } from '../../api/projects'

vi.mock('../../api/projects', () => ({
  getProjectMembers: vi.fn(),
  getProjectInvites: vi.fn(),
  addProjectMember: vi.fn(),
  updateProjectMember: vi.fn(),
  removeProjectMember: vi.fn(),
  createProjectInvite: vi.fn(),
  revokeProjectInvite: vi.fn(),
}))
vi.mock('../../lib/shareUrl', () => ({ getShareBaseUrl: vi.fn().mockResolvedValue('http://share.test') }))
vi.mock('../../lib/confirmDialog', () => ({ confirmDialog: vi.fn() }))

function makeProject(o: Partial<Project> = {}): Project {
  return {
    id: 1, name: '팀A', description: null, icon_type: null, icon_value: null,
    color: null, personal: false, role: 'admin', member_count: 2, meeting_count: 0, owner: null, favorite: false, ...o,
  }
}

function makeMember(o: Partial<ProjectMember> = {}): ProjectMember {
  return { user_id: 2, name: 'Bob', email: 'b@x.com', role: 'member', ...o }
}

function setUser(role: 'admin' | 'manager' | 'member', id = 1) {
  useAuthStore.setState({ user: { id, email: 'me@x.com', name: 'Me', role } } as never)
}

describe('ProjectMembersPanel — 역할 위임', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getProjectInvites).mockResolvedValue([])
  })

  it('시스템 member는 위임 버튼이 보이지 않는다', async () => {
    setUser('member')
    vi.mocked(getProjectMembers).mockResolvedValue([makeMember()])
    render(<ProjectMembersPanel project={makeProject({ role: 'admin' })} onClose={() => {}} />)
    await screen.findByText('Bob')
    expect(screen.queryByText('관리자로 위임')).not.toBeInTheDocument()
    expect(screen.queryByText('멤버로 변경')).not.toBeInTheDocument()
  })

  it('manager이지만 이 프로젝트의 관리자가 아니면 위임 버튼이 보이지 않는다', async () => {
    setUser('manager')
    vi.mocked(getProjectMembers).mockResolvedValue([makeMember()])
    render(<ProjectMembersPanel project={makeProject({ role: 'member' })} onClose={() => {}} />)
    await screen.findByText('Bob')
    expect(screen.queryByText('관리자로 위임')).not.toBeInTheDocument()
  })

  it('manager + 이 프로젝트의 관리자면 위임 가능 — 클릭 시 API 호출 및 배지 갱신', async () => {
    setUser('manager')
    vi.mocked(getProjectMembers).mockResolvedValue([makeMember({ role: 'member' })])
    vi.mocked(updateProjectMember).mockResolvedValue(makeMember({ role: 'admin' }))
    render(<ProjectMembersPanel project={makeProject({ role: 'admin' })} onClose={() => {}} />)
    const btn = await screen.findByText('관리자로 위임')
    fireEvent.click(btn)
    await waitFor(() => expect(updateProjectMember).toHaveBeenCalledWith(1, 2, 'admin'))
    await waitFor(() => expect(screen.getByText('멤버로 변경')).toBeInTheDocument())
  })

  it('본인 강등 확인을 거부하면 API를 호출하지 않는다', async () => {
    setUser('admin', 1)
    vi.mocked(getProjectMembers).mockResolvedValue([
      makeMember({ user_id: 1, name: 'Me', email: 'me@x.com', role: 'admin' }),
    ])
    vi.mocked(confirmDialog).mockResolvedValue(false)
    render(<ProjectMembersPanel project={makeProject({ role: 'admin' })} onClose={() => {}} />)
    const btn = await screen.findByText('멤버로 변경')
    fireEvent.click(btn)
    await waitFor(() => expect(confirmDialog).toHaveBeenCalled())
    expect(updateProjectMember).not.toHaveBeenCalled()
  })

  it('본인 강등 확인을 수락하면 API를 호출한다', async () => {
    setUser('admin', 1)
    vi.mocked(getProjectMembers).mockResolvedValue([
      makeMember({ user_id: 1, name: 'Me', email: 'me@x.com', role: 'admin' }),
    ])
    vi.mocked(confirmDialog).mockResolvedValue(true)
    vi.mocked(updateProjectMember).mockResolvedValue(
      makeMember({ user_id: 1, name: 'Me', email: 'me@x.com', role: 'member' }),
    )
    render(<ProjectMembersPanel project={makeProject({ role: 'admin' })} onClose={() => {}} />)
    const btn = await screen.findByText('멤버로 변경')
    fireEvent.click(btn)
    await waitFor(() => expect(updateProjectMember).toHaveBeenCalledWith(1, 1, 'member'))
  })
})

describe('ProjectMembersPanel — 멤버 추가 시 역할 선택', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getProjectMembers).mockResolvedValue([])
    vi.mocked(getProjectInvites).mockResolvedValue([])
  })

  it('역할을 관리자로 선택해 추가하면 API에 role이 전달된다', async () => {
    setUser('admin')
    vi.mocked(addProjectMember).mockResolvedValue({ member: makeMember({ role: 'admin' }) })
    render(<ProjectMembersPanel project={makeProject({ role: 'admin' })} onClose={() => {}} />)

    const input = await screen.findByPlaceholderText('이름 또는 이메일')
    fireEvent.change(input, { target: { value: 'new@x.com' } })
    fireEvent.change(screen.getByLabelText('추가할 역할'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByText('추가'))

    await waitFor(() =>
      expect(addProjectMember).toHaveBeenCalledWith(1, { email: 'new@x.com', role: 'admin' }),
    )
  })
})

describe('ProjectMembersPanel — 표 정렬·필터', () => {
  const members = [
    makeMember({ user_id: 2, name: '하나', email: 'hana@x.com', role: 'member' }),
    makeMember({ user_id: 3, name: '가나', email: 'gana@x.com', role: 'admin' }),
    makeMember({ user_id: 4, name: 'Alice', email: 'alice@y.com', role: 'member' }),
  ]
  const emails = () =>
    screen.getAllByRole('row').slice(2).map((r) => r.querySelectorAll('td')[1]?.textContent)

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.mocked(getProjectInvites).mockResolvedValue([])
    vi.mocked(getProjectMembers).mockResolvedValue(members)
    setUser('admin')
  })

  it('기본 이름 오름차순, 헤더 클릭 순환, aria-sort', async () => {
    render(<ProjectMembersPanel project={makeProject()} onClose={() => {}} />)
    await screen.findByText('하나')
    expect(emails()).toEqual(['gana@x.com', 'hana@x.com', 'alice@y.com'])
    const btn = screen.getByRole('button', { name: '이메일' })
    fireEvent.click(btn)
    expect(emails()).toEqual(['alice@y.com', 'gana@x.com', 'hana@x.com'])
    expect(btn.closest('th')).toHaveAttribute('aria-sort', 'ascending')
    fireEvent.click(btn)
    expect(emails()).toEqual(['hana@x.com', 'gana@x.com', 'alice@y.com'])
    fireEvent.click(btn)
    expect(emails()[0]).toBe('gana@x.com')
  })

  it('필터·건수·초기화·빈 결과', async () => {
    render(<ProjectMembersPanel project={makeProject()} onClose={() => {}} />)
    await screen.findByText('하나')
    expect(screen.getByText('3명 / 전체 3명')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('역할 필터'), { target: { value: 'member' } })
    expect(emails()).toEqual(['hana@x.com', 'alice@y.com'])
    fireEvent.change(screen.getByLabelText('이름 필터'), { target: { value: 'zzz' } })
    expect(screen.getByText('조건에 맞는 사용자가 없습니다.')).toBeInTheDocument()
    expect(screen.getByText('0명 / 전체 3명')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '필터 초기화' }))
    expect(screen.getByText('3명 / 전체 3명')).toBeInTheDocument()
  })

  it('역할 변경 후 필터된 표가 갱신되고 행이 유지된다', async () => {
    vi.mocked(updateProjectMember).mockResolvedValueOnce({ ...members[0], role: 'admin' })
    render(<ProjectMembersPanel project={makeProject()} onClose={() => {}} />)
    await screen.findByText('하나')
    fireEvent.change(screen.getByLabelText('이름 필터'), { target: { value: '하나' } })
    fireEvent.click(screen.getByText('관리자로 위임'))
    await screen.findByText('멤버로 변경')
    expect(emails()).toEqual(['hana@x.com'])
  })
})
