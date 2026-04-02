import ky from 'ky'
import { getApiBaseUrl } from '../config'

/**
 * auth 엔드포인트는 /api/v1이 아닌 /auth 경로이므로
 * getApiBaseUrl()에서 /api/v1 접미사를 제거한다.
 */
function getServerRootUrl(): string {
  return getApiBaseUrl().replace(/\/api\/v1\/?$/, '')
}

function bearerHeader(token: string) {
  return { Authorization: `Bearer ${token}` } as const
}

export interface RefreshResponse {
  access_token: string
}

export interface ValidateResponse {
  user: { id: number; email: string; name: string }
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<RefreshResponse> {
  return ky
    .post('auth/refresh', {
      prefixUrl: getServerRootUrl(),
      json: { refresh_token: refreshToken },
    })
    .json<RefreshResponse>()
}

export async function logout(accessToken: string): Promise<void> {
  await ky.delete('auth/logout', {
    prefixUrl: getServerRootUrl(),
    headers: bearerHeader(accessToken),
  })
}

export async function validateToken(
  accessToken: string,
): Promise<ValidateResponse> {
  return ky
    .get('api/v1/health', {
      prefixUrl: getServerRootUrl(),
      headers: bearerHeader(accessToken),
    })
    .json<ValidateResponse>()
}
