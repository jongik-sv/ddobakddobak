import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { loadAppSettings } from './stores/appSettingsStore'
import { usePromptTemplateStore } from './stores/promptTemplateStore'
import { useUiStore } from './stores/uiStore'
import DashboardPage from './pages/DashboardPage'
import MeetingsPage from './pages/MeetingsPage'
import MeetingLivePage from './pages/MeetingLivePage'
import LocalMeetingLivePage from './pages/LocalMeetingLivePage'
import LocalMeetingDetailPage from './pages/LocalMeetingDetailPage'
import LocalMeetingsHome from './pages/LocalMeetingsHome'
import MeetingPage from './pages/MeetingPage'
import MeetingViewerPage from './pages/MeetingViewerPage'
import SearchPage from './pages/SearchPage'
import AppLayout from './components/layout/AppLayout'
import SetupGate from './components/SetupGate'
import { AuthGuard } from './components/auth/AuthGuard'
import SettingsModal from './components/settings/SettingsModal'
import UserManagementModal from './components/settings/UserManagementModal'

function SettingsRedirect() {
  const openSettings = useUiStore((s) => s.openSettings)
  useEffect(() => { openSettings() }, [openSettings])
  return <Navigate to="/meetings" replace />
}

/**
 * 오프라인 라우트 셸 — AppLayout(사이드바 포함) + 단일 <SettingsModal offline/>.
 *
 * 오프라인 라우트는 GatedApp **밖**이라 GatedApp 안의 <SettingsModal/>가 안 닿는다(#5:
 * 오프라인 사이드바 설정이 죽음). 여기서 element 레벨에 모달을 함께 마운트해 살린다.
 * 한 번에 한 최상위 라우트만 매칭되므로 GatedApp 모달과 이중마운트되지 않는다.
 * offline prop은 SettingsModal이 오프라인 안전 탭만 노출하도록 신호(다른 에이전트 구현).
 */
function OfflineShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppLayout>{children}</AppLayout>
      <SettingsModal offline />
    </>
  )
}

function App() {
  useEffect(() => {
    loadAppSettings()
    usePromptTemplateStore.getState().fetch()
  }, [])

  return (
    <Routes>
      {/* 오프라인(온디바이스) 라우트 — SetupGate/AuthGuard **밖**에서 렌더한다.
          서버를 한 번도 못 본 상태에서도 진입 가능해야 하므로(완전 오프라인 생성).
          서버 의존 없음: localStore(fs) + 온디바이스 STT만 사용. */}
      <Route
        path="/local-meetings"
        element={
          <OfflineShell>
            <LocalMeetingsHome />
          </OfflineShell>
        }
      />
      <Route
        path="/local-meetings/:localId/live"
        element={
          <OfflineShell>
            <LocalMeetingLivePage />
          </OfflineShell>
        }
      />
      <Route
        path="/local-meetings/:localId"
        element={
          <OfflineShell>
            <LocalMeetingDetailPage />
          </OfflineShell>
        }
      />

      {/* 그 외 전부 = 기존 게이트(서버 설정 + 인증) 적용. 무변경. */}
      <Route path="*" element={<GatedApp />} />
    </Routes>
  )
}

/** 기존 게이트(SetupGate+AuthGuard) 적용 라우트 묶음. 변경 없음. */
function GatedApp() {
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
        path="/search"
        element={
          <AppLayout>
            <SearchPage />
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
      <Route
        path="/meetings/:id/viewer"
        element={
          <AppLayout>
            <MeetingViewerPage />
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
    <UserManagementModal />
    </AuthGuard>
    </SetupGate>
  )
}

export default App
