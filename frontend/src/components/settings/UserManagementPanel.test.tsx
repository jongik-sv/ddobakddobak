import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import UserManagementPanel from './UserManagementPanel'
import { useAuthStore } from '../../stores/authStore'
import { getAdminUsers, updateAdminUser, deleteAdminUser } from '../../api/adminUsers'
import type { AdminUser } from '../../api/adminUsers'

vi.mock('../../api/adminUsers', () => ({
  getAdminUsers: vi.fn(),
  updateAdminUser: vi.fn(),
  deleteAdminUser: vi.fn(),
}))

function makeUser(o: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 2,
    email: 'u@x.com',
    name: 'U',
    role: 'admin',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...o,
  }
}

describe('UserManagementPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 본인(id=1)이 아닌 다른 사용자를 대상으로 해야 역할 배지가 잠기지 않는다.
    useAuthStore.setState({ user: { id: 1, email: 'admin@x.com', name: 'Admin', role: 'admin' } } as never)
  })

  it('역할 배지 클릭 시 admin → manager → member → admin 순으로 순환한다', async () => {
    const user = makeUser({ role: 'admin' })
    vi.mocked(getAdminUsers).mockResolvedValue([user])
    vi.mocked(updateAdminUser).mockResolvedValueOnce({ ...user, role: 'manager' })

    render(<UserManagementPanel />)

    const badge = await screen.findByRole('button', { name: '관리자' })
    fireEvent.click(badge)

    await waitFor(() =>
      expect(updateAdminUser).toHaveBeenCalledWith(user.id, { role: 'manager' }),
    )
  })

  it('manager 역할은 클릭 시 member로 전환된다', async () => {
    const user = makeUser({ role: 'manager' })
    vi.mocked(getAdminUsers).mockResolvedValue([user])
    vi.mocked(updateAdminUser).mockResolvedValueOnce({ ...user, role: 'member' })

    render(<UserManagementPanel />)

    const badge = await screen.findByRole('button', { name: '매니저' })
    fireEvent.click(badge)

    await waitFor(() =>
      expect(updateAdminUser).toHaveBeenCalledWith(user.id, { role: 'member' }),
    )
  })

  it('member 역할은 클릭 시 admin으로 전환된다', async () => {
    const user = makeUser({ role: 'member' })
    vi.mocked(getAdminUsers).mockResolvedValue([user])
    vi.mocked(updateAdminUser).mockResolvedValueOnce({ ...user, role: 'admin' })

    render(<UserManagementPanel />)

    const badge = await screen.findByRole('button', { name: '멤버' })
    fireEvent.click(badge)

    await waitFor(() =>
      expect(updateAdminUser).toHaveBeenCalledWith(user.id, { role: 'admin' }),
    )
  })

  it('삭제 확인 시 이관 대상 파라미터 없이 deleteAdminUser를 호출한다(이관은 백엔드 자동 처리)', async () => {
    const admin = makeUser({ id: 1, name: 'Admin', email: 'admin@x.com', role: 'admin' })
    const target = makeUser({ id: 2, name: 'Target', email: 'target@x.com', role: 'member' })
    vi.mocked(getAdminUsers).mockResolvedValue([admin, target])
    vi.mocked(deleteAdminUser).mockResolvedValue(undefined)

    render(<UserManagementPanel />)
    await screen.findByText('Target')

    const row = screen.getByText('Target').closest('tr')
    if (!row) throw new Error('row not found')
    fireEvent.click(within(row).getByTitle('사용자 삭제'))

    // 이관 안내 문구만 노출되고 셀렉트는 없음 — 삭제 버튼만 클릭.
    expect(await screen.findByText(/관리자\(desktop@local\) 계정으로 이관/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '삭제' }))

    await waitFor(() => expect(deleteAdminUser).toHaveBeenCalledWith(target.id))
  })
})

describe('UserManagementPanel — 표 정렬·필터', () => {
  const users = [
    makeUser({ id: 10, name: '하나', email: 'hana@x.com', role: 'member', created_at: '2026-03-10T12:00:00' }),
    makeUser({ id: 11, name: '가나', email: 'gana@x.com', role: 'admin', created_at: '2026-01-10T12:00:00' }),
    makeUser({ id: 12, name: 'Alice', email: 'alice@y.com', role: 'manager', created_at: '2026-02-10T12:00:00' }),
    makeUser({ id: 13, name: '', email: 'noname@x.com', role: 'member', created_at: '2026-04-10T12:00:00' }),
  ]
  const bodyEmails = () =>
    screen.getAllByRole('row').slice(2).map((r) => within(r).queryAllByRole('cell')[1]?.textContent)

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    useAuthStore.setState({ user: { id: 1, email: 'admin@x.com', name: 'Admin', role: 'admin' } } as never)
    vi.mocked(getAdminUsers).mockResolvedValue(users)
  })

  const header = (name: string) => screen.getByRole('button', { name })
  const th = (name: string) => header(name).closest('th')!

  it('기본: 이름 오름차순(한글 우선, 빈 이름 마지막)과 aria-sort', async () => {
    render(<UserManagementPanel />)
    await screen.findByText('하나')
    expect(bodyEmails()).toEqual(['gana@x.com', 'hana@x.com', 'alice@y.com', 'noname@x.com'])
    expect(th('이름')).toHaveAttribute('aria-sort', 'ascending')
    expect(th('이메일')).toHaveAttribute('aria-sort', 'none')
    expect(screen.getByText('4명 / 전체 4명')).toBeInTheDocument()
  })

  it('컬럼 헤더 클릭: asc → desc → 기본 순환', async () => {
    render(<UserManagementPanel />)
    await screen.findByText('하나')
    fireEvent.click(header('이메일'))
    expect(bodyEmails()).toEqual(['alice@y.com', 'gana@x.com', 'hana@x.com', 'noname@x.com'])
    expect(th('이메일')).toHaveAttribute('aria-sort', 'ascending')
    fireEvent.click(header('이메일'))
    expect(bodyEmails()).toEqual(['noname@x.com', 'hana@x.com', 'gana@x.com', 'alice@y.com'])
    fireEvent.click(header('이메일'))
    expect(th('이름')).toHaveAttribute('aria-sort', 'ascending')
    expect(bodyEmails()[0]).toBe('gana@x.com')
  })

  it('역할 정렬은 관리자→매니저→멤버, 생성일 정렬은 날짜순', async () => {
    render(<UserManagementPanel />)
    await screen.findByText('하나')
    fireEvent.click(header('역할'))
    expect(bodyEmails().slice(0, 2)).toEqual(['gana@x.com', 'alice@y.com'])
    fireEvent.click(header('생성일'))
    expect(bodyEmails()).toEqual(['gana@x.com', 'alice@y.com', 'hana@x.com', 'noname@x.com'])
    fireEvent.click(header('생성일'))
    expect(bodyEmails()[0]).toBe('noname@x.com')
  })

  it('이름·이메일 텍스트 필터, 역할 select, 생성일 기간 필터와 건수', async () => {
    render(<UserManagementPanel />)
    await screen.findByText('하나')
    fireEvent.change(screen.getByLabelText('이름 필터'), { target: { value: ' ali ' } })
    expect(bodyEmails()).toEqual(['alice@y.com'])
    expect(screen.getByText('1명 / 전체 4명')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('이름 필터'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('이메일 필터'), { target: { value: 'X.COM' } })
    expect(bodyEmails()).toEqual(['gana@x.com', 'hana@x.com', 'noname@x.com'])
    fireEvent.change(screen.getByLabelText('역할 필터'), { target: { value: 'member' } })
    expect(bodyEmails()).toEqual(['hana@x.com', 'noname@x.com'])
    fireEvent.change(screen.getByLabelText('생성일 시작일'), { target: { value: '2026-04-01' } })
    expect(bodyEmails()).toEqual(['noname@x.com'])
    fireEvent.change(screen.getByLabelText('생성일 종료일'), { target: { value: '2026-03-01' } })
    expect(screen.getByText('조건에 맞는 사용자가 없습니다.')).toBeInTheDocument()
    expect(screen.getByText('0명 / 전체 4명')).toBeInTheDocument()
  })

  it('필터 초기화는 모든 필터를 지운다', async () => {
    render(<UserManagementPanel />)
    await screen.findByText('하나')
    expect(screen.getByRole('button', { name: '필터 초기화' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('역할 필터'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByRole('button', { name: '필터 초기화' }))
    expect(screen.getByText('4명 / 전체 4명')).toBeInTheDocument()
    expect(screen.getByLabelText('역할 필터')).toHaveValue('')
  })

  it('역할 변경 후에도 정렬·필터된 행이 갱신되어 보인다', async () => {
    vi.mocked(updateAdminUser).mockResolvedValueOnce({ ...users[0], role: 'admin' })
    render(<UserManagementPanel />)
    await screen.findByText('하나')
    fireEvent.change(screen.getByLabelText('이름 필터'), { target: { value: '하나' } })
    fireEvent.click(screen.getByRole('button', { name: '멤버' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '관리자' })).toBeInTheDocument())
    expect(bodyEmails()).toEqual(['hana@x.com'])
  })

  it('정렬·필터를 localStorage 에 기억하고 복원한다', async () => {
    const { unmount } = render(<UserManagementPanel />)
    await screen.findByText('하나')
    fireEvent.click(header('이메일'))
    fireEvent.change(screen.getByLabelText('이메일 필터'), { target: { value: 'x.com' } })
    unmount()
    render(<UserManagementPanel />)
    await screen.findByText('하나')
    expect(th('이메일')).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByLabelText('이메일 필터')).toHaveValue('x.com')
    expect(JSON.parse(localStorage.getItem('ddobak.userMgmt.view')!).sort).toEqual({ key: 'email', dir: 'asc' })
  })
})
