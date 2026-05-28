/**
 * 서버별 로그인 세션을 localStorage에 보관한다.
 *
 * 토큰을 서버 식별자(URL)로 네임스페이스하여, 다른 서버로 전환했다가
 * 돌아와도 refresh가 유효하면 자동 로그인된다. 단일 키 `auth_sessions`에
 * `{ [serverKey]: AuthSession }` 맵으로 저장한다.
 */
import type { UserInfo } from '../stores/authStore'

const SESSIONS_KEY = 'auth_sessions'

export interface AuthSession {
  accessToken: string
  refreshToken: string
  user: UserInfo | null
  /** refresh JWT의 exp 클레임(초). 디코드 실패 시 null. */
  refreshExp: number | null
}

type SessionMap = Record<string, AuthSession>

/** 세션 맵 전체를 로드한다. 손상 시 빈 맵. */
export function loadSessions(): SessionMap {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as SessionMap) : {}
  } catch {
    return {}
  }
}

function writeSessions(map: SessionMap): void {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(map))
}

/** 특정 서버 세션을 반환한다. 없으면 null. */
export function getSession(serverKey: string): AuthSession | null {
  return loadSessions()[serverKey] ?? null
}

/** 특정 서버 세션을 저장(덮어쓰기)한다. */
export function saveSession(serverKey: string, session: AuthSession): void {
  const map = loadSessions()
  map[serverKey] = session
  writeSessions(map)
}

/** 특정 서버 세션만 삭제한다. */
export function removeSession(serverKey: string): void {
  const map = loadSessions()
  delete map[serverKey]
  writeSessions(map)
}

/** refreshExp가 과거인 세션을 삭제한다(null/미래는 보존). */
export function pruneExpired(): void {
  const now = Math.floor(Date.now() / 1000)
  const map = loadSessions()
  let changed = false
  for (const [key, s] of Object.entries(map)) {
    if (s.refreshExp != null && s.refreshExp < now) {
      delete map[key]
      changed = true
    }
  }
  if (changed) writeSessions(map)
}

/** JWT payload의 exp 클레임(초)을 추출한다. 실패 시 null. */
export function decodeJwtExp(token: string): number | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const exp = JSON.parse(json).exp
    return typeof exp === 'number' ? exp : null
  } catch {
    return null
  }
}
