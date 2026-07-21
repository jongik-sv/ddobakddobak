import { useState, useEffect, useCallback } from 'react'
import {
  getUserLlmSettings,
  updateUserLlmSettings,
  testUserLlmConnection,
  toggleUserLlm,
} from '../../api/userLlmSettings'
import type {
  UserLlmSettingsResponse,
  UserLlmTestResult,
} from '../../api/userLlmSettings'
import { listLlmProfiles, type LlmProfile } from '../../api/llmProfiles'
import { UserLlmStatusBanner } from './UserLlmStatusBanner'
import LlmProfilesModal from './LlmProfilesModal'
import { LlmSelector, type LlmSelectorValue } from './LlmSelector'
import { CLI_PRESET_IDS } from './llmServicePresets'

// 응답 → 선택값 매핑. llm_profile_id 가 있으면 프로필 참조가 최우선(레거시 provider/model 필드는 무시).
// 그 다음 provider 가 CLI 프리셋이면 cli, 그 외(빈 값 포함)는 '선택 안함'(none).
const toSummarySel = (ls: UserLlmSettingsResponse['llm_settings']): LlmSelectorValue => {
  if (ls.llm_profile_id) return { type: 'profile', profileId: ls.llm_profile_id }
  if (ls.provider && CLI_PRESET_IDS.has(ls.provider)) return { type: 'cli', presetId: ls.provider, model: ls.model ?? '' }
  return { type: 'special', id: 'none' }
}

// 챗도 동일하되 특수옵션이 둘: 'server'(서버 모델 강제 센티넬) / ''(요약과 동일, 레거시 모델 오버라이드 가능).
const toChatSel = (ls: UserLlmSettingsResponse['llm_settings']): LlmSelectorValue => {
  if (ls.chat_llm_profile_id) return { type: 'profile', profileId: ls.chat_llm_profile_id }
  if (ls.chat_provider === 'server') return { type: 'special', id: 'server' }
  if (ls.chat_provider && CLI_PRESET_IDS.has(ls.chat_provider)) return { type: 'cli', presetId: ls.chat_provider, model: ls.chat_model ?? '' }
  return { type: 'special', id: '' }
}

export default function UserLlmSettings() {
  const [settings, setSettings] = useState<UserLlmSettingsResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const [summarySel, setSummarySel] = useState<LlmSelectorValue>({ type: 'special', id: 'none' })
  const [chatSel, setChatSel] = useState<LlmSelectorValue>({ type: 'special', id: '' })
  // 챗='요약과 동일'(special '')일 때만 노출되는 레거시 챗 모델 오버라이드 입력값.
  const [chatFollowModel, setChatFollowModel] = useState('')
  const [profiles, setProfiles] = useState<LlmProfile[]>([])
  const [profilesModal, setProfilesModal] = useState<{ open: boolean; create: boolean }>({ open: false, create: false })

  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [testResult, setTestResult] = useState<UserLlmTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // 서버 응답을 진실로 선택값·챗 오버라이드 입력을 다시 채운다(최초 로드·저장·초기화 공통).
  const applySettings = useCallback((data: UserLlmSettingsResponse) => {
    setSettings(data)
    const ls = data.llm_settings
    setSummarySel(toSummarySel(ls))
    setChatSel(toChatSel(ls))
    setChatFollowModel(ls.chat_model ?? '')
    setTestResult(null)
  }, [])

  useEffect(() => {
    Promise.all([getUserLlmSettings(), listLlmProfiles('personal')])
      .then(([data, profs]) => {
        setProfiles(profs)
        applySettings(data)
      })
      .catch(() => {
        setError('설정을 불러오지 못했습니다.')
      })
      .finally(() => setLoading(false))
  }, [applySettings])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const summaryPayload =
        summarySel.type === 'profile' ? { llm_profile_id: summarySel.profileId } :
        summarySel.type === 'cli' ? { provider: summarySel.presetId, model: summarySel.model } :
        { provider: '', llm_profile_id: null }
      const chatPayload =
        chatSel.type === 'profile' ? { chat_llm_profile_id: chatSel.profileId } :
        chatSel.type === 'cli' ? { chat_provider: chatSel.presetId, chat_model: chatSel.model } :
        chatSel.id === 'server' ? { chat_provider: 'server' as const } :
        { chat_provider: null, chat_llm_profile_id: null, chat_model: chatFollowModel || null }
      const result = await updateUserLlmSettings({ llm_settings: { ...summaryPayload, ...chatPayload } })
      applySettings(result)
      setSuccess('저장되었습니다.')
    } catch {
      setError('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    if (summarySel.type === 'special') return
    setTesting(true)
    setTestResult(null)
    try {
      let result: UserLlmTestResult
      if (summarySel.type === 'profile') {
        const p = profiles.find((pr) => pr.id === summarySel.profileId)
        // base_url 동봉 필수 — 없으면 커스텀 엔드포인트 프로필이 기본 URL로 테스트된다.
        result = await testUserLlmConnection({
          provider: p?.provider ?? '',
          model: p?.model ?? '',
          base_url: p?.base_url ?? undefined,
          profile_id: summarySel.profileId,
        })
      } else {
        result = await testUserLlmConnection({ provider: summarySel.presetId, model: summarySel.model })
      }
      setTestResult(result)
    } catch {
      setTestResult({ success: false, error: '테스트 요청에 실패했습니다.' })
    } finally {
      setTesting(false)
    }
  }

  const handleReset = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      // 전체 초기화: 요약과 챗을 모두 비운다. 백엔드 계약상 빈 provider 저장은
      // 기본적으로 chat_llm_* 를 보존하므로, 완전 초기화엔 reset_all:true 가 필요하다.
      const result = await updateUserLlmSettings({
        llm_settings: { provider: '', reset_all: true },
      })
      applySettings(result)
      setSuccess(null)
    } catch {
      setError('초기화에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async () => {
    setToggling(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await toggleUserLlm()
      setSettings(result)
    } catch {
      setError('전환에 실패했습니다.')
    } finally {
      setToggling(false)
    }
  }

  const hasSettings = settings?.llm_settings.has_settings ?? false
  const isEnabled = settings?.llm_settings.enabled ?? true
  // idea.md 38: CLI는 항상 백엔드 서버에서 실행되므로 모드와 무관하게 개인 설정에서도 노출한다.
  const cliAllowed = true
  // 토글 OFF이고 설정이 있으면 폼을 숨긴다 (배너만 표시)
  const showForm = !hasSettings || isEnabled

  // 모달 CRUD 후 프로필 목록 갱신. 현재 선택 중인 프로필이 삭제돼 목록에서 사라지면
  // 선택이 dangling 상태(재저장 시 422)가 되므로 특수옵션 폴백으로 조정한다(I-2).
  const handleProfilesChanged = useCallback((next: LlmProfile[]) => {
    setProfiles(next)
    const ids = new Set(next.map((p) => p.id))
    setSummarySel((sel) => (sel.type === 'profile' && !ids.has(sel.profileId) ? { type: 'special', id: 'none' } : sel))
    setChatSel((sel) => (sel.type === 'profile' && !ids.has(sel.profileId) ? { type: 'special', id: '' } : sel))
  }, [])

  const openManage = () => setProfilesModal({ open: true, create: false })
  const openCreate = () => setProfilesModal({ open: true, create: true })

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold">내 LLM 설정</h2>
        {hasSettings && (
          <button
            type="button"
            role="switch"
            aria-checked={isEnabled}
            aria-label="내 LLM 활성화"
            disabled={toggling}
            onClick={handleToggle}
            className={`
              relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent
              transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
              disabled:opacity-50
              ${isEnabled ? 'bg-blue-600' : 'bg-gray-300'}
            `}
          >
            <span
              className={`
                pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0
                transition duration-200 ease-in-out
                ${isEnabled ? 'translate-x-5' : 'translate-x-0'}
              `}
            />
          </button>
        )}
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        개인 LLM을 설정하면 내 회의 요약에 사용됩니다. 비활성화 시 서버 기본 LLM을 사용합니다.
      </p>

      {loading && (
        <p className="text-sm text-muted-foreground" role="status">불러오는 중...</p>
      )}

      {!loading && error && !settings && (
        <p className="text-sm text-red-600" role="alert">{error}</p>
      )}

      {!loading && settings && (
        <div className="space-y-4">
          {/* 상태 배너 */}
          <UserLlmStatusBanner settings={settings} hasSettings={hasSettings} isEnabled={isEnabled} />

          {showForm && (<>
          {/* 요약 모델 카드 */}
          <LlmSelector
            title="요약 모델"
            idPrefix="user-summary"
            specialOptions={[{ id: 'none', label: '선택 안함', description: '서버 기본 LLM 사용' }]}
            profiles={profiles}
            cliAllowed={cliAllowed}
            value={summarySel}
            onChange={setSummarySel}
            onManageProfiles={openManage}
            onCreateProfile={openCreate}
          />

          {/* AI 챗 모델 카드 */}
          <LlmSelector
            title="AI 챗 모델"
            idPrefix="user-chat"
            specialOptions={[
              { id: '', label: '요약과 동일', description: '요약 모델 그대로 사용' },
              { id: 'server', label: '선택 안함', description: '서버 기본 챗 모델 사용' },
            ]}
            profiles={profiles}
            cliAllowed={cliAllowed}
            value={chatSel}
            onChange={setChatSel}
            onManageProfiles={openManage}
            onCreateProfile={openCreate}
          />

          {(summarySel.type === 'cli' || chatSel.type === 'cli') && (
            <p className="text-xs text-muted-foreground">
              CLI 모델은 내 PC가 아니라 서버에서 실행됩니다. 서버에 해당 CLI가 설치되어 있어야 합니다.
            </p>
          )}

          {/* 레거시 챗 모델 입력 — 챗이 '요약과 동일'(special '') 일 때만 표시 */}
          {chatSel.type === 'special' && chatSel.id === '' && (
            <div className="mt-2">
              <label htmlFor="user-chat-legacy-model" className="block text-xs text-muted-foreground mb-1">챗 모델 (AI 챗에만 적용)</label>
              <input
                id="user-chat-legacy-model"
                value={chatFollowModel}
                onChange={(e) => setChatFollowModel(e.target.value)}
                placeholder="예: gpt-4o / llama-3.1-8b"
                className="w-full rounded border px-2 py-1 text-sm"
              />
            </div>
          )}

          {summarySel.type === 'special' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors min-h-[44px]"
              >
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          )}

          {summarySel.type !== 'special' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTest}
                disabled={testing}
                className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors min-h-[44px]"
              >
                {testing ? '테스트 중...' : '연결 테스트'}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors min-h-[44px]"
              >
                {saving ? '저장 중...' : '저장'}
              </button>
              {hasSettings && (
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={saving}
                  className="rounded-md border border-red-300 bg-card px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors min-h-[44px]"
                >
                  설정 초기화
                </button>
              )}
            </div>
          )}

          {testResult && (
            <div role="status" aria-live="polite">
              {testResult.success ? (
                <p className="text-sm text-green-600">
                  연결 성공{testResult.response_time_ms != null && ` (${testResult.response_time_ms}ms)`}
                </p>
              ) : (
                <p className="text-sm text-red-600">
                  연결 실패{testResult.error && `: ${testResult.error}`}
                </p>
              )}
            </div>
          )}

          {success && (
            <p className="text-sm text-green-600" role="status">{success}</p>
          )}
          </>)}

          {error && settings && (
            <p className="text-sm text-red-600" role="alert">{error}</p>
          )}
        </div>
      )}

      <LlmProfilesModal
        scope="personal"
        open={profilesModal.open}
        initialCreate={profilesModal.create}
        onClose={() => setProfilesModal((s) => ({ ...s, open: false }))}
        onChanged={handleProfilesChanged}
      />
    </div>
  )
}
