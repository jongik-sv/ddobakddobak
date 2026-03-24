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

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
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
  )
}

export default App
