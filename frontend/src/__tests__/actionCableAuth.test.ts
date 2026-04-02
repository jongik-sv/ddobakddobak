import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAuthStore } from '../stores/authStore'

// @rails/actioncable mock
vi.mock('@rails/actioncable', () => ({
  createConsumer: vi.fn((url: string) => ({ url, disconnect: vi.fn() })),
}))

import { createConsumer } from '@rails/actioncable'

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

  it('로컬 모드에서는 토큰 없이 WS URL로 consumer를 생성한다', async () => {
    localStorage.setItem('mode', 'local')
    const { createAuthenticatedConsumer } = await import('../lib/actionCableAuth')
    createAuthenticatedConsumer()

    expect(createConsumer).toHaveBeenCalledOnce()
    const calledUrl = (createConsumer as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).not.toContain('token=')
  })

  it('서버 모드 + accessToken이 있으면 토큰을 쿼리 파라미터로 포함한다', async () => {
    localStorage.setItem('mode', 'server')
    localStorage.setItem('server_url', 'https://api.example.com')
    useAuthStore.setState({ accessToken: 'my-jwt-token' })

    const { createAuthenticatedConsumer } = await import('../lib/actionCableAuth')
    createAuthenticatedConsumer()

    expect(createConsumer).toHaveBeenCalledOnce()
    const calledUrl = (createConsumer as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('wss://api.example.com/cable')
    expect(calledUrl).toContain('token=my-jwt-token')
  })

  it('서버 모드 + accessToken이 없으면 토큰 없이 consumer를 생성한다', async () => {
    localStorage.setItem('mode', 'server')
    localStorage.setItem('server_url', 'https://api.example.com')
    useAuthStore.setState({ accessToken: null })

    const { createAuthenticatedConsumer } = await import('../lib/actionCableAuth')
    createAuthenticatedConsumer()

    expect(createConsumer).toHaveBeenCalledOnce()
    const calledUrl = (createConsumer as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toBe('wss://api.example.com/cable')
    expect(calledUrl).not.toContain('token=')
  })

  it('서버 모드 + http URL에서는 ws 프로토콜을 사용한다', async () => {
    localStorage.setItem('mode', 'server')
    localStorage.setItem('server_url', 'http://192.168.1.100:3000')
    useAuthStore.setState({ accessToken: 'test-token' })

    const { createAuthenticatedConsumer } = await import('../lib/actionCableAuth')
    createAuthenticatedConsumer()

    const calledUrl = (createConsumer as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('ws://192.168.1.100:3000/cable')
    expect(calledUrl).toContain('token=test-token')
  })

  it('토큰에 특수문자가 있으면 encodeURIComponent로 인코딩한다', async () => {
    localStorage.setItem('mode', 'server')
    localStorage.setItem('server_url', 'https://api.example.com')
    useAuthStore.setState({ accessToken: 'token+with=special&chars' })

    const { createAuthenticatedConsumer } = await import('../lib/actionCableAuth')
    createAuthenticatedConsumer()

    const calledUrl = (createConsumer as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('token=token%2Bwith%3Dspecial%26chars')
  })
})
