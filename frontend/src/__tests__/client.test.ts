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

  it('accessToken이 있으면 Authorization + client 헤더를 포함한 객체를 반환한다', async () => {
    useAuthStore.setState({ accessToken: 'test-jwt-token' })
    const { getAuthHeaders } = await import('../api/client')
    const headers = getAuthHeaders() as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-jwt-token')
    expect(headers['X-Client-Id']).toMatch(/[0-9a-f-]{36}/)
    expect(headers['X-Client-Platform']).toBe('web')
  })

  it('accessToken이 없으면 Authorization 없이 client 헤더만 반환한다', async () => {
    useAuthStore.setState({ accessToken: null })
    const { getAuthHeaders } = await import('../api/client')
    const headers = getAuthHeaders() as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
    expect(headers['X-Client-Id']).toMatch(/[0-9a-f-]{36}/)
    expect(headers['X-Client-Platform']).toBe('web')
  })
})
