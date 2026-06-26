import { IS_TAURI, getMode, getServerUrl, clearMode } from '../../config'
import UserLlmSettings from './UserLlmSettings'
import UserLanguageSettings from './UserLanguageSettings'
import UserSttSettings from './UserSttSettings'
import PasswordChangeSection from './PasswordChangeSection'

interface Props {
  showPasswordSection: boolean
}

export default function PersonalSettingsTab({ showPasswordSection }: Props) {
  return (
    <div className="max-w-2xl space-y-6">
      {/* 실행 모드 (Tauri에서만 표시) */}
      {IS_TAURI && (
        <section className="space-y-3 mb-8">
          <h3 className="text-sm font-semibold text-foreground">실행 모드</h3>
          <div className="flex items-center justify-between py-3 px-4 bg-muted rounded-lg">
            <div>
              {(() => {
                const isServer = getMode() === 'server'
                return (
                  <>
                    <p className="text-sm font-medium text-foreground">
                      {isServer ? '서버 연결 모드' : '로컬 실행 모드'}
                    </p>
                    {isServer && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {getServerUrl()}
                      </p>
                    )}
                  </>
                )
              })()}
            </div>
            <button
              type="button"
              onClick={() => {
                clearMode()
                window.location.reload()
              }}
              className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-md hover:bg-red-50 transition-colors"
            >
              모드 재설정
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            재설정 시 앱이 다시 시작되며 모드 선택 화면이 표시됩니다.
          </p>
        </section>
      )}

      {/* 회의 언어 설정 (사용자 개인) */}
      <UserLanguageSettings />

      {showPasswordSection && <PasswordChangeSection />}

      {/* 내 LLM 설정 (사용자 개인) */}
      <UserLlmSettings />

      {/* STT 전사 위치 (per-device 로컬 설정 — Android/Tauri 모바일에서만 노출) */}
      <UserSttSettings />
    </div>
  )
}
