import { type ReactNode } from 'react'
import { PanelLeft } from 'lucide-react'
import { useUiStore } from '../../stores/uiStore'
import Sidebar from './Sidebar'

interface AppLayoutProps {
  children: ReactNode
}

export default function AppLayout({ children }: AppLayoutProps) {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {sidebarOpen ? (
        <Sidebar />
      ) : (
        <div className="flex flex-col items-center w-10 border-r border-border bg-sidebar shrink-0 pt-3">
          <button
            onClick={toggleSidebar}
            className="p-2.5 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            title="사이드바 열기"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        </div>
      )}
      <main className="flex-1 overflow-auto flex flex-col min-h-0 min-w-0">
        {children}
      </main>
    </div>
  )
}
