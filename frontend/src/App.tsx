import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { loadAppSettings } from './stores/appSettingsStore'
import { usePromptTemplateStore } from './stores/promptTemplateStore'
import { useUiStore } from './stores/uiStore'
import DashboardPage from './pages/DashboardPage'
import MeetingsPage from './pages/MeetingsPage'
import MeetingLivePage from './pages/MeetingLivePage'
import MeetingPage from './pages/MeetingPage'
import AppLayout from './components/layout/AppLayout'
import SetupGate from './components/SetupGate'
import { AuthGuard } from './components/auth/AuthGuard'
import SettingsModal from './components/settings/SettingsModal'

function SettingsRedirect() {
  const openSettings = useUiStore((s) => s.openSettings)
  useEffect(() => { openSettings() }, [openSettings])
  return <Navigate to="/meetings" replace />
}

function App() {
  useEffect(() => {
    loadAppSettings()
    usePromptTemplateStore.getState().fetch()
  }, [])

  return (
    <SetupGate>
    <AuthGuard>
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
      <Route
        path="/meetings/:id/live"
        element={
          <AppLayout>
            <MeetingLivePage />
          </AppLayout>
        }
      />
      <Route path="/settings" element={<SettingsRedirect />} />
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
    <SettingsModal />
    </AuthGuard>
    </SetupGate>
  )
}

export default App
