import ky from 'ky'
import { useAuthStore } from '../stores/authStore'
import { API_BASE_URL, IS_TAURI } from '../config'

export const apiClient = ky.create({
  prefixUrl: API_BASE_URL,
  hooks: {
    beforeRequest: [
      (request) => {
        // 데스크톱 모드: 토큰 불필요 (백엔드가 DESKTOP_MODE로 자동 인증)
        if (IS_TAURI) return
        const token = useAuthStore.getState().token
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`)
        }
      },
    ],
    afterResponse: [
      (_request, _options, response) => {
        if (!IS_TAURI && response.status === 401) {
          useAuthStore.getState().logout()
        }
        return response
      },
    ],
  },
})

export default apiClient
