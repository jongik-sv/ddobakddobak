import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadSessions,
  getSession,
  saveSession,
  removeSession,
  pruneExpired,
  decodeJwtExp,
  type AuthSession,
} from '../../lib/authSessions'

const KEY = 'auth_sessions'
const SERVER_A = 'http://10.0.0.1:13323'
const SERVER_B = 'http://10.0.0.2:13323'

function mkSession(over: Partial<AuthSession> = {}): AuthSession {
  return {
    accessToken: 'access',
    refreshToken: 'refresh',
    user: { id: 1, email: 'a@b.c', name: 'A', role: 'member' },
    refreshExp: null,
    ...over,
  }
}

/** {exp} 클레임을 가진 더미 JWT(header.payload.sig) 생성 */
function mkJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`
}

describe('authSessions', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('save 후 get으로 라운드트립한다', () => {
    const s = mkSession()
    saveSession(SERVER_A, s)
    expect(getSession(SERVER_A)).toEqual(s)
  })

  it('없는 키는 null을 반환한다', () => {
    expect(getSession(SERVER_A)).toBeNull()
  })

  it('여러 서버 세션을 독립적으로 저장한다', () => {
    saveSession(SERVER_A, mkSession({ accessToken: 'tokA' }))
    saveSession(SERVER_B, mkSession({ accessToken: 'tokB' }))
    expect(getSession(SERVER_A)?.accessToken).toBe('tokA')
    expect(getSession(SERVER_B)?.accessToken).toBe('tokB')
  })

  it('removeSession은 해당 키만 삭제한다', () => {
    saveSession(SERVER_A, mkSession())
    saveSession(SERVER_B, mkSession())
    removeSession(SERVER_A)
    expect(getSession(SERVER_A)).toBeNull()
    expect(getSession(SERVER_B)).not.toBeNull()
  })

  it('pruneExpired는 과거 refreshExp만 삭제하고 미래/null은 보존한다', () => {
    const now = Math.floor(Date.now() / 1000)
    saveSession(SERVER_A, mkSession({ refreshExp: now - 100 })) // 만료
    saveSession(SERVER_B, mkSession({ refreshExp: now + 100000 })) // 유효
    saveSession('http://10.0.0.3', mkSession({ refreshExp: null })) // 미상
    pruneExpired()
    expect(getSession(SERVER_A)).toBeNull()
    expect(getSession(SERVER_B)).not.toBeNull()
    expect(getSession('http://10.0.0.3')).not.toBeNull()
  })

  it('손상된 JSON이면 빈 맵을 반환한다', () => {
    localStorage.setItem(KEY, '{not valid json')
    expect(loadSessions()).toEqual({})
  })

  it('decodeJwtExp는 exp 클레임(초)을 추출한다', () => {
    expect(decodeJwtExp(mkJwt({ sub: '1', exp: 1893456000 }))).toBe(1893456000)
  })

  it('decodeJwtExp는 잘못된 토큰에 null을 반환한다', () => {
    expect(decodeJwtExp('not-a-jwt')).toBeNull()
    expect(decodeJwtExp('')).toBeNull()
    expect(decodeJwtExp(mkJwt({ sub: '1' }))).toBeNull() // exp 없음
  })
})
