import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// ── Mocks ──
const { mockUseAuth, mockGetMode } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockGetMode: vi.fn(),
}))

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: mockUseAuth,
}))

vi.mock('../../../config', () => ({
  getMode: mockGetMode,
}))

// LoginPage를 단순한 컴포넌트로 모킹 (useAuth 호출 방지)
vi.mock('../LoginPage', () => ({
  LoginPage: () => <div data-testid="login-page">LoginPage</div>,
}))

import { AuthGuard } from '../AuthGuard'

describe('AuthGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('로컬 모드', () => {
    it('children을 그대로 렌더링한다', () => {
      mockGetMode.mockReturnValue('local')
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
      })

      render(
        <AuthGuard>
          <div data-testid="child">메인 콘텐츠</div>
        </AuthGuard>,
      )

      expect(screen.getByTestId('child')).toBeInTheDocument()
      expect(screen.getByText('메인 콘텐츠')).toBeInTheDocument()
    })

    it('인증 상태와 관계없이 children을 렌더링한다', () => {
      mockGetMode.mockReturnValue('local')
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: true,
      })

      render(
        <AuthGuard>
          <div data-testid="child">메인 콘텐츠</div>
        </AuthGuard>,
      )

      expect(screen.getByTestId('child')).toBeInTheDocument()
    })

    it('LoginPage를 표시하지 않는다', () => {
      mockGetMode.mockReturnValue('local')
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
      })

      render(
        <AuthGuard>
          <div>메인 콘텐츠</div>
        </AuthGuard>,
      )

      expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
    })
  })

  describe('서버 모드 + 인증됨', () => {
    it('children을 렌더링한다', () => {
      mockGetMode.mockReturnValue('server')
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        isLoading: false,
      })

      render(
        <AuthGuard>
          <div data-testid="child">메인 콘텐츠</div>
        </AuthGuard>,
      )

      expect(screen.getByTestId('child')).toBeInTheDocument()
      expect(screen.getByText('메인 콘텐츠')).toBeInTheDocument()
    })

    it('LoginPage를 표시하지 않는다', () => {
      mockGetMode.mockReturnValue('server')
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        isLoading: false,
      })

      render(
        <AuthGuard>
          <div>메인 콘텐츠</div>
        </AuthGuard>,
      )

      expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
    })
  })

  describe('서버 모드 + 미인증', () => {
    it('LoginPage를 표시한다', () => {
      mockGetMode.mockReturnValue('server')
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
      })

      render(
        <AuthGuard>
          <div data-testid="child">메인 콘텐츠</div>
        </AuthGuard>,
      )

      expect(screen.getByTestId('login-page')).toBeInTheDocument()
    })

    it('children을 렌더링하지 않는다', () => {
      mockGetMode.mockReturnValue('server')
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
      })

      render(
        <AuthGuard>
          <div data-testid="child">메인 콘텐츠</div>
        </AuthGuard>,
      )

      expect(screen.queryByTestId('child')).not.toBeInTheDocument()
    })
  })

  describe('서버 모드 + 로딩 중', () => {
    it('로딩 표시를 렌더링한다', () => {
      mockGetMode.mockReturnValue('server')
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: true,
      })

      render(
        <AuthGuard>
          <div data-testid="child">메인 콘텐츠</div>
        </AuthGuard>,
      )

      expect(screen.getByText('인증 확인 중...')).toBeInTheDocument()
    })

    it('children을 렌더링하지 않는다', () => {
      mockGetMode.mockReturnValue('server')
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: true,
      })

      render(
        <AuthGuard>
          <div data-testid="child">메인 콘텐츠</div>
        </AuthGuard>,
      )

      expect(screen.queryByTestId('child')).not.toBeInTheDocument()
    })

    it('LoginPage를 표시하지 않는다', () => {
      mockGetMode.mockReturnValue('server')
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: true,
      })

      render(
        <AuthGuard>
          <div>메인 콘텐츠</div>
        </AuthGuard>,
      )

      expect(screen.queryByTestId('login-page')).not.toBeInTheDocument()
    })
  })
})
