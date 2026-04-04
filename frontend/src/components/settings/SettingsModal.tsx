import { useEffect, useState } from 'react'
import { X, Settings, Users } from 'lucide-react'
import { useUiStore } from '../../stores/uiStore'
import { useAuthStore } from '../../stores/authStore'
import SettingsContent from './SettingsContent'
import UserManagementPanel from './UserManagementPanel'

type SettingsTab = 'general' | 'users'

export default function SettingsModal() {
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const closeSettings = useUiStore((s) => s.closeSettings)
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'

  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

  // 관리자가 아닌데 users 탭이면 general로 돌아감
  useEffect(() => {
    if (!isAdmin && activeTab === 'users') setActiveTab('general')
  }, [isAdmin, activeTab])

  useEffect(() => {
    if (!settingsOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [settingsOpen, closeSettings])

  // 모달 닫힐 때 탭 초기화
  useEffect(() => {
    if (!settingsOpen) setActiveTab('general')
  }, [settingsOpen])

  if (!settingsOpen) return null

  const tabs = [
    { id: 'general' as const, label: '일반 설정', icon: Settings },
    ...(isAdmin
      ? [{ id: 'users' as const, label: '사용자 관리', icon: Users }]
      : []),
  ]

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="relative w-full max-w-3xl max-h-[90vh] rounded-xl bg-white shadow-2xl border border-gray-100 flex flex-col mx-4">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">설정</h2>
          <button
            onClick={closeSettings}
            className="p-2.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 탭 바 (admin인 경우에만 표시) */}
        {tabs.length > 1 && (
          <div className="flex border-b px-6 shrink-0">
            {tabs.map((tab) => {
              const Icon = tab.icon
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    flex items-center gap-1.5 px-4 py-3 min-h-[44px] text-sm font-medium border-b-2 transition-colors -mb-px
                    ${active
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }
                  `}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              )
            })}
          </div>
        )}

        {/* 스크롤 가능 본문 */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'general' && <SettingsContent />}
          {activeTab === 'users' && isAdmin && <UserManagementPanel />}
        </div>
      </div>
    </div>
  )
}
