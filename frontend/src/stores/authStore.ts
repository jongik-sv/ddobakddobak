import { create } from 'zustand'
import { getServerKey } from '../config'
import {
  pruneExpired,
  getSession,
  saveSession,
  removeSession,
  decodeJwtExp,
  type AuthSession,
} from '../lib/authSessions'

// ── User Info ──
export interface UserInfo {
  id: number
  email: string
  name: string
  role: 'admin' | 'manager' | 'member'
}

/** manager 이상(=admin, manager)만 프로젝트를 생성할 수 있다. 로컬 모드 예외는 호출부에서 처리. */
export function canCreateProject(role: UserInfo['role'] | null | undefined): boolean {
  return role === 'admin' || role === 'manager'
}

// ── State ──
interface AuthStateData {
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  /** 앱 시작 시 토큰 검증 중 로딩 상태 */
  isLoading: boolean
  /** 현재 로그인 사용자 정보 */
  user: UserInfo | null
}

// ── Actions ──
interface AuthActions {
  setTokens: (accessToken: string, refreshToken: string) => void
  setAccessToken: (accessToken: string) => void
  markAuthenticated: () => void
  clearAuth: () => void
  setLoading: (loading: boolean) => void
  setUser: (user: UserInfo) => void
}

type AuthState = AuthStateData & AuthActions

// 기존 단일 토큰 키(mirror). 외부에서 직접 읽는 코드는 없으나(전부 이 스토어 경유)
// 구버전에서 업그레이드한 사용자의 세션을 보존하기 위한 마이그레이션 소스로 쓴다.
const ACCESS_TOKEN_KEY = 'access_token'
const REFRESH_TOKEN_KEY = 'refresh_token'
const USER_KEY = 'auth_user'

/** 만료 세션 정리 후, 현재 서버 세션을 로드한다(없으면 mirror에서 마이그레이션). */
function hydrate(): AuthSession | null {
  pruneExpired()
  const key = getServerKey()
  const session = getSession(key)
  if (session) return session

  // 마이그레이션: 구버전 단일 토큰이 남아 있으면 현재 서버 세션으로 승격.
  const access = localStorage.getItem(ACCESS_TOKEN_KEY)
  const refresh = localStorage.getItem(REFRESH_TOKEN_KEY)
  if (access && refresh) {
    let user: UserInfo | null = null
    try {
      const raw = localStorage.getItem(USER_KEY)
      user = raw ? JSON.parse(raw) : null
    } catch {
      user = null
    }
    const migrated: AuthSession = {
      accessToken: access,
      refreshToken: refresh,
      user,
      refreshExp: decodeJwtExp(refresh),
    }
    saveSession(key, migrated)
    return migrated
  }
  return null
}

/** 현재 서버 세션을 부분 갱신한다(없으면 생성). */
function patchSession(patch: Partial<AuthSession>): void {
  const key = getServerKey()
  const prev = getSession(key) ?? {
    accessToken: '',
    refreshToken: '',
    user: null,
    refreshExp: null,
  }
  saveSession(key, { ...prev, ...patch })
}

const initial = hydrate()

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: initial?.accessToken ?? null,
  refreshToken: initial?.refreshToken ?? null,
  isAuthenticated: false,
  isLoading: true,
  user: initial?.user ?? null,

  setTokens: (accessToken, refreshToken) => {
    // mirror 동기화(마이그레이션 호환) + 현재 서버 세션 갱신
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
    patchSession({ accessToken, refreshToken, refreshExp: decodeJwtExp(refreshToken) })
    set({ accessToken, refreshToken, isAuthenticated: true })
  },

  setAccessToken: (accessToken) => {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
    patchSession({ accessToken })
    set({ accessToken })
  },

  markAuthenticated: () => set({ isAuthenticated: true }),

  clearAuth: () => {
    // 현재 서버 세션만 삭제(다른 서버 로그인은 유지)
    removeSession(getServerKey())
    localStorage.removeItem(ACCESS_TOKEN_KEY)
    localStorage.removeItem(REFRESH_TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    set({
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
      user: null,
    })
  },

  setLoading: (loading) => set({ isLoading: loading }),

  setUser: (user) => {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    patchSession({ user })
    set({ user })
  },
}))
