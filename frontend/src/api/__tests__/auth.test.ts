import { describe, it, expect, vi, beforeEach } from 'vitest'

// ky를 mock한다 (auth.ts는 bare ky를 직접 사용)
const { mockJson, mockPost, mockDelete, mockGet } = vi.hoisted(() => {
  const mockJson = vi.fn()
  const mockPost = vi.fn(() => ({ json: mockJson }))
  const mockDelete = vi.fn(() => ({ json: mockJson }))
  const mockGet = vi.fn(() => ({ json: mockJson }))
  return { mockJson, mockPost, mockDelete, mockGet }
})

vi.mock('ky', () => ({
  default: {
    post: mockPost,
    delete: mockDelete,
    get: mockGet,
  },
}))

// config mock
vi.mock('../../config', () => ({
  getApiBaseUrl: () => 'https://api.example.com/api/v1',
}))

import { refreshAccessToken, logout, validateToken } from '../auth'

describe('auth API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockReturnValue({ json: mockJson })
    mockDelete.mockReturnValue({ json: mockJson })
    mockGet.mockReturnValue({ json: mockJson })
  })

  describe('refreshAccessToken', () => {
    it('auth/refresh 엔드포인트로 POST 요청을 보낸다', async () => {
      mockJson.mockResolvedValue({ access_token: 'new-token' })
      await refreshAccessToken('refresh-123')
      expect(mockPost).toHaveBeenCalledWith('auth/refresh', {
        prefixUrl: 'https://api.example.com',
        json: { refresh_token: 'refresh-123' },
      })
    })

    it('새 access_token을 반환한다', async () => {
      mockJson.mockResolvedValue({ access_token: 'new-token' })
      const result = await refreshAccessToken('refresh-123')
      expect(result.access_token).toBe('new-token')
    })

    it('서버 오류 시 예외를 전파한다', async () => {
      mockJson.mockRejectedValue(new Error('Unauthorized'))
      await expect(refreshAccessToken('bad-token')).rejects.toThrow('Unauthorized')
    })
  })

  describe('logout', () => {
    it('auth/logout 엔드포인트로 DELETE 요청을 보낸다', async () => {
      mockDelete.mockReturnValue(Promise.resolve())
      await logout('access-123')
      expect(mockDelete).toHaveBeenCalledWith('auth/logout', {
        prefixUrl: 'https://api.example.com',
        headers: { Authorization: 'Bearer access-123' },
      })
    })
  })

  describe('validateToken', () => {
    it('api/v1/health 엔드포인트로 GET 요청을 보낸다', async () => {
      mockJson.mockResolvedValue({ user: { id: 1, email: 'test@example.com', name: 'Test' } })
      await validateToken('access-123')
      expect(mockGet).toHaveBeenCalledWith('api/v1/health', {
        prefixUrl: 'https://api.example.com',
        headers: { Authorization: 'Bearer access-123' },
      })
    })

    it('유효한 토큰일 때 사용자 정보를 반환한다', async () => {
      const userData = { user: { id: 1, email: 'test@example.com', name: 'Test' } }
      mockJson.mockResolvedValue(userData)
      const result = await validateToken('access-123')
      expect(result.user.id).toBe(1)
    })

    it('만료된 토큰일 때 예외를 전파한다', async () => {
      mockJson.mockRejectedValue(new Error('Unauthorized'))
      await expect(validateToken('expired-token')).rejects.toThrow('Unauthorized')
    })
  })
})
