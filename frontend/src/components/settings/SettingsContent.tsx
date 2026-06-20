import { useState } from 'react'
import { getMode } from '../../config'
import { useAuthStore } from '../../stores/authStore'
import PersonalSettingsTab from './PersonalSettingsTab'
import { LlmSettingsPanel } from './LlmSettingsPanel'
import VoiceSettingsTab from './VoiceSettingsTab'
import MeetingSettingsTab from './MeetingSettingsTab'
import UserSttSettings from './UserSttSettings'

interface Props {
  /**
   * 오프라인(서버 0) 진입 — 서버 fetch 패널(LLM·언어·비밀번호·전역탭)을 모두 숨기고
   * 클라이언트-디바이스 전용 패널(UserSttSettings, 내부에 ModelManager 포함)만 렌더한다.
   * 미지정(온라인) 시 기존 동작 완전 동일.
   */
  offline?: boolean
}

export default function SettingsContent({ offline = false }: Props = {}) {
  const user = useAuthStore((s) => s.user)
  const isLocalMode = getMode() === 'local'
  const isAdmin = user?.role === 'admin'
  const showAdminSettings = isAdmin || isLocalMode
  // 로컬모드/로컬계정(desktop@local)은 자동 로그인이라 비밀번호 변경 불필요
  const showPasswordSection = getMode() !== 'local' && user?.email !== 'desktop@local'

  const [tab, setTab] = useState<'personal' | 'llm' | 'voice' | 'meeting'>('personal')

  // 오프라인: 서버 fetch 패널은 모두 행/에러를 내므로 클라이언트-디바이스 전용 패널만 단일 컬럼으로.
  // UserSttSettings 안에 ModelManager(모델 다운로드·관리)가 포함되어 있다.
  if (offline) {
    return (
      <div className="max-w-2xl space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">오프라인 설정</h2>
          <p className="text-sm text-gray-500">
            온디바이스 STT 모델과 인식 방식을 설정합니다. (서버 연동 설정은 온라인에서 변경하세요.)
          </p>
        </div>
        <UserSttSettings />
      </div>
    )
  }

  // 일반 사용자는 전역 탭이 없으므로 탭바 없이 개인 설정만 노출
  if (!showAdminSettings) {
    return <PersonalSettingsTab showPasswordSection={showPasswordSection} />
  }

  const TABS = [
    { id: 'personal', label: '개인설정' },
    { id: 'llm', label: 'LLM' },
    { id: 'voice', label: '음성·인식' },
    { id: 'meeting', label: '회의록 설정' },
  ] as const

  return (
    <div className="space-y-6">
      <div role="tablist" className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'personal' && <PersonalSettingsTab showPasswordSection={showPasswordSection} />}
      {tab === 'llm' && <div className="max-w-2xl"><LlmSettingsPanel /></div>}
      {tab === 'voice' && <VoiceSettingsTab />}
      {tab === 'meeting' && <MeetingSettingsTab />}
    </div>
  )
}
