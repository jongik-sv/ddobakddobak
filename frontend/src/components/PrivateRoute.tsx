import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

export default function PrivateRoute() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  return <Outlet />
}
