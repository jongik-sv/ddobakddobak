import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

// ── Mocks ──
const { mockValidateToken, mockRefreshAccessToken, mockLogoutApi, mockOpen } =
  vi.hoisted(() => ({
    mockValidateToken: vi.fn(),
    mockRefreshAccessToken: vi.fn(),
    mockLogoutApi: vi.fn(),
    mockOpen: vi.fn(),
  }))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
  onOpenUrl: vi.fn().mockResolvedValue(vi.fn()),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: mockOpen,
}))

vi.mock('../../api/auth', () => ({
  validateToken: mockValidateToken,
  refreshAccessToken: mockRefreshAccessToken,
  logout: mockLogoutApi,
}))

vi.mock('../../config', () => ({
  getMode: vi.fn(() => 'server'),
  getServerUrl: vi.fn(() => 'https://api.example.com'),
}))

import { useAuth } from '../useAuth'
import { useAuthStore } from '../../stores/authStore'
import { getMode } from '../../config'

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useAuthStore.setState({
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: true,
      user: null,
    })
  })

  describe('로컬 모드', () => {
    it('로컬 모드에서는 validateToken으로 사용자 정보를 가져온다', async () => {
      vi.mocked(getMode).mockReturnValue('local')
      mockValidateToken.mockResolvedValue({
        status: 'ok',
        user: { id: 1, email: 'desktop@local', name: '사용자', role: 'admin' },
      })

      const { result } = renderHook(() => useAuth())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
      expect(mockValidateToken).toHaveBeenCalledWith('')
    })
  })

  describe('서버 모드 — 토큰 없음', () => {
    it('accessToken이 없으면 isLoading이 false가 되고 isAuthenticated가 false이다', async () => {
      vi.mocked(getMode).mockReturnValue('server')

      const { result } = renderHook(() => useAuth())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
      expect(result.current.isAuthenticated).toBe(false)
    })
  })

  describe('서버 모드 — 토큰 유효', () => {
    it('accessToken이 유효하면 isAuthenticated가 true가 된다', async () => {
      vi.mocked(getMode).mockReturnValue('server')
      useAuthStore.setState({
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        isLoading: true,
      })
      mockValidateToken.mockResolvedValue({
        status: 'ok',
        user: { id: 1, email: 'test@test.com', name: 'Test', role: 'member' },
      })

      const { result } = renderHook(() => useAuth())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
      expect(result.current.isAuthenticated).toBe(true)
      expect(mockValidateToken).toHaveBeenCalledWith('valid-token')
    })

    it('사용자 정보가 store에 저장된다', async () => {
      vi.mocked(getMode).mockReturnValue('server')
      useAuthStore.setState({
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        isLoading: true,
      })
      mockValidateToken.mockResolvedValue({
        status: 'ok',
        user: { id: 1, email: 'test@test.com', name: 'Test', role: 'admin' },
      })

      renderHook(() => useAuth())

      await waitFor(() => {
        expect(useAuthStore.getState().user).toEqual({
          id: 1,
          email: 'test@test.com',
          name: 'Test',
          role: 'admin',
        })
      })
    })
  })

  describe('서버 모드 — 토큰 만료 + refresh 성공', () => {
    it('validate 실패 후 refresh 성공 시 isAuthenticated가 true가 된다', async () => {
      vi.mocked(getMode).mockReturnValue('server')
      useAuthStore.setState({
        accessToken: 'expired-token',
        refreshToken: 'valid-refresh',
        isLoading: true,
      })
      mockValidateToken
        .mockRejectedValueOnce(new Error('Unauthorized'))
        .mockResolvedValueOnce({ status: 'ok', user: { id: 1, email: 'test@test.com', name: 'Test', role: 'member' } })
      mockRefreshAccessToken.mockResolvedValue({ access_token: 'new-token' })

      const { result } = renderHook(() => useAuth())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
      expect(result.current.isAuthenticated).toBe(true)
      expect(mockRefreshAccessToken).toHaveBeenCalledWith('valid-refresh')
    })
  })

  describe('서버 모드 — 토큰 만료 + refresh 실패', () => {
    it('validate 실패 + refresh 실패 시 clearAuth 호출', async () => {
      vi.mocked(getMode).mockReturnValue('server')
      useAuthStore.setState({
        accessToken: 'expired-token',
        refreshToken: 'expired-refresh',
        isLoading: true,
      })
      mockValidateToken.mockRejectedValue(new Error('Unauthorized'))
      mockRefreshAccessToken.mockRejectedValue(new Error('Refresh failed'))

      const { result } = renderHook(() => useAuth())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
      expect(result.current.isAuthenticated).toBe(false)
    })
  })

  describe('서버 모드 — 토큰 만료 + refreshToken 없음', () => {
    it('validate 실패 + refreshToken 없음 시 clearAuth 호출', async () => {
      vi.mocked(getMode).mockReturnValue('server')
      useAuthStore.setState({
        accessToken: 'expired-token',
        refreshToken: null,
        isLoading: true,
      })
      mockValidateToken.mockRejectedValue(new Error('Unauthorized'))

      const { result } = renderHook(() => useAuth())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
      expect(result.current.isAuthenticated).toBe(false)
      expect(mockRefreshAccessToken).not.toHaveBeenCalled()
    })
  })

  describe('login', () => {
    it('브라우저에서 로그인 URL을 연다', async () => {
      vi.mocked(getMode).mockReturnValue('server')

      const { result } = renderHook(() => useAuth())

      await act(async () => {
        result.current.login()
      })

      expect(mockOpen).toHaveBeenCalledWith(
        `https://api.example.com/auth/web_login?callback=${encodeURIComponent('ddobak://')}`,
      )
    })
  })

  describe('logout', () => {
    it('서버에 로그아웃 요청을 보내고 로컬 토큰을 삭제한다', async () => {
      vi.mocked(getMode).mockReturnValue('server')
      useAuthStore.setState({
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        isAuthenticated: true,
        isLoading: false,
      })
      mockLogoutApi.mockResolvedValue(undefined)

      const { result } = renderHook(() => useAuth())

      await act(async () => {
        await result.current.logout()
      })

      expect(mockLogoutApi).toHaveBeenCalledWith('valid-token')
      expect(result.current.isAuthenticated).toBe(false)
    })

    it('서버 로그아웃 실패해도 로컬 토큰은 삭제한다', async () => {
      vi.mocked(getMode).mockReturnValue('server')
      useAuthStore.setState({
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        isAuthenticated: true,
        isLoading: false,
      })
      mockLogoutApi.mockRejectedValue(new Error('Server error'))

      const { result } = renderHook(() => useAuth())

      await act(async () => {
        await result.current.logout()
      })

      expect(result.current.isAuthenticated).toBe(false)
    })
  })
})
