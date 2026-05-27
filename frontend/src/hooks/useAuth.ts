import { useEffect, useCallback } from 'react'
import { open } from '@tauri-apps/plugin-shell'
import { useAuthStore } from '../stores/authStore'
import { useDeepLink } from './useDeepLink'
import {
  refreshAccessToken,
  logout as logoutApi,
  validateToken,
  loginWithCredentials,
} from '../api/auth'
import { getMode, getServerUrl } from '../config'

const DEEP_LINK_SCHEME = 'ddobak://'
const LOGIN_PATH = '/auth/web_login'

export function useAuth() {
  const {
    accessToken,
    refreshToken,
    isAuthenticated,
    isLoading,
    user,
    setTokens,
    setAccessToken,
    markAuthenticated,
    clearAuth,
    setLoading,
    setUser,
  } = useAuthStore()

  // 딥링크 리스너 등록
  useDeepLink()

  // ── 앱 시작 시 토큰 검증 ──
  useEffect(() => {
    if (getMode() !== 'server') {
      // 로컬 모드: 서버에서 사용자 정보 가져오기
      validateToken('')
        .then((res) => {
          if (res.user) setUser(res.user)
        })
        .catch(() => {})
        .finally(() => setLoading(false))
      return
    }

    if (!accessToken) {
      setLoading(false)
      return
    }

    // 저장된 토큰이 있으면 즉시 진입시키고(앱 시작 시 '인증 확인 중' 대기 제거),
    // 토큰 검증은 백그라운드에서 수행한다. 실패 시 refresh, 그래도 실패면 로그아웃.
    markAuthenticated()
    setLoading(false)

    validateToken(accessToken)
      .then((res) => {
        if (res.user) setUser(res.user)
      })
      .catch(async () => {
        if (refreshToken) {
          try {
            const { access_token } = await refreshAccessToken(refreshToken)
            setAccessToken(access_token)
            const res = await validateToken(access_token)
            if (res.user) setUser(res.user)
          } catch {
            clearAuth()
          }
        } else {
          clearAuth()
        }
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- 앱 시작 시 1회만 실행

  // ── 로그인: 브라우저로 서버 로그인 페이지 열기 ──
  const login = useCallback(() => {
    const serverUrl = getServerUrl()
    const loginUrl = `${serverUrl}${LOGIN_PATH}?callback=${encodeURIComponent(DEEP_LINK_SCHEME)}`
    open(loginUrl)
  }, [])

  // ── 직접 로그인 (이메일/비밀번호) ──
  const loginDirect = useCallback(async (email: string, password: string) => {
    const res = await loginWithCredentials(email, password)
    setTokens(res.access_token, res.refresh_token)
    if (res.user) setUser(res.user as Parameters<typeof setUser>[0])
  }, [setTokens, setUser])

  // ── 로그아웃 ──
  const logout = useCallback(async () => {
    if (accessToken) {
      try {
        await logoutApi(accessToken)
      } catch {
        // 서버 로그아웃 실패해도 로컬 토큰은 삭제
      }
    }
    clearAuth()
  }, [accessToken, clearAuth])

  return {
    isAuthenticated,
    isLoading,
    user,
    login,
    loginDirect,
    logout,
  }
}
