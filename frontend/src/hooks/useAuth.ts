import { useAuthStore } from '../stores/authStore'

/**
 * useAuth - 인증 상태 접근 훅
 * authStore를 통해 인증 상태와 액션을 제공
 */
export function useAuth() {
  const { user, token, isAuthenticated, login, setUser, setToken, logout } = useAuthStore()

  return {
    user,
    token,
    isAuthenticated,
    login,
    setUser,
    setToken,
    logout,
  }
}
