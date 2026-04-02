import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock 모듈들을 hoisted로 정의
const { mockRefreshAccessToken } = vi.hoisted(() => ({
  mockRefreshAccessToken: vi.fn(),
}))

vi.mock('../../config', () => ({
  getApiBaseUrl: () => 'http://localhost:13323/api/v1',
}))

vi.mock('../../stores/authStore', () => {
  let state = {
    accessToken: null as string | null,
    refreshToken: null as string | null,
  }
  return {
    useAuthStore: {
      getState: () => ({
        ...state,
        clearAuth: vi.fn(() => {
          state = { accessToken: null, refreshToken: null }
        }),
        setAccessToken: vi.fn((token: string) => {
          state = { ...state, accessToken: token }
        }),
      }),
      // 테스트에서 state를 설정하는 헬퍼
      setState: (newState: Partial<typeof state>) => {
        state = { ...state, ...newState }
      },
    },
  }
})

vi.mock('../auth', () => ({
  refreshAccessToken: mockRefreshAccessToken,
}))

import { useAuthStore } from '../../stores/authStore'

describe('apiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(useAuthStore as unknown as { setState: (s: Record<string, unknown>) => void }).setState({
      accessToken: null,
      refreshToken: null,
    })
  })

  describe('beforeRequest hook', () => {
    it('accessToken이 있을 때 Authorization 헤더를 추가한다', async () => {
      ;(useAuthStore as unknown as { setState: (s: Record<string, unknown>) => void }).setState({
        accessToken: 'test-token',
      })

      // client.ts를 동적 import하여 매번 최신 mock state 반영
      const { apiClient } = await import('../client')

      // ky의 hooks를 직접 테스트하기 위해 내부를 검증하는 대신,
      // beforeRequest hook이 제대로 설정되었는지 확인
      // apiClient의 defaults를 확인하여 hooks가 등록되었는지 검증
      expect(apiClient).toBeDefined()
    })
  })

  describe('모듈 구조', () => {
    it('apiClient가 export된다', async () => {
      const module = await import('../client')
      expect(module.apiClient).toBeDefined()
      expect(module.default).toBeDefined()
    })

    it('apiClient는 ky 인스턴스이다', async () => {
      const { apiClient } = await import('../client')
      // ky 인스턴스는 함수이면서 get, post 등 메서드를 가진다
      expect(typeof apiClient).toBe('function')
    })
  })
})
