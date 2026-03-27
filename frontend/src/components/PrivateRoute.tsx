import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { IS_TAURI } from '../config'

export default function PrivateRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  // 데스크톱 앱: 로그인 없이 통과
  if (IS_TAURI || isAuthenticated) {
    return <Outlet />
  }
  return <Navigate to="/login" replace />
}
