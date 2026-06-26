import type { UserLlmSettingsResponse } from '../../api/userLlmSettings'

/** 내 LLM 설정 상태 배너 — 활성/비활성/미설정 3가지 상태 안내 */
export function UserLlmStatusBanner({
  settings,
  hasSettings,
  isEnabled,
}: {
  settings: UserLlmSettingsResponse
  hasSettings: boolean
  isEnabled: boolean
}) {
  if (hasSettings && isEnabled) {
    return (
      <div className="border border-blue-200 bg-blue-50 rounded-md p-3" role="status">
        <p className="text-sm font-medium text-blue-800">
          내 LLM 사용 중 — {settings.llm_settings.provider} / {settings.llm_settings.model}
        </p>
        <p className="text-xs text-blue-600 mt-0.5">
          내가 생성한 회의의 AI 요약에 이 LLM이 사용됩니다.
        </p>
      </div>
    )
  }

  if (hasSettings && !isEnabled) {
    return (
      <div className="border border-border bg-muted rounded-md p-3" role="status">
        <p className="text-sm font-medium text-muted-foreground">
          내 LLM 비활성 — 서버 기본값 ({settings.server_default.provider} / {settings.server_default.model}) 사용 중
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          토글을 켜면 내 LLM ({settings.llm_settings.provider} / {settings.llm_settings.model})으로 전환됩니다.
        </p>
      </div>
    )
  }

  return (
    <div className="border border-amber-200 bg-amber-50 rounded-md p-3" role="status">
      <p className="text-sm font-medium">서버 기본값 사용 중</p>
      <p className="text-xs text-muted-foreground">
        서버 기본 LLM ({settings.server_default.provider} / {settings.server_default.model})을 사용합니다.
        아래에서 개인 LLM을 설정하면 내 회의 요약에 사용됩니다.
      </p>
      {!settings.server_default.has_key && (
        <p className="text-xs text-red-600 mt-1" role="alert">
          서버에 기본 LLM이 설정되어 있지 않습니다. 개인 LLM을 설정해야 요약 기능을 사용할 수 있습니다.
        </p>
      )}
    </div>
  )
}
