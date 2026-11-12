import { useEffect, useState } from 'react'
import { IS_TAURI, getMode } from '../../config'
import { useAuthStore } from '../../stores/authStore'
import { getWhiteboardSettings, updateWhiteboardSettings } from '../../api/settings'
import type { WhiteboardSettings } from '../../api/settings'
import PromptTemplateManager from '../PromptTemplateManager'
import MeetingTemplateManager from './MeetingTemplateManager'

/** 회의록 설정 탭: 데스크톱 자동시작 · 회의 템플릿 · 회의록 양식 */
export default function MeetingSettingsTab() {
  const [autostart, setAutostart] = useState(false)
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin')
  const showAdminSettings = isAdmin || getMode() === 'local'
  const [wb, setWb] = useState<WhiteboardSettings | null>(null)
  const [wbError, setWbError] = useState<string | null>(null)
  const [wbSaving, setWbSaving] = useState(false)

  useEffect(() => {
    if (!showAdminSettings) return
    let cancelled = false
    getWhiteboardSettings()
      .then((v) => { if (!cancelled) setWb(v) })
      .catch(() => { if (!cancelled) setWbError('화이트보드 설정을 불러오지 못했습니다.') })
    return () => { cancelled = true }
  }, [showAdminSettings])

  async function handleWhiteboardMode(mode: WhiteboardSettings['web_mode']) {
    if (wbSaving || wb?.web_mode === mode) return
    setWbSaving(true)
    setWbError(null)
    try {
      setWb(await updateWhiteboardSettings(mode))
    } catch {
      setWbError('설정을 저장하지 못했습니다. 다시 시도해 주세요.')
    } finally {
      setWbSaving(false)
    }
  }

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
            로그인 시 또박또박을 자동으로 시작합니다.
          </p>
          <div className="flex items-center justify-between py-3 px-4 bg-muted rounded-lg">
            <div>
              <p className="text-sm font-medium text-foreground">로그인 시 자동 시작</p>
              <p className="text-xs text-muted-foreground mt-0.5">
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
      {showAdminSettings && (
        <div className="rounded-lg border bg-card p-6" data-testid="whiteboard-settings">
          <h2 className="text-lg font-semibold mb-1">화이트보드 내보내기 · 웹</h2>
          <p className="text-sm text-muted-foreground mb-4">
            기본은 서버의 Claude Code로 만듭니다(모든 웹 사용자가 서버 PC의 Claude 계정 하나를 나눠 씁니다). 끄면 사용자가 지시문 파일을 받아 자기 Claude에 붙여 넣습니다. 데스크톱 앱은 이 설정과 상관없이 그 PC의 Claude Code를 씁니다.
          </p>
          <div className="space-y-2" role="radiogroup" aria-label="화이트보드 웹 생성 방식">
            <label className="flex items-center gap-2 text-sm min-h-[44px] cursor-pointer">
              <input
                type="radio"
                name="whiteboard-web-mode"
                checked={wb?.web_mode === 'server_claude'}
                disabled={!wb || wbSaving || !wb.server_claude_available}
                onChange={() => handleWhiteboardMode('server_claude')}
              />
              서버의 Claude Code (기본)
              {wb && (
                <span
                  className={`ml-1 rounded px-1.5 py-0.5 text-xs ${
                    wb.server_claude_available ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {wb.server_claude_available ? '확인됨' : '찾을 수 없음'}
                </span>
              )}
            </label>
            <label className="flex items-center gap-2 text-sm min-h-[44px] cursor-pointer">
              <input
                type="radio"
                name="whiteboard-web-mode"
                checked={wb?.web_mode === 'copy'}
                disabled={!wb || wbSaving}
                onChange={() => handleWhiteboardMode('copy')}
              />
              끄기 · 지시문 파일로 내려받기
            </label>
          </div>
          {wbError && <p className="mt-2 text-xs text-red-500">{wbError}</p>}
        </div>
      )}
      <PromptTemplateManager />
    </div>
  )
}
