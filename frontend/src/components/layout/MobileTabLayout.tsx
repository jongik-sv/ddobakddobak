import { useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface Tab {
  id: string
  label: string
  icon: LucideIcon
  content: ReactNode
}

export interface MobileTabLayoutProps {
  tabs: Tab[]
  defaultTab?: string
  /** 제어 모드: 외부에서 활성 탭을 지정 */
  activeTab?: string
  /** 제어 모드: 탭 전환 시 콜백 */
  onTabChange?: (tabId: string) => void
}

export default function MobileTabLayout({
  tabs,
  defaultTab,
  activeTab: controlledTab,
  onTabChange,
}: MobileTabLayoutProps) {
  const [internalTab, setInternalTab] = useState(defaultTab ?? tabs[0]?.id)

  const isControlled = controlledTab !== undefined
  const currentTab = isControlled ? controlledTab : internalTab

  function handleTabClick(tabId: string) {
    if (!isControlled) {
      setInternalTab(tabId)
    }
    onTabChange?.(tabId)
  }

  return (
    <div className="flex flex-col h-full">
      {/* 탭 바 */}
      <div
        role="tablist"
        className="h-10 sticky top-0 z-10 flex bg-background border-b border-border"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === currentTab
          const Icon = tab.icon
          const activeClass = 'border-b-2 border-primary text-primary'
          const inactiveClass = 'text-muted-foreground'
          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              className={`flex-1 flex items-center justify-center gap-1 text-xs transition-colors ${
                isActive ? activeClass : inactiveClass
              }`}
              onClick={() => handleTabClick(tab.id)}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* 콘텐츠 영역 */}
      <div data-content-area className="flex-1 overflow-auto relative">
        {tabs.map((tab) => {
          const isActive = tab.id === currentTab
          return (
            <div
              key={tab.id}
              role="tabpanel"
              id={`tabpanel-${tab.id}`}
              aria-labelledby={`tab-${tab.id}`}
              data-tab-id={tab.id}
              className={
                isActive
                  ? 'relative h-full'
                  : 'absolute inset-0 h-full'
              }
              style={{ visibility: isActive ? 'visible' : 'hidden' }}
            >
              {tab.content}
            </div>
          )
        })}
      </div>
    </div>
  )
}
