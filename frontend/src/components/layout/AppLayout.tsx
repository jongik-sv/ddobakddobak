import { type ReactNode } from 'react'
import Sidebar from './Sidebar'
import Header from './Header'

interface AppLayoutProps {
  children: ReactNode
}

/**
 * AppLayout - 앱 전체 레이아웃 wrapper
 * Sidebar (좌측), Header (상단), main (콘텐츠 영역)으로 구성
 */
export default function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <Header />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
