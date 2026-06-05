import { type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
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

  // 특정 회의 안쪽 화면(녹음/뷰어/상세)에서는 하단 내비를 숨긴다 — 자체 헤더/뒤로가기가 있는 몰입 화면.
  // 온라인 /meetings/:id(+/live,/viewer) 와 오프라인 /local-meetings/:id(+/live) 모두. 목록(/local-meetings)은 유지.
  const location = useLocation()
  const hideBottomNav = /^\/meetings\/\d+|^\/local-meetings\/[^/]+/.test(location.pathname)

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
      <header className="flex lg:hidden items-center min-h-10 px-4 border-b border-border bg-white shrink-0">
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="p-2 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          aria-label="메뉴 열기"
        >
          <Menu className="w-5 h-5" />
        </button>
        <span className="ml-2 text-sm font-semibold">또박또박</span>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="flex-1 overflow-auto flex flex-col min-h-0 min-w-0">
        {children}
        {/* 바텀 내비 높이만큼 실제 스페이서 — 스크롤 컨테이너의 하단 padding은
            일부 모바일 WebView에서 스크롤 영역에 포함되지 않아 마지막 콘텐츠가 가려진다 */}
        {!hideBottomNav && (
          <div
            aria-hidden
            data-testid="bottom-nav-spacer"
            className="lg:hidden shrink-0 h-[calc(3.5rem+env(safe-area-inset-bottom))]"
          />
        )}
      </main>

      {/* 모바일 사이드바 오버레이 */}
      {mobileMenuOpen && (
        <MobileSidebarOverlay onClose={() => setMobileMenuOpen(false)} />
      )}

      {/* 모바일 바텀 내비 - 데스크톱에서 hidden, 회의 안쪽 화면에서는 숨김 */}
      {!hideBottomNav && <BottomNavigation className="lg:hidden" />}
    </div>
  )
}
