import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

// ── Mocks ──
const { mockLogin, mockLogout, mockUseAuth } = vi.hoisted(() => ({
  mockLogin: vi.fn(),
  mockLogout: vi.fn(),
  mockUseAuth: vi.fn(),
}))

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: mockUseAuth,
}))

import { LoginPage } from '../LoginPage'

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('로딩 상태', () => {
    it('isLoading이 true일 때 로딩 스피너를 표시한다', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: true,
        login: mockLogin,
        logout: mockLogout,
      })

      render(<LoginPage />)
      expect(screen.getByText('인증 확인 중...')).toBeInTheDocument()
    })

    it('isLoading이 true일 때 로그인 버튼이 표시되지 않는다', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: true,
        login: mockLogin,
        logout: mockLogout,
      })

      render(<LoginPage />)
      expect(screen.queryByText('브라우저에서 로그인')).not.toBeInTheDocument()
    })
  })

  describe('로그인 화면', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
        login: mockLogin,
        logout: mockLogout,
      })
    })

    it('타이틀을 표시한다', () => {
      render(<LoginPage />)
      expect(screen.getByText('또박또박')).toBeInTheDocument()
    })

    it('로그인 안내 메시지를 표시한다', () => {
      render(<LoginPage />)
      expect(screen.getByText(/로그인이 필요합니다/)).toBeInTheDocument()
    })

    it('로그인 버튼을 표시한다', () => {
      render(<LoginPage />)
      expect(
        screen.getByRole('button', { name: /브라우저에서 로그인/ }),
      ).toBeInTheDocument()
    })

    it('로그인 버튼 클릭 시 login()을 호출한다', async () => {
      render(<LoginPage />)

      const loginButton = screen.getByRole('button', {
        name: /브라우저에서 로그인/,
      })
      await act(async () => {
        fireEvent.click(loginButton)
      })

      expect(mockLogin).toHaveBeenCalledTimes(1)
    })

    it('안내 텍스트를 표시한다', () => {
      render(<LoginPage />)
      expect(
        screen.getByText(/기본 브라우저에서 로그인 페이지가 열립니다/),
      ).toBeInTheDocument()
    })
  })
})
