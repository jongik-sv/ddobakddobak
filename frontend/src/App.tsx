import { Routes, Route, Navigate } from 'react-router-dom'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import DashboardPage from './pages/DashboardPage'
import MeetingsPage from './pages/MeetingsPage'
import MeetingLivePage from './pages/MeetingLivePage'
import MeetingPage from './pages/MeetingPage'
import SettingsPage from './pages/SettingsPage'
import PrivateRoute from './components/PrivateRoute'
import AppLayout from './components/layout/AppLayout'
import SetupGate from './components/SetupGate'
import { IS_TAURI } from './config'

function App() {
  return (
    <SetupGate>
    <Routes>
      {/* Tauri: 홈/로그인/가입 → 바로 회의 목록으로 */}
      <Route path="/" element={IS_TAURI ? <Navigate to="/meetings" replace /> : <HomePage />} />
      <Route path="/login" element={IS_TAURI ? <Navigate to="/meetings" replace /> : <LoginPage />} />
      <Route path="/signup" element={IS_TAURI ? <Navigate to="/meetings" replace /> : <SignupPage />} />
      <Route element={<PrivateRoute />}>
        <Route
          path="/dashboard"
          element={
            <AppLayout>
              <DashboardPage />
            </AppLayout>
          }
        />
        <Route
          path="/meetings"
          element={
            <AppLayout>
              <MeetingsPage />
            </AppLayout>
          }
        />
        <Route path="/meetings/:id/live" element={<MeetingLivePage />} />
        <Route
          path="/settings"
          element={
            <AppLayout>
              <SettingsPage />
            </AppLayout>
          }
        />
        <Route
          path="/meetings/:id"
          element={
            <AppLayout>
              <MeetingPage />
            </AppLayout>
          }
        />
      </Route>
      <Route path="/teams" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </SetupGate>
  )
}

export default App
