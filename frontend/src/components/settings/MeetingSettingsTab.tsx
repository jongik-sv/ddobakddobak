import { useEffect, useState } from 'react'
import { IS_TAURI, getMode } from '../../config'
import PromptTemplateManager from '../PromptTemplateManager'
import MeetingTemplateManager from './MeetingTemplateManager'

/** 회의록 설정 탭: 데스크톱 자동시작 · 회의 템플릿 · 회의록 양식 */
export default function MeetingSettingsTab() {
  const [autostart, setAutostart] = useState(false)

  useEffect(() => {
    if (!IS_TAURI || getMode() !== 'local') return
    import('@tauri-apps/plugin-autostart')
      .then(({ isEnabled }) => isEnabled())
      .then((on) => setAutostart(on))
      .catch(() => {})
  }, [])

  async function handleAutostartChange(checked: boolean) {
    const { enable, disable } = await import('@tauri-apps/plugin-autostart')
    checked ? await enable() : await disable()
    setAutostart(checked)
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* 자동시작 (로컬 데스크톱 앱에서만 표시) */}
      {IS_TAURI && getMode() === 'local' && (
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold mb-1">앱 자동시작</h2>
          <p className="text-sm text-muted-foreground mb-4">
            로그인 시 또박또박를 자동으로 시작합니다.
          </p>
          <div className="flex items-center justify-between py-3 px-4 bg-slate-50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-gray-700">로그인 시 자동 시작</p>
              <p className="text-xs text-gray-500 mt-0.5">
                예약 회의를 백그라운드에서 자동 시작하려면 켜세요 (기본 꺼짐)
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autostart}
              onClick={() => handleAutostartChange(!autostart)}
              className={[
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
                'transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
                autostart ? 'bg-blue-600' : 'bg-gray-200',
              ].join(' ')}
            >
              <span
                className={[
                  'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0',
                  'transition duration-200 ease-in-out',
                  autostart ? 'translate-x-5' : 'translate-x-0',
                ].join(' ')}
              />
            </button>
          </div>
        </div>
      )}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold mb-1">회의 템플릿</h2>
        <p className="text-sm text-muted-foreground mb-4">
          반복 회의(스탠드업, 주간회의 등) 설정을 템플릿으로 저장하고 재사용합니다.
        </p>
        <MeetingTemplateManager />
      </div>
      <PromptTemplateManager />
    </div>
  )
}
