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
