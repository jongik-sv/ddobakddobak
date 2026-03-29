import { NavLink, useLocation } from 'react-router-dom'
import { LayoutDashboard, Mic, Settings } from 'lucide-react'
import { useUiStore } from '../../stores/uiStore'
import FolderTree from '../folder/FolderTree'

function navLinkClass({ isActive }: { isActive: boolean }) {
  const base = 'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors'
  const active = 'bg-primary text-primary-foreground'
  const inactive = 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
  return `${base} ${isActive ? active : inactive}`
}

export default function Sidebar() {
  const openSettings = useUiStore((s) => s.openSettings)
  const location = useLocation()
  const isMeetingsPage = location.pathname === '/meetings'

  return (
    <aside className="hidden md:flex flex-col w-60 min-h-screen bg-sidebar border-r border-border">
      <div className="flex items-center h-16 px-6 border-b border-border">
        <span className="text-lg font-bold text-foreground">또박또박</span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <NavLink to="/dashboard" className={navLinkClass}>
          <LayoutDashboard className="w-4 h-4" />
          대시보드
        </NavLink>
        <NavLink to="/meetings" className={navLinkClass}>
          <Mic className="w-4 h-4" />
          회의 목록
        </NavLink>
        {isMeetingsPage && (
          <div className="pl-2">
            <FolderTree />
          </div>
        )}
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
