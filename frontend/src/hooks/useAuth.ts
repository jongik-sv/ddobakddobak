import { useEffect, useCallback } from 'react'
import { open } from '@tauri-apps/plugin-shell'
import { useAuthStore } from '../stores/authStore'
import { useDeepLink } from './useDeepLink'
import {
  refreshAccessToken,
  logout as logoutApi,
  validateToken,
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

    validateToken(accessToken)
      .then((res) => {
        if (res.user) setUser(res.user)
        setTokens(accessToken, refreshToken || '')
        setLoading(false)
      })
      .catch(async () => {
        if (refreshToken) {
          try {
            const { access_token } = await refreshAccessToken(refreshToken)
            setAccessToken(access_token)
            markAuthenticated()
            // 새 토큰으로 사용자 정보 조회
            try {
              const res = await validateToken(access_token)
              if (res.user) setUser(res.user)
            } catch {}
            setLoading(false)
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
    logout,
  }
}
