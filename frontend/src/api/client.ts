import ky from 'ky'
import { API_BASE_URL } from '../config'

export const apiClient = ky.create({
  prefixUrl: API_BASE_URL,
})

export default apiClient
