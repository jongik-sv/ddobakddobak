import { create } from 'zustand'

// ── State ──
interface AuthStateData {
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  /** 앱 시작 시 토큰 검증 중 로딩 상태 */
  isLoading: boolean
}

// ── Actions ──
interface AuthActions {
  setTokens: (accessToken: string, refreshToken: string) => void
  setAccessToken: (accessToken: string) => void
  markAuthenticated: () => void
  clearAuth: () => void
  setLoading: (loading: boolean) => void
}

type AuthState = AuthStateData & AuthActions

const ACCESS_TOKEN_KEY = 'access_token'
const REFRESH_TOKEN_KEY = 'refresh_token'

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: localStorage.getItem(ACCESS_TOKEN_KEY),
  refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY),
  isAuthenticated: false,
  isLoading: true,

  setTokens: (accessToken, refreshToken) => {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
    set({ accessToken, refreshToken, isAuthenticated: true })
  },

  setAccessToken: (accessToken) => {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
    set({ accessToken })
  },

  markAuthenticated: () => set({ isAuthenticated: true }),

  clearAuth: () => {
    localStorage.removeItem(ACCESS_TOKEN_KEY)
    localStorage.removeItem(REFRESH_TOKEN_KEY)
    set({
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
    })
  },

  setLoading: (loading) => set({ isLoading: loading }),
}))
