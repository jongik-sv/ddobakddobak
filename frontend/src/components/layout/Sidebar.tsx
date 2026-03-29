import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Mic, Settings } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useUiStore } from '../../stores/uiStore'

interface NavItem {
  to: string
  icon: LucideIcon
  label: string
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', icon: LayoutDashboard, label: '대시보드' },
  { to: '/meetings', icon: Mic, label: '회의 목록' },
]

function navLinkClass({ isActive }: { isActive: boolean }) {
  const base = 'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors'
  const active = 'bg-primary text-primary-foreground'
  const inactive = 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
  return `${base} ${isActive ? active : inactive}`
}

export default function Sidebar() {
  const openSettings = useUiStore((s) => s.openSettings)

  return (
    <aside className="hidden md:flex flex-col w-60 min-h-screen bg-sidebar border-r border-border">
      <div className="flex items-center h-16 px-6 border-b border-border">
        <span className="text-lg font-bold text-foreground">또박또박</span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} className={navLinkClass}>
            <Icon className="w-4 h-4" />
            {label}
          </NavLink>
        ))}
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
