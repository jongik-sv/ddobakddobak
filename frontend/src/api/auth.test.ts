import { describe, it, expect, vi, beforeEach } from 'vitest'
import { login, signup } from './auth'

const { mockJson, mockPost } = vi.hoisted(() => {
  const mockJson = vi.fn()
  const mockPost = vi.fn(() => ({ json: mockJson }))
  return { mockJson, mockPost }
})

vi.mock('./client', () => ({
  default: { post: mockPost },
}))

describe('auth API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockReturnValue({ json: mockJson })
  })

  describe('login', () => {
    it('sign_in 엔드포인트로 POST 요청', async () => {
      mockJson.mockResolvedValue({
        token: 'jwt-token',
        user: { id: 1, email: 'test@example.com', name: '테스트' },
      })
      await login('test@example.com', 'password123')
      expect(mockPost).toHaveBeenCalledWith('auth/sign_in', {
        json: { user: { email: 'test@example.com', password: 'password123' } },
      })
    })

    it('token과 user를 반환', async () => {
      mockJson.mockResolvedValue({
        token: 'jwt-token',
        user: { id: 1, email: 'test@example.com', name: '테스트' },
      })
      const result = await login('test@example.com', 'password123')
      expect(result.token).toBe('jwt-token')
      expect(result.user.email).toBe('test@example.com')
    })
  })

  describe('signup', () => {
    it('sign_up 엔드포인트로 POST 요청', async () => {
      mockJson.mockResolvedValue({
        token: 'jwt-token',
        user: { id: 2, email: 'new@example.com', name: '신규' },
      })
      await signup('신규', 'new@example.com', 'password123')
      expect(mockPost).toHaveBeenCalledWith('auth/sign_up', {
        json: { user: { name: '신규', email: 'new@example.com', password: 'password123' } },
      })
    })

    it('token과 user를 반환', async () => {
      mockJson.mockResolvedValue({
        token: 'jwt-token',
        user: { id: 2, email: 'new@example.com', name: '신규' },
      })
      const result = await signup('신규', 'new@example.com', 'password123')
      expect(result.token).toBe('jwt-token')
      expect(result.user.name).toBe('신규')
    })
  })
})
