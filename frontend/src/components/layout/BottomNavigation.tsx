import { useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, FileText, Search, Settings, type LucideIcon } from 'lucide-react'
import { useUiStore } from '../../stores/uiStore'
import { cn } from '../../lib/utils'

interface NavItem {
  icon: LucideIcon
  label: string
  path: string
}

const NAV_ITEMS: NavItem[] = [
  { icon: LayoutDashboard, label: '홈', path: '/dashboard' },
  { icon: FileText, label: '회의', path: '/meetings' },
  { icon: Search, label: '검색', path: '/search' },
  { icon: Settings, label: '설정', path: '/settings' },
]

function isActive(itemPath: string, currentPath: string): boolean {
  if (itemPath === '/dashboard') {
    return currentPath === '/dashboard'
  }
  return currentPath.startsWith(itemPath)
}

interface BottomNavigationProps {
  className?: string
}

export default function BottomNavigation({ className }: BottomNavigationProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const openSettings = useUiStore((s) => s.openSettings)

  const handleNavClick = (item: NavItem) => {
    if (item.path === '/settings') {
      openSettings()
      return
    }
    navigate(item.path)
  }

  return (
    <nav
      className={cn(
        'fixed bottom-0 w-full h-14 bg-background/95 backdrop-blur-sm border-t z-40 pb-safe',
        className
      )}
      aria-label="모바일 내비게이션"
    >
      <div className="flex items-center justify-around h-full max-w-lg mx-auto">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.path, location.pathname)
          return (
            <button
              key={item.path}
              onClick={() => handleNavClick(item)}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 flex-1 h-full',
                'text-muted-foreground transition-colors',
                active && 'text-primary'
              )}
              aria-current={active ? 'page' : undefined}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
