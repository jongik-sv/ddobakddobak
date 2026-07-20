import { useEffect, lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { loadAppSettings } from './stores/appSettingsStore'
import { usePromptTemplateStore } from './stores/promptTemplateStore'
import { useUiStore } from './stores/uiStore'
import MeetingsPage from './pages/MeetingsPage'
import AppLayout from './components/layout/AppLayout'
import SetupGate from './components/SetupGate'
import { AuthGuard } from './components/auth/AuthGuard'
import SettingsModal from './components/settings/SettingsModal'
import UserManagementModal from './components/settings/UserManagementModal'
import { FolderChatDrawer } from './components/folder/FolderChatDrawer'
import { useRecordingRecovery } from './hooks/useRecordingRecovery'
import { ScheduledMeetingWatcher } from './components/ScheduledMeetingWatcher'
import { ClosePrompt } from './components/ClosePrompt'
import { RecordingLayer } from './components/recording/RecordingLayer'

// 무거운/비랜딩 페이지는 지연 로드해 초기 App 청크에서 분리한다(@blocknote·lamejs 등).
// 랜딩(/meetings = MeetingsPage)은 eager 유지 — 첫 페인트 경로는 그대로.
// import 썽크를 한 곳(load)에 모아 lazy()와 idle prefetch가 동일 청크를 공유하게 한다.
const load = {
  DashboardPage: () => import('./pages/DashboardPage'),
  MeetingLivePage: () => import('./pages/MeetingLivePage'),
  LocalMeetingLivePage: () => import('./pages/LocalMeetingLivePage'),
  LocalMeetingDetailPage: () => import('./pages/LocalMeetingDetailPage'),
  LocalMeetingsHome: () => import('./pages/LocalMeetingsHome'),
  MeetingPage: () => import('./pages/MeetingPage'),
  MeetingViewerPage: () => import('./pages/MeetingViewerPage'),
  SearchPage: () => import('./pages/SearchPage'),
  ProjectsPage: () => import('./pages/ProjectsPage'),
  TrashPage: () => import('./pages/TrashPage'),
  InviteRedeemPage: () => import('./pages/InviteRedeemPage'),
  ProjectSelectLanding: () => import('./pages/ProjectSelectLanding'),
}

const DashboardPage = lazy(load.DashboardPage)
const MeetingLivePage = lazy(load.MeetingLivePage)
const LocalMeetingLivePage = lazy(load.LocalMeetingLivePage)
const LocalMeetingDetailPage = lazy(load.LocalMeetingDetailPage)
const LocalMeetingsHome = lazy(load.LocalMeetingsHome)
const MeetingPage = lazy(load.MeetingPage)
const MeetingViewerPage = lazy(load.MeetingViewerPage)
const SearchPage = lazy(load.SearchPage)
const ProjectsPage = lazy(load.ProjectsPage)
const TrashPage = lazy(load.TrashPage)
const InviteRedeemPage = lazy(load.InviteRedeemPage)
const ProjectSelectLanding = lazy(load.ProjectSelectLanding)

/** 지연 로드 페이지 래퍼. fallback=null — 새 스피너 UI를 도입하지 않고(셸은 그대로 렌더),
 *  청크 로딩 중 페이지 영역만 잠깐 비운다. idle prefetch로 콜드 진입 창은 사실상 사라진다. */
function Suspended({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>
}

/** 인증 직후 1회: 강제종료로 업로드 누락된 데스크톱 녹음을 복구 업로드한다. */
function RecordingRecovery() {
  useRecordingRecovery()
  return null
}

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

  // 전역 파일-드롭 가드: 파일을 창 아무 곳에나 떨궈도 WKWebView/브라우저가 그 파일로
  // 네비게이트(파일 풀스크린 표시)하지 않게 막는다. 지정 드롭존(IconPicker·AddFileDialog 등)은
  // 자체 onDrop에서 먼저 처리하고 이 가드로 버블되므로 영향 없음.
  // 반드시 preventDefault만 — stopPropagation을 쓰면 안쪽 드롭존이 죽는다. 파일 드래그에만 적용.
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', guard)
    window.addEventListener('drop', guard)
    return () => {
      window.removeEventListener('dragover', guard)
      window.removeEventListener('drop', guard)
    }
  }, [])

  // 첫 페인트 후 idle 시간에 지연 페이지 청크를 미리 받아둔다 → 실제 네비게이션 시 스피너/공백 없음.
  useEffect(() => {
    const warm = () => { for (const fn of Object.values(load)) void fn() }
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void) => number
      cancelIdleCallback?: (id: number) => void
    }
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(warm)
      return () => w.cancelIdleCallback?.(id)
    }
    const id = window.setTimeout(warm, 1500)
    return () => window.clearTimeout(id)
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
            <Suspended><LocalMeetingsHome /></Suspended>
          </OfflineShell>
        }
      />
      <Route
        path="/local-meetings/:localId/live"
        element={
          <OfflineShell>
            <Suspended><LocalMeetingLivePage /></Suspended>
          </OfflineShell>
        }
      />
      <Route
        path="/local-meetings/:localId"
        element={
          <OfflineShell>
            <Suspended><LocalMeetingDetailPage /></Suspended>
          </OfflineShell>
        }
      />

      {/* 프로젝트 초대 리딤 — GatedApp **밖**(로그아웃 상태에서도 접근 가능해야 함:
          비회원이 초대 링크로 가입+합류). 서버 설정/인증 게이트를 거치지 않는다. */}
      <Route
        path="/invite/:code"
        element={<Suspended><InviteRedeemPage /></Suspended>}
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
      {/* 로그인 후 첫 화면 = 프로젝트 선택 랜딩. 전용 전체화면이라 의도적으로 AppLayout(사이드바 쉘) 미적용. */}
      <Route path="/" element={<Suspended><ProjectSelectLanding /></Suspended>} />
      <Route
        path="/dashboard"
        element={
          <AppLayout>
            <Suspended><DashboardPage /></Suspended>
          </AppLayout>
        }
      />
      <Route
        path="/search"
        element={
          <AppLayout>
            <Suspended><SearchPage /></Suspended>
          </AppLayout>
        }
      />
      <Route
        path="/projects"
        element={
          <AppLayout>
            <Suspended><ProjectsPage /></Suspended>
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
            <Suspended><MeetingLivePage /></Suspended>
          </AppLayout>
        }
      />
      <Route
        path="/meetings/:id/viewer"
        element={
          <AppLayout>
            <Suspended><MeetingViewerPage /></Suspended>
          </AppLayout>
        }
      />
      <Route
        path="/trash"
        element={
          <AppLayout>
            <Suspended><TrashPage /></Suspended>
          </AppLayout>
        }
      />
      <Route path="/settings" element={<SettingsRedirect />} />
      <Route
        path="/meetings/:id"
        element={
          <AppLayout>
            <Suspended><MeetingPage /></Suspended>
          </AppLayout>
        }
      />
      <Route path="*" element={<Navigate to="/meetings" replace />} />
    </Routes>
    <RecordingRecovery />
    <ScheduledMeetingWatcher />
    <ClosePrompt />
    <RecordingLayer />
    <SettingsModal />
    <UserManagementModal />
    {/* 폴더/프로젝트 챗 드로어 — Routes와 형제인 글로벌 영역에 단일 마운트.
        회의 상세(/meetings/:id)로 이동해도 드로어가 언마운트되지 않는다(idea.md #35 2단계). */}
    <FolderChatDrawer />
    </AuthGuard>
    </SetupGate>
  )
}

export default App
