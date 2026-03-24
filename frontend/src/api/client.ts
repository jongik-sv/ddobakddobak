import ky from 'ky'
import { useAuthStore } from '../stores/authStore'
import { API_BASE_URL } from '../config'

export const apiClient = ky.create({
  prefixUrl: API_BASE_URL,
  hooks: {
    beforeRequest: [
      (request) => {
        const token = useAuthStore.getState().token
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`)
        }
      },
    ],
    afterResponse: [
      (_request, _options, response) => {
        if (response.status === 401) {
          useAuthStore.getState().logout()
        }
        return response
      },
    ],
  },
})

export default apiClient
