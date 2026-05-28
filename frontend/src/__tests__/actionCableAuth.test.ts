import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAuthStore } from '../stores/authStore'

// @rails/actioncable mock
vi.mock('@rails/actioncable', () => ({
  createConsumer: vi.fn((url: string) => ({ url, disconnect: vi.fn() })),
}))

import { createConsumer } from '@rails/actioncable'

// 웹(jsdom) 환경은 항상 server 모드 + 동일 origin WS를 사용한다.
const wsOrigin = () => window.location.origin.replace(/^http/, 'ws')

describe('createAuthenticatedConsumer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useAuthStore.setState({
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
    })
  })

  it('accessToken이 없으면 토큰 없이 동일 origin WS URL로 consumer를 생성한다', async () => {
    const { createAuthenticatedConsumer } = await import('../lib/actionCableAuth')
    createAuthenticatedConsumer()

    expect(createConsumer).toHaveBeenCalledOnce()
    const calledUrl = (createConsumer as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toBe(`${wsOrigin()}/cable`)
    expect(calledUrl).not.toContain('token=')
  })

  it('accessToken이 있으면 토큰을 쿼리 파라미터로 포함한다', async () => {
    useAuthStore.setState({ accessToken: 'my-jwt-token' })

    const { createAuthenticatedConsumer } = await import('../lib/actionCableAuth')
    createAuthenticatedConsumer()

    expect(createConsumer).toHaveBeenCalledOnce()
    const calledUrl = (createConsumer as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain(`${wsOrigin()}/cable`)
    expect(calledUrl).toContain('token=my-jwt-token')
  })

  it('웹에서는 server_url을 설정해도 동일 origin WS를 사용한다', async () => {
    localStorage.setItem('server_url', 'https://api.example.com')
    useAuthStore.setState({ accessToken: null })

    const { createAuthenticatedConsumer } = await import('../lib/actionCableAuth')
    createAuthenticatedConsumer()

    expect(createConsumer).toHaveBeenCalledOnce()
    const calledUrl = (createConsumer as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toBe(`${wsOrigin()}/cable`)
    expect(calledUrl).not.toContain('token=')
  })

  it('토큰에 특수문자가 있으면 encodeURIComponent로 인코딩한다', async () => {
    useAuthStore.setState({ accessToken: 'token+with=special&chars' })

    const { createAuthenticatedConsumer } = await import('../lib/actionCableAuth')
    createAuthenticatedConsumer()

    const calledUrl = (createConsumer as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('token=token%2Bwith%3Dspecial%26chars')
  })
})
