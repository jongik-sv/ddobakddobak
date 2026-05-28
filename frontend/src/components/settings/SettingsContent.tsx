import { useState } from 'react'
import { getMode } from '../../config'
import { useAuthStore } from '../../stores/authStore'
import PersonalSettingsTab from './PersonalSettingsTab'
import GlobalSettingsTab from './GlobalSettingsTab'

export default function SettingsContent() {
  const user = useAuthStore((s) => s.user)
  const isLocalMode = getMode() === 'local'
  const isAdmin = user?.role === 'admin'
  const showAdminSettings = isAdmin || isLocalMode
  // 로컬모드/로컬계정(desktop@local)은 자동 로그인이라 비밀번호 변경 불필요
  const showPasswordSection = getMode() !== 'local' && user?.email !== 'desktop@local'

  const [tab, setTab] = useState<'personal' | 'global'>('personal')

  // 일반 사용자는 전역 탭이 없으므로 탭바 없이 개인 설정만 노출
  if (!showAdminSettings) {
    return <PersonalSettingsTab showPasswordSection={showPasswordSection} />
  }

  return (
    <div className="space-y-6">
      <div role="tablist" className="flex gap-1 border-b">
        <button
          role="tab"
          aria-selected={tab === 'personal'}
          onClick={() => setTab('personal')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'personal'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          개인설정
        </button>
        <button
          role="tab"
          aria-selected={tab === 'global'}
          onClick={() => setTab('global')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'global'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          전역설정
        </button>
      </div>

      {tab === 'personal' ? (
        <PersonalSettingsTab showPasswordSection={showPasswordSection} />
      ) : (
        <GlobalSettingsTab />
      )}
    </div>
  )
}
