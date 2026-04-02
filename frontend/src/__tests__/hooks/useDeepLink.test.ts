import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('@tauri-apps/plugin-deep-link', () => ({
  onOpenUrl: vi.fn(),
}))

import { onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { useDeepLink } from '../../hooks/useDeepLink'
import { useAuthStore } from '../../stores/authStore'

describe('useDeepLink', () => {
  const mockUnlisten = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useAuthStore.setState({
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: true,
    })
    ;(onOpenUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockUnlisten)
  })

  it('onOpenUrl 리스너를 등록한다', () => {
    renderHook(() => useDeepLink())
    expect(onOpenUrl).toHaveBeenCalledOnce()
  })

  it('유효한 URL 수신 시 authStore에 토큰을 저장한다', () => {
    let callback: (urls: string[]) => void
    ;(onOpenUrl as ReturnType<typeof vi.fn>).mockImplementation((cb) => {
      callback = cb
      return Promise.resolve(mockUnlisten)
    })

    renderHook(() => useDeepLink())
    callback!(['ddobak://callback?access_token=test-access&refresh_token=test-refresh'])

    const state = useAuthStore.getState()
    expect(state.accessToken).toBe('test-access')
    expect(state.refreshToken).toBe('test-refresh')
    expect(state.isAuthenticated).toBe(true)
  })

  it('localStorage에도 토큰이 저장된다', () => {
    let callback: (urls: string[]) => void
    ;(onOpenUrl as ReturnType<typeof vi.fn>).mockImplementation((cb) => {
      callback = cb
      return Promise.resolve(mockUnlisten)
    })

    renderHook(() => useDeepLink())
    callback!(['ddobak://callback?access_token=test-access&refresh_token=test-refresh'])

    expect(localStorage.getItem('access_token')).toBe('test-access')
    expect(localStorage.getItem('refresh_token')).toBe('test-refresh')
  })

  it('잘못된 URL은 무시한다', () => {
    let callback: (urls: string[]) => void
    ;(onOpenUrl as ReturnType<typeof vi.fn>).mockImplementation((cb) => {
      callback = cb
      return Promise.resolve(mockUnlisten)
    })

    renderHook(() => useDeepLink())
    callback!(['https://malicious.com?access_token=xxx&refresh_token=yyy'])

    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('access_token만 있고 refresh_token이 없으면 무시한다', () => {
    let callback: (urls: string[]) => void
    ;(onOpenUrl as ReturnType<typeof vi.fn>).mockImplementation((cb) => {
      callback = cb
      return Promise.resolve(mockUnlisten)
    })

    renderHook(() => useDeepLink())
    callback!(['ddobak://callback?access_token=xxx'])

    expect(useAuthStore.getState().accessToken).toBeNull()
  })

  it('언마운트 시 리스너를 해제한다', async () => {
    ;(onOpenUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockUnlisten)

    const { unmount } = renderHook(() => useDeepLink())
    unmount()

    await vi.waitFor(() => {
      expect(mockUnlisten).toHaveBeenCalled()
    })
  })
})
