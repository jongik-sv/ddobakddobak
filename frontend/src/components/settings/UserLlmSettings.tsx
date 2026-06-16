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
import { UserLlmStatusBanner } from './UserLlmStatusBanner'
import { ProviderRadioGroup } from './ProviderRadioGroup'

interface ProviderOption {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly suggestedModels: readonly string[]
  readonly isCustom: boolean
  readonly actualProvider: string
}

const PROVIDER_OPTIONS: readonly ProviderOption[] = [
  {
    id: 'none',
    name: '선택 안함',
    description: '서버 기본 LLM 사용',
    suggestedModels: [],
    isCustom: false,
    actualProvider: '',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude 시리즈',
    suggestedModels: ['claude-sonnet-4-6', 'claude-haiku-4-5'],
    isCustom: false,
    actualProvider: 'anthropic',
  },
  {
    id: 'anthropic_custom',
    name: 'Anthropic 호환',
    description: 'Z.AI 등 커스텀 엔드포인트',
    suggestedModels: [],
    isCustom: true,
    actualProvider: 'anthropic',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT 시리즈',
    suggestedModels: ['gpt-4o', 'gpt-4o-mini'],
    isCustom: false,
    actualProvider: 'openai',
  },
  {
    id: 'openai_custom',
    name: 'OpenAI 호환',
    description: 'Ollama, vLLM 등',
    suggestedModels: [],
    isCustom: true,
    actualProvider: 'openai',
  },
]

export default function UserLlmSettings() {
  const [settings, setSettings] = useState<UserLlmSettingsResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const [provider, setProvider] = useState<string>('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [chatModel, setChatModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [useCustomModel, setUseCustomModel] = useState(false)

  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [testResult, setTestResult] = useState<UserLlmTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const initFormFromSettings = useCallback((data: UserLlmSettingsResponse) => {
    const ls = data.llm_settings
    if (ls.has_settings && ls.provider) {
      if (ls.provider === 'openai' && ls.base_url) {
        setProvider('openai_custom')
      } else if (ls.provider === 'anthropic' && ls.base_url) {
        setProvider('anthropic_custom')
      } else {
        setProvider(ls.provider)
      }
      setModel(ls.model || '')
      setChatModel(ls.chat_llm_model || '')
      setBaseUrl(ls.base_url || '')
    } else {
      setProvider('')
      setChatModel('')
    }
    setApiKey('')
    setUseCustomModel(false)
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

  const currentProviderOption = PROVIDER_OPTIONS.find((p) => p.id === provider)
  const actualProvider = currentProviderOption?.actualProvider ?? provider

  const handleProviderSelect = (id: string) => {
    setProvider(id)
    const opt = PROVIDER_OPTIONS.find((p) => p.id === id)
    setModel(opt?.suggestedModels[0] ?? '')
    setChatModel('')
    setBaseUrl('')
    setTestResult(null)
    setUseCustomModel(false)
    setError(null)
    setSuccess(null)
  }

  const handleSave = async () => {
    if (!provider) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      if (provider === 'none') {
        const result = await updateUserLlmSettings({ llm_settings: { provider: '' } })
        setSettings(result)
        initFormFromSettings(result)
        setSuccess('서버 기본 LLM을 사용합니다.')
        return
      }
      const result = await updateUserLlmSettings({
        llm_settings: {
          provider: actualProvider,
          ...(apiKey ? { api_key: apiKey } : {}),
          model,
          chat_llm_model: chatModel || null,
          base_url: baseUrl || null,
        },
      })
      setSettings(result)
      setApiKey('')
      setSuccess('저장되었습니다.')
    } catch {
      setError('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    if (!provider) return
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testUserLlmConnection({
        provider: actualProvider,
        model,
        ...(apiKey ? { api_key: apiKey } : {}),
        ...(baseUrl ? { base_url: baseUrl } : {}),
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
      const result = await updateUserLlmSettings({
        llm_settings: { provider: '' },
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

  const modelOptions = currentProviderOption?.suggestedModels ?? []
  const showModelSelect = modelOptions.length > 0 && !useCustomModel
  const showBaseUrl = provider === 'openai_custom' || provider === 'anthropic_custom'

  const hasSettings = settings?.llm_settings.has_settings ?? false
  const isEnabled = settings?.llm_settings.enabled ?? true
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
          <ProviderRadioGroup
            options={PROVIDER_OPTIONS}
            selected={provider}
            onSelect={handleProviderSelect}
          />

          {provider && provider !== 'none' && (
            <div>
              <label htmlFor="user-llm-api-key" className="block text-sm font-medium mb-1">API Key</label>
              <input
                id="user-llm-api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={settings.llm_settings.api_key_masked || 'API 키를 입력하세요'}
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono min-h-[44px]"
              />
              {settings.llm_settings.api_key_masked && !apiKey && (
                <p className="text-xs text-muted-foreground mt-1">
                  현재: {settings.llm_settings.api_key_masked}
                </p>
              )}
            </div>
          )}

          {showBaseUrl && (
            <div>
              <label htmlFor="user-llm-base-url" className="block text-sm font-medium mb-1">Base URL</label>
              <input
                id="user-llm-base-url"
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={provider === 'anthropic_custom' ? 'https://api.z.ai/api/anthropic' : 'http://localhost:11434/v1'}
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono min-h-[44px]"
              />
            </div>
          )}

          {provider && provider !== 'none' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="user-llm-model" className="block text-sm font-medium">모델명</label>
                {modelOptions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setUseCustomModel(!useCustomModel)}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    {useCustomModel ? '목록에서 선택' : '직접 입력'}
                  </button>
                )}
              </div>
              {showModelSelect ? (
                <select
                  id="user-llm-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring min-h-[44px]"
                >
                  {modelOptions.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <input
                  id="user-llm-model"
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="모델명을 입력하세요"
                  className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono min-h-[44px]"
                />
              )}
            </div>
          )}

          {provider && provider !== 'none' && (
            <div>
              <label htmlFor="user-llm-chat-model" className="block text-sm font-medium mb-1">AI 챗 모델명</label>
              <input
                id="user-llm-chat-model"
                type="text"
                value={chatModel}
                onChange={(e) => setChatModel(e.target.value)}
                placeholder="모델명을 입력하세요"
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono min-h-[44px]"
              />
              <p className="text-xs text-muted-foreground mt-1">비우면 요약 모델을 사용합니다</p>
            </div>
          )}

          {provider === 'none' && (
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

          {provider && provider !== 'none' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTest}
                disabled={testing || !model}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors min-h-[44px]"
              >
                {testing ? '테스트 중...' : '연결 테스트'}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !model}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors min-h-[44px]"
              >
                {saving ? '저장 중...' : '저장'}
              </button>
              {hasSettings && (
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={saving}
                  className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors min-h-[44px]"
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
