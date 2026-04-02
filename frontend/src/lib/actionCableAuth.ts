import { createConsumer } from '@rails/actioncable'
import { getWsUrl, getMode } from '../config'
import { useAuthStore } from '../stores/authStore'

/**
 * 인증된 ActionCable consumer를 생성한다.
 * 서버 모드에서는 JWT 토큰을 URL 쿼리 파라미터로 전달한다.
 * 로컬 모드에서는 토큰 없이 기존 방식으로 연결한다.
 */
export function createAuthenticatedConsumer() {
  const wsUrl = getWsUrl()
  if (getMode() !== 'server') {
    return createConsumer(wsUrl)
  }
  const { accessToken } = useAuthStore.getState()
  const url = accessToken
    ? `${wsUrl}?token=${encodeURIComponent(accessToken)}`
    : wsUrl
  return createConsumer(url)
}
