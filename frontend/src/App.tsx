import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { loadAppSettings } from './stores/appSettingsStore'
import DashboardPage from './pages/DashboardPage'
import MeetingsPage from './pages/MeetingsPage'
import MeetingLivePage from './pages/MeetingLivePage'
import MeetingPage from './pages/MeetingPage'
import SettingsPage from './pages/SettingsPage'
import AppLayout from './components/layout/AppLayout'
import SetupGate from './components/SetupGate'

function App() {
  useEffect(() => { loadAppSettings() }, [])

  return (
    <SetupGate>
    <Routes>
      <Route path="/" element={<Navigate to="/meetings" replace />} />
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
      <Route path="*" element={<Navigate to="/meetings" replace />} />
    </Routes>
    </SetupGate>
  )
}

export default App
