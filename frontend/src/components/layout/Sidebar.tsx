import { useCallback } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Mic, Search, Settings, Users, PanelLeftClose, LogOut, WifiOff, Trash2 } from 'lucide-react'
import { useUiStore } from '../../stores/uiStore'
import { useAuth } from '../../hooks/useAuth'
import { getMode, IS_MOBILE, IS_TAURI } from '../../config'
import FolderTree from '../folder/FolderTree'
import ProjectSwitcher from '../project/ProjectSwitcher'
import ThemeToggle from './ThemeToggle'
import { folderPath } from '../../lib/folderNav'

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
  const sidebarWidth = useUiStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth)
  const { logout, user } = useAuth()
  const isServerMode = getMode() === 'server'
  const navigate = useNavigate()
  // 사용자 관리: 설정 모달과 동일 게이팅(admin 또는 local 모드), 모바일 미노출
  const canManageUsers = (user?.role === 'admin' || getMode() === 'local') && !IS_MOBILE

  // 모바일 오버레이에서 내비 이동/액션 시 오버레이를 닫는다
  const closeIfMobile = () => {
    if (mobile) onClose?.()
  }

  // 우측 경계 드래그로 사이드바 폭 조절(데스크톱). 폭은 uiStore가 localStorage에 영속.
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = useUiStore.getState().sidebarWidth
    const onMove = (ev: MouseEvent) => setSidebarWidth(startW + (ev.clientX - startX))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [setSidebarWidth])

  const handleMeetingsClick = (e: React.MouseEvent) => {
    e.preventDefault()
    // 전체 회의로 이동(URL이 폴더 선택의 단일 소스). 상태 반영·fetch는 MeetingsPage가 담당.
    navigate(folderPath('all'))
    closeIfMobile()
  }

  // 데스크톱: 접힘 상태면 렌더 안 함. 모바일 오버레이는 항상 표시.
  if (!mobile && !sidebarOpen) return null

  return (
    <aside
      className={`relative flex flex-col min-h-0 h-full bg-sidebar border-r border-border shrink-0 ${mobile ? 'w-60' : ''}`}
      style={mobile ? undefined : { width: sidebarWidth }}
    >
      {!mobile && (
        <div
          onMouseDown={startResize}
          className="absolute top-0 right-0 z-20 h-full w-1.5 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors"
          title="드래그하여 사이드바 폭 조절"
        />
      )}
      <div className="flex items-center justify-between min-h-14 px-4 border-b border-border shrink-0 pt-safe">
        <div className="flex-1 min-w-0 mr-2"><ProjectSwitcher /></div>
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
        <NavLink to="/search" className={navLinkClass} onClick={closeIfMobile}>
          <Search className="w-4 h-4" />
          검색
        </NavLink>
        <NavLink to="/meetings" className={navLinkClass} onClick={handleMeetingsClick}>
          <Mic className="w-4 h-4" />
          회의 목록
        </NavLink>
        <div className="pl-2">
          <FolderTree />
        </div>
        {/* 오프라인(온디바이스) 회의 전용 진입 — Android(Tauri 모바일)에서만. 전용 홈(/local-meetings). */}
        {IS_TAURI && IS_MOBILE && (
          <NavLink to="/local-meetings" className={navLinkClass} onClick={closeIfMobile}>
            <WifiOff className="w-4 h-4" />
            오프라인 회의
          </NavLink>
        )}
      </nav>
      <div className="px-3 py-3 border-t border-border shrink-0 space-y-1 pb-safe">
        <ThemeToggle />
        <NavLink to="/trash" className={navLinkClass} onClick={closeIfMobile}>
          <Trash2 className="w-4 h-4" />
          휴지통
        </NavLink>
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
        {isServerMode && (
          <>
            {user && (
              <p className="px-3 pt-2 mb-1 text-xs text-muted-foreground truncate">{user.name || user.email}</p>
            )}
            <button
              onClick={logout}
              className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors text-muted-foreground hover:bg-accent hover:text-accent-foreground w-full"
            >
              <LogOut className="w-4 h-4" />
              로그아웃
            </button>
          </>
        )}
      </div>
    </aside>
  )
}
