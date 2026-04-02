import ky from 'ky'
import { getApiBaseUrl } from '../config'
import { useAuthStore } from '../stores/authStore'
import { refreshAccessToken } from './auth'

// ── 동시 401 처리를 위한 싱글턴 refresh Promise ──
let refreshPromise: Promise<string> | null = null

async function getOrRefreshToken(refreshToken: string): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken(refreshToken)
      .then((res) => {
        refreshPromise = null
        return res.access_token
      })
      .catch((err) => {
        refreshPromise = null
        throw err
      })
  }
  return refreshPromise
}

export const apiClient = ky.create({
  prefixUrl: getApiBaseUrl(),
  hooks: {
    beforeRequest: [
      (request) => {
        const { accessToken } = useAuthStore.getState()
        if (accessToken) {
          request.headers.set('Authorization', `Bearer ${accessToken}`)
        }
      },
    ],
    afterResponse: [
      async (request, options, response) => {
        if (response.status !== 401) return response

        // 401 수신 시 refresh 시도
        const { refreshToken } = useAuthStore.getState()
        if (!refreshToken) {
          useAuthStore.getState().clearAuth()
          return response
        }

        try {
          const newAccessToken = await getOrRefreshToken(refreshToken)
          useAuthStore.getState().setAccessToken(newAccessToken)

          // 원래 요청을 새 토큰으로 재시도
          request.headers.set('Authorization', `Bearer ${newAccessToken}`)
          return ky(request, options)
        } catch {
          // refresh 실패 → 로그아웃
          useAuthStore.getState().clearAuth()
          return response
        }
      },
    ],
  },
})

export default apiClient
