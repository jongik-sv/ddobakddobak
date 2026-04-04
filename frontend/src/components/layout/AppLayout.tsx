import { type ReactNode } from 'react'
import { Menu, PanelLeft } from 'lucide-react'
import { useUiStore } from '../../stores/uiStore'
import Sidebar from './Sidebar'
import BottomNavigation from './BottomNavigation'
import MobileSidebarOverlay from './MobileSidebarOverlay'

interface AppLayoutProps {
  children: ReactNode
}

export default function AppLayout({ children }: AppLayoutProps) {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  const mobileMenuOpen = useUiStore((s) => s.mobileMenuOpen)
  const setMobileMenuOpen = useUiStore((s) => s.setMobileMenuOpen)

  return (
    <div className="flex flex-col lg:flex-row h-dvh bg-background overflow-hidden">
      {/* 데스크톱 사이드바 영역 - 모바일에서 hidden */}
      <div className="hidden lg:block">
        {sidebarOpen ? (
          <Sidebar />
        ) : (
          <div className="flex flex-col items-center w-10 border-r border-border bg-sidebar shrink-0 pt-3 h-full">
            <button
              onClick={toggleSidebar}
              className="p-2.5 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              title="사이드바 열기"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* 모바일 헤더 - 데스크톱에서 hidden */}
      <header className="flex lg:hidden items-center h-12 px-4 border-b border-border bg-background shrink-0">
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="p-2.5 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          aria-label="메뉴 열기"
        >
          <Menu className="w-5 h-5" />
        </button>
        <span className="ml-2 text-sm font-semibold">또박또박</span>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="flex-1 overflow-auto flex flex-col min-h-0 min-w-0 pb-14 lg:pb-0">
        {children}
      </main>

      {/* 모바일 사이드바 오버레이 */}
      {mobileMenuOpen && (
        <MobileSidebarOverlay onClose={() => setMobileMenuOpen(false)} />
      )}

      {/* 모바일 바텀 내비 - 데스크톱에서 hidden */}
      <BottomNavigation className="lg:hidden" />
    </div>
  )
}
