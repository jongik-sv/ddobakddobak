import ky from 'ky'
import { getApiBaseUrl } from '../config'

/**
 * 서버 루트 URL을 추출한다.
 * auth 엔드포인트는 /api/v1이 아닌 /auth 경로이므로
 * getApiBaseUrl()에서 /api/v1 접미사를 제거한다.
 */
function getServerRootUrl(): string {
  return getApiBaseUrl().replace(/\/api\/v1\/?$/, '')
}

/**
 * 인증 전용 Authorization 헤더를 생성한다.
 */
function bearerHeader(token: string) {
  return { Authorization: `Bearer ${token}` } as const
}

// ── Types ──

export interface RefreshResponse {
  access_token: string
}

export interface ValidateResponse {
  user: { id: number; email: string; name: string }
}

// ── Refresh Token ──

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

// ── Logout ──

export async function logout(accessToken: string): Promise<void> {
  await ky.delete('auth/logout', {
    prefixUrl: getServerRootUrl(),
    headers: bearerHeader(accessToken),
  })
}

// ── Validate (서버에 인증된 요청을 보내 토큰 유효성 확인) ──

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
