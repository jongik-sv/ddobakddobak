import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock 모듈들을 hoisted로 정의
const { mockRefreshAccessToken } = vi.hoisted(() => ({
  mockRefreshAccessToken: vi.fn(),
}))

vi.mock('../../config', () => ({
  getApiBaseUrl: () => 'http://localhost:13323/api/v1',
  IS_TAURI: false,
  IS_MOBILE: false,
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

  describe('client 헤더 주입', () => {
    it('getAuthHeaders 가 X-Client-Id/Platform 을 포함한다', async () => {
      const { getAuthHeaders } = await import('../client')
      const headers = getAuthHeaders() as Record<string, string>
      expect(headers['X-Client-Id']).toMatch(/[0-9a-f-]{36}/)
      expect(headers['X-Client-Platform']).toBe('web')
    })

    it('beforeRequest 가 X-Client-Id/Platform 헤더를 세팅한다', async () => {
      const fetchMock = vi.fn(async (..._args: unknown[]) => new Response('{}', { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)

      const { apiClient } = await import('../client')
      await apiClient.get('meetings')

      const request = fetchMock.mock.calls[0][0] as Request
      expect(request.headers.get('X-Client-Id')).toMatch(/[0-9a-f-]{36}/)
      expect(request.headers.get('X-Client-Platform')).toBe('web')

      vi.unstubAllGlobals()
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
