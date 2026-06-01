import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Mic, Search, Settings, Users, PanelLeftClose, LogOut, WifiOff } from 'lucide-react'
import { useUiStore } from '../../stores/uiStore'
import { useAuth } from '../../hooks/useAuth'
import { getMode, IS_MOBILE, IS_TAURI } from '../../config'
import { useFolderStore } from '../../stores/folderStore'
import { useMeetingStore } from '../../stores/meetingStore'
import FolderTree from '../folder/FolderTree'

function navLinkClass({ isActive }: { isActive: boolean }) {
  const base = 'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors'
  const active = 'bg-primary text-primary-foreground'
  const inactive = 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
  return `${base} ${isActive ? active : inactive}`
}

interface SidebarProps {
  /** 모바일 오버레이로 렌더링 — 데스크톱 접힘 상태(sidebarOpen)와 무관하게 항상 표시 */
  mobile?: boolean
  /** 모바일 오버레이 닫기 콜백 (닫기 버튼/내비 이동 시 호출) */
  onClose?: () => void
}

export default function Sidebar({ mobile = false, onClose }: SidebarProps = {}) {
  const openSettings = useUiStore((s) => s.openSettings)
  const openUserMgmt = useUiStore((s) => s.openUserMgmt)
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const { logout, user } = useAuth()
  const isServerMode = getMode() === 'server'
  const navigate = useNavigate()
  const location = useLocation()
  const isMeetingsPage = location.pathname.startsWith('/meetings')
  // 사용자 관리: 설정 모달과 동일 게이팅(admin 또는 local 모드), 모바일 미노출
  const canManageUsers = (user?.role === 'admin' || getMode() === 'local') && !IS_MOBILE

  // 모바일 오버레이에서 내비 이동/액션 시 오버레이를 닫는다
  const closeIfMobile = () => {
    if (mobile) onClose?.()
  }

  const handleMeetingsClick = (e: React.MouseEvent) => {
    e.preventDefault()
    useFolderStore.getState().setSelectedFolder('all')
    useMeetingStore.getState().setFolderId('all')
    useMeetingStore.getState().fetchMeetings(1)
    navigate('/meetings')
    closeIfMobile()
  }

  // 데스크톱: 접힘 상태면 렌더 안 함. 모바일 오버레이는 항상 표시.
  if (!mobile && !sidebarOpen) return null

  return (
    <aside className="flex flex-col w-60 min-h-0 h-full bg-sidebar border-r border-border shrink-0">
      <div className="flex items-center justify-between min-h-14 px-4 border-b border-border shrink-0 pt-safe">
        <span className="text-lg font-bold text-foreground">또박또박</span>
        <button
          onClick={() => (mobile ? onClose?.() : toggleSidebar())}
          className="p-2.5 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          title="사이드바 닫기"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <NavLink to="/dashboard" className={navLinkClass} onClick={closeIfMobile}>
          <LayoutDashboard className="w-4 h-4" />
          대시보드
        </NavLink>
        <NavLink to="/meetings" className={navLinkClass} onClick={handleMeetingsClick}>
          <Mic className="w-4 h-4" />
          회의 목록
        </NavLink>
        <NavLink to="/search" className={navLinkClass} onClick={closeIfMobile}>
          <Search className="w-4 h-4" />
          검색
        </NavLink>
        {/* 오프라인(온디바이스) 회의 전용 진입 — Android(Tauri 모바일)에서만. 전용 홈(/local-meetings). */}
        {IS_TAURI && IS_MOBILE && (
          <NavLink to="/local-meetings" className={navLinkClass} onClick={closeIfMobile}>
            <WifiOff className="w-4 h-4" />
            오프라인 회의
          </NavLink>
        )}
        <div className={`pl-2 ${isMeetingsPage ? '' : 'hidden'}`}>
          <FolderTree />
        </div>
        <button
          onClick={() => { openSettings(); closeIfMobile() }}
          className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors text-muted-foreground hover:bg-accent hover:text-accent-foreground w-full"
        >
          <Settings className="w-4 h-4" />
          설정
        </button>
        {canManageUsers && (
          <button
            onClick={() => { openUserMgmt(); closeIfMobile() }}
            className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors text-muted-foreground hover:bg-accent hover:text-accent-foreground w-full"
          >
            <Users className="w-4 h-4" />
            사용자 관리
          </button>
        )}
      </nav>
      {isServerMode && (
        <div className="px-3 py-3 border-t border-border shrink-0">
          {user && (
            <p className="px-3 mb-2 text-xs text-muted-foreground truncate">{user.name || user.email}</p>
          )}
          <button
            onClick={logout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors text-muted-foreground hover:bg-accent hover:text-accent-foreground w-full"
          >
            <LogOut className="w-4 h-4" />
            로그아웃
          </button>
        </div>
      )}
    </aside>
  )
}
