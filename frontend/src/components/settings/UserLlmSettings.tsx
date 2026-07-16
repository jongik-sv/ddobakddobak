import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getUserLlmSettings,
  updateUserLlmSettings,
  testUserLlmConnection,
  toggleUserLlm,
  fetchUserLlmModels,
} from '../../api/userLlmSettings'
import type {
  UserLlmSettingsResponse,
  UserLlmTestResult,
} from '../../api/userLlmSettings'
import { UserLlmStatusBanner } from './UserLlmStatusBanner'
import LlmProviderCard from './LlmProviderCard'
import { SERVICE_PRESETS, presetIdFromUserConfig, presetFormDefaults } from './llmServicePresets'

export default function UserLlmSettings() {
  const [settings, setSettings] = useState<UserLlmSettingsResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const [summaryPresetId, setSummaryPresetId] = useState('none')
  const [summaryForm, setSummaryForm] = useState({ base_url: '', model: '', auth_token: '' })
  const [chatPresetId, setChatPresetId] = useState('')
  const [chatForm, setChatForm] = useState({ base_url: '', model: '', auth_token: '' })

  // 프리셋별 폼 입력값 캐시. 프리셋을 전환했다가 되돌아와도 앞서 입력한 base_url/model/키가
  // 초기화되지 않게 한다(특히 '직접 입력'(custom)은 기본값이 없어 전환 시 유실되던 문제).
  type PresetForm = { base_url: string; model: string; auth_token: string }
  const summaryFormCacheRef = useRef<Record<string, PresetForm>>({})
  const chatFormCacheRef = useRef<Record<string, PresetForm>>({})

  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [testResult, setTestResult] = useState<UserLlmTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const initFormFromSettings = useCallback((data: UserLlmSettingsResponse) => {
    // 서버 진실로부터 새로 채우므로 프리셋별 폼 캐시도 초기화(로드·초기화·none 저장 시).
    summaryFormCacheRef.current = {}
    chatFormCacheRef.current = {}
    const ls = data.llm_settings
    const sid = presetIdFromUserConfig(ls.provider ?? null, ls.base_url ?? null) ?? 'none'
    setSummaryPresetId(sid)
    setSummaryForm({ base_url: ls.base_url ?? '', model: ls.model ?? '', auth_token: '' })
    const cid = presetIdFromUserConfig(ls.chat_provider ?? null, ls.chat_base_url ?? null) ?? ''
    setChatPresetId(cid)
    setChatForm({ base_url: ls.chat_base_url ?? '', model: ls.chat_model ?? '', auth_token: '' })
    setTestResult(null)
  }, [])

  useEffect(() => {
    getUserLlmSettings()
      .then((data) => {
        setSettings(data)
        initFormFromSettings(data)
      })
      .catch(() => {
        setError('설정을 불러오지 못했습니다.')
      })
      .finally(() => setLoading(false))
  }, [initFormFromSettings])

  const handleSummarySelect = (id: string) => {
    // 현재 입력값을 이전 프리셋 아래 캐시 → 다시 돌아오면 복원(입력 유실 방지).
    summaryFormCacheRef.current[summaryPresetId] = summaryForm
    setSummaryPresetId(id)
    const cached = summaryFormCacheRef.current[id]
    setSummaryForm(id === 'none' ? { base_url: '', model: '', auth_token: '' } : (cached ?? presetFormDefaults(id)))
    setTestResult(null)
    setError(null)
    setSuccess(null)
  }

  const handleChatSelect = (id: string) => {
    chatFormCacheRef.current[chatPresetId] = chatForm
    setChatPresetId(id)
    // '' (요약과 동일) / 'server' (서버 모델) 는 프로바이더 폼이 없으므로 비운다. 그 외엔 캐시 복원.
    const cached = chatFormCacheRef.current[id]
    setChatForm(id === '' || id === 'server' ? { base_url: '', model: '', auth_token: '' } : (cached ?? presetFormDefaults(id)))
    setError(null)
    setSuccess(null)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      // 챗 payload는 요약 선택과 무관하게 한 번 구성한다 — 요약='선택 안함'(none)이어도
      // 개인 챗 모델을 함께 저장할 수 있어야 하기 때문(BUG: none 분기가 chat_* 를 누락해
      // 챗이 항상 '요약과 동일'로 되돌아가던 문제).
      // 챗 특수옵션: '' = 요약과 동일(chat_provider=null) / 'server' = 서버 모델 강제(센티넬)
      const isServerChat = chatPresetId === 'server'
      const cp = (chatPresetId === '' || isServerChat) ? null : SERVICE_PRESETS.find((p) => p.id === chatPresetId) ?? null
      const chatPayload = {
        chat_provider: isServerChat ? 'server' : (cp ? cp.provider : null),
        chat_base_url: isServerChat ? null : (cp ? (chatForm.base_url || null) : null),
        // 서버 모델은 개인 모델 override 없음. 그 외엔 chatForm.model(레거시 보존).
        chat_model: isServerChat ? null : (chatForm.model || null),
        chat_api_key: isServerChat ? '' : chatForm.auth_token,
      }
      if (summaryPresetId === 'none') {
        const result = await updateUserLlmSettings({ llm_settings: { provider: '', ...chatPayload } })
        setSettings(result)
        initFormFromSettings(result)
        setChatForm((f) => ({ ...f, auth_token: '' }))
        setSuccess('저장되었습니다.')
        return
      }
      const sp = SERVICE_PRESETS.find((p) => p.id === summaryPresetId)!
      const result = await updateUserLlmSettings({
        llm_settings: {
          provider: sp.provider,
          ...(summaryForm.auth_token ? { api_key: summaryForm.auth_token } : {}),
          model: summaryForm.model,
          base_url: summaryForm.base_url || null,
          ...chatPayload,
        },
      })
      setSettings(result)
      setSummaryForm((f) => ({ ...f, auth_token: '' }))
      setChatForm((f) => ({ ...f, auth_token: '' }))
      setSuccess('저장되었습니다.')
    } catch {
      setError('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    if (summaryPresetId === 'none') return
    setTesting(true)
    setTestResult(null)
    const sp = SERVICE_PRESETS.find((p) => p.id === summaryPresetId)
    try {
      const result = await testUserLlmConnection({
        provider: sp?.provider ?? summaryPresetId,
        model: summaryForm.model,
        ...(summaryForm.auth_token ? { api_key: summaryForm.auth_token } : {}),
        ...(summaryForm.base_url ? { base_url: summaryForm.base_url } : {}),
      })
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
      setSettings(result)
      initFormFromSettings(result)
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

  // 저장된 provider와 현재 선택한 카드가 일치할 때만 마스크를 넘긴다.
  // 다른 provider로 전환하면 stale 마스크가 키 placeholder/"현재:" 로 잘못 노출되어
  // 키 없이 저장하도록 유도하는 버그를 막는다.
  const savedSummaryPresetId = settings
    ? presetIdFromUserConfig(settings.llm_settings.provider ?? null, settings.llm_settings.base_url ?? null) ?? 'none'
    : 'none'
  const savedChatPresetId = settings
    ? presetIdFromUserConfig(settings.llm_settings.chat_provider ?? null, settings.llm_settings.chat_base_url ?? null) ?? ''
    : ''
  const summaryMask =
    summaryPresetId === savedSummaryPresetId ? settings?.llm_settings.api_key_masked ?? undefined : undefined
  const chatMask =
    chatPresetId === savedChatPresetId ? settings?.llm_settings.chat_api_key_masked ?? undefined : undefined
  // 토글 OFF이고 설정이 있으면 폼을 숨긴다 (배너만 표시)
  const showForm = !hasSettings || isEnabled

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
          <LlmProviderCard
            title="요약 모델"
            idPrefix="user-summary"
            presets={SERVICE_PRESETS}
            noneOption={{ id: 'none', label: '선택 안함', description: '서버 기본 LLM 사용' }}
            value={{ presetId: summaryPresetId, ...summaryForm }}
            maskedToken={summaryMask}
            onSelectPreset={handleSummarySelect}
            onChange={(p) => setSummaryForm((f) => ({ ...f, ...p }))}
            onFetchModels={fetchUserLlmModels}
          />

          {/* AI 챗 모델 카드 */}
          <LlmProviderCard
            title="AI 챗 모델"
            idPrefix="user-chat"
            presets={SERVICE_PRESETS}
            noneOptions={[
              { id: '', label: '요약과 동일', description: '요약 모델 그대로 사용' },
              { id: 'server', label: '선택 안함', description: '서버 기본 챗 모델 사용' },
            ]}
            value={{ presetId: chatPresetId, ...chatForm }}
            maskedToken={chatMask}
            onSelectPreset={handleChatSelect}
            onChange={(p) => setChatForm((f) => ({ ...f, ...p }))}
            onFetchModels={fetchUserLlmModels}
          />

          {/* 레거시 챗 모델 입력 — chatPresetId='' 일 때만 표시 */}
          {chatPresetId === '' && (
            <div className="mt-2">
              <label htmlFor="user-chat-legacy-model" className="block text-xs text-muted-foreground mb-1">챗 모델 (AI 챗에만 적용)</label>
              <input
                id="user-chat-legacy-model"
                value={chatForm.model}
                onChange={(e) => setChatForm((f) => ({ ...f, model: e.target.value }))}
                placeholder="예: gpt-4o / llama-3.1-8b"
                className="w-full rounded border px-2 py-1 text-sm"
              />
            </div>
          )}

          {summaryPresetId === 'none' && (
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

          {summaryPresetId && summaryPresetId !== 'none' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTest}
                disabled={testing || !summaryForm.model}
                className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors min-h-[44px]"
              >
                {testing ? '테스트 중...' : '연결 테스트'}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !summaryForm.model}
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
    </div>
  )
}
