import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore } from '../stores/authStore'

describe('getAuthHeaders', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
    })
  })

  it('accessToken이 있으면 Authorization 헤더를 포함한 객체를 반환한다', async () => {
    useAuthStore.setState({ accessToken: 'test-jwt-token' })
    const { getAuthHeaders } = await import('../api/client')
    const headers = getAuthHeaders()
    expect(headers).toEqual({ Authorization: 'Bearer test-jwt-token' })
  })

  it('accessToken이 없으면 빈 객체를 반환한다', async () => {
    useAuthStore.setState({ accessToken: null })
    const { getAuthHeaders } = await import('../api/client')
    const headers = getAuthHeaders()
    expect(headers).toEqual({})
  })
})
