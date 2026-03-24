import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore } from './authStore'

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.getState().logout()
  })

  it('초기 상태: user는 null이고 isAuthenticated는 false', () => {
    const state = useAuthStore.getState()
    expect(state.user).toBeNull()
    expect(state.token).toBeNull()
    expect(state.isAuthenticated).toBe(false)
  })

  it('setUser 호출 시 user가 설정되고 isAuthenticated가 true', () => {
    const mockUser = { id: 1, email: 'test@example.com', name: '테스트' }
    useAuthStore.getState().setUser(mockUser)
    const state = useAuthStore.getState()
    expect(state.user).toEqual(mockUser)
    expect(state.isAuthenticated).toBe(true)
  })

  it('setToken 호출 시 token이 설정됨', () => {
    useAuthStore.getState().setToken('test-token-123')
    const state = useAuthStore.getState()
    expect(state.token).toBe('test-token-123')
  })

  it('login 호출 시 token, user, isAuthenticated 설정됨', () => {
    const mockUser = { id: 1, email: 'test@example.com', name: '테스트' }
    useAuthStore.getState().login('jwt-token', mockUser)
    const state = useAuthStore.getState()
    expect(state.token).toBe('jwt-token')
    expect(state.user).toEqual(mockUser)
    expect(state.isAuthenticated).toBe(true)
  })

  it('logout 호출 시 상태가 초기화됨', () => {
    const mockUser = { id: 1, email: 'test@example.com', name: '테스트' }
    useAuthStore.getState().setUser(mockUser)
    useAuthStore.getState().setToken('test-token')
    useAuthStore.getState().logout()

    const state = useAuthStore.getState()
    expect(state.user).toBeNull()
    expect(state.token).toBeNull()
    expect(state.isAuthenticated).toBe(false)
  })
})
