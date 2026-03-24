import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const { mockLogout, mockUseAuthStore } = vi.hoisted(() => ({
  mockLogout: vi.fn(),
  mockUseAuthStore: vi.fn(),
}))

vi.mock('../../stores/authStore', () => ({
  useAuthStore: mockUseAuthStore,
}))

import Header from './Header'

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuthStore.mockImplementation((selector: (s: { user: { name: string; email: string } | null; logout: () => void }) => unknown) =>
      selector({ user: { name: '테스트 유저', email: 'test@example.com' }, logout: mockLogout })
    )
  })

  it('사용자 이름이 표시됨', () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    )
    expect(screen.getByText('테스트 유저')).toBeInTheDocument()
  })

  it('로그아웃 버튼이 렌더링됨', () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    )
    expect(screen.getByRole('button', { name: /로그아웃/i })).toBeInTheDocument()
  })

  it('로그아웃 버튼 클릭 시 logout()이 호출됨', async () => {
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    )
    await userEvent.click(screen.getByRole('button', { name: /로그아웃/i }))
    expect(mockLogout).toHaveBeenCalledTimes(1)
  })

  it('user가 null일 때 크래시 없이 렌더링됨', () => {
    mockUseAuthStore.mockImplementation((selector: (s: { user: null; logout: () => void }) => unknown) =>
      selector({ user: null, logout: mockLogout })
    )
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    )
    expect(screen.getByRole('button', { name: /로그아웃/i })).toBeInTheDocument()
  })
})
