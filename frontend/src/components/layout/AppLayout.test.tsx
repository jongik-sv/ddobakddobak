import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { mockUseAuthStore } = vi.hoisted(() => ({
  mockUseAuthStore: vi.fn(),
}))

vi.mock('../../stores/authStore', () => ({
  useAuthStore: mockUseAuthStore,
}))

import AppLayout from './AppLayout'

describe('AppLayout', () => {
  beforeEach(() => {
    mockUseAuthStore.mockImplementation((selector: (s: { user: { name: string; email: string } | null; logout: () => void }) => unknown) =>
      selector({ user: { name: '테스트 유저', email: 'test@example.com' }, logout: vi.fn() })
    )
  })

  it('children이 렌더링됨', () => {
    render(
      <MemoryRouter>
        <AppLayout>
          <div>메인 콘텐츠</div>
        </AppLayout>
      </MemoryRouter>
    )
    expect(screen.getByText('메인 콘텐츠')).toBeInTheDocument()
  })

  it('사이드바가 렌더링됨', () => {
    render(
      <MemoryRouter>
        <AppLayout>
          <div>콘텐츠</div>
        </AppLayout>
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: /대시보드/i })).toBeInTheDocument()
  })

  it('헤더가 렌더링됨', () => {
    render(
      <MemoryRouter>
        <AppLayout>
          <div>콘텐츠</div>
        </AppLayout>
      </MemoryRouter>
    )
    expect(screen.getByRole('button', { name: /로그아웃/i })).toBeInTheDocument()
  })

  it('사용자 이름이 헤더에 표시됨', () => {
    render(
      <MemoryRouter>
        <AppLayout>
          <div>콘텐츠</div>
        </AppLayout>
      </MemoryRouter>
    )
    expect(screen.getByText('테스트 유저')).toBeInTheDocument()
  })
})
