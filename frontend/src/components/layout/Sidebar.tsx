import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Mic, Search, Settings, PanelLeftClose } from 'lucide-react'
import { useUiStore } from '../../stores/uiStore'
import { useFolderStore } from '../../stores/folderStore'
import { useMeetingStore } from '../../stores/meetingStore'
import FolderTree from '../folder/FolderTree'

function navLinkClass({ isActive }: { isActive: boolean }) {
  const base = 'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors'
  const active = 'bg-primary text-primary-foreground'
  const inactive = 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
  return `${base} ${isActive ? active : inactive}`
}

export default function Sidebar() {
  const openSettings = useUiStore((s) => s.openSettings)
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const navigate = useNavigate()
  const location = useLocation()
  const isMeetingsPage = location.pathname.startsWith('/meetings')

  const handleMeetingsClick = (e: React.MouseEvent) => {
    e.preventDefault()
    useFolderStore.getState().setSelectedFolder('all')
    useMeetingStore.getState().setFolderId('all')
    useMeetingStore.getState().fetchMeetings(1)
    navigate('/meetings')
  }

  if (!sidebarOpen) return null

  return (
    <aside className="flex flex-col w-60 min-h-0 h-full bg-sidebar border-r border-border shrink-0">
      <div className="flex items-center justify-between h-14 px-4 border-b border-border shrink-0">
        <span className="text-lg font-bold text-foreground">또박또박</span>
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          title="사이드바 닫기"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <NavLink to="/dashboard" className={navLinkClass}>
          <LayoutDashboard className="w-4 h-4" />
          대시보드
        </NavLink>
        <NavLink to="/meetings" className={navLinkClass} onClick={handleMeetingsClick}>
          <Mic className="w-4 h-4" />
          회의 목록
        </NavLink>
        <NavLink to="/search" className={navLinkClass}>
          <Search className="w-4 h-4" />
          검색
        </NavLink>
        <div className={`pl-2 ${isMeetingsPage ? '' : 'hidden'}`}>
          <FolderTree />
        </div>
        <button
          onClick={openSettings}
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-muted-foreground hover:bg-accent hover:text-accent-foreground w-full"
        >
          <Settings className="w-4 h-4" />
          설정
        </button>
      </nav>
    </aside>
  )
}
