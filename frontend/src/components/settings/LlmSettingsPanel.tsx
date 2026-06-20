import { useState, useEffect, useCallback } from 'react'
import { getLlmSettings, updateLlmSettings, testLlmConnection, fetchOllamaModels } from '../../api/settings'
import type { LlmSettings } from '../../api/settings'

const SERVICE_PRESETS = [
  { id: 'claude_cli', name: 'Claude Code', provider: 'claude_cli' as const, defaultBaseUrl: '', requiresApiKey: false, suggestedModels: ['sonnet', 'opus', 'haiku'], description: 'Claude Code CLI (키 불필요)' },
  { id: 'gemini_cli', name: 'Antigravity CLI', provider: 'gemini_cli' as const, defaultBaseUrl: '', requiresApiKey: false, suggestedModels: ['Gemini 3.5 Flash (Medium)', 'Gemini 3.5 Flash (High)', 'Gemini 3.5 Flash (Low)', 'Gemini 3.1 Pro (Low)', 'Gemini 3.1 Pro (High)', 'Claude Sonnet 4.6 (Thinking)', 'Claude Opus 4.6 (Thinking)', 'GPT-OSS 120B (Medium)'], description: 'Antigravity CLI(agy) — Gemini CLI 후속. agy models 기준' },
  { id: 'codex_cli', name: 'Codex CLI', provider: 'codex_cli' as const, defaultBaseUrl: '', requiresApiKey: false, suggestedModels: ['gpt-5.5', 'gpt-5.4-mini'], description: 'Codex CLI (키 불필요)' },
  { id: 'anthropic', name: 'Anthropic', provider: 'anthropic' as const, defaultBaseUrl: '', requiresApiKey: true, suggestedModels: ['claude-sonnet-4-6', 'claude-haiku-4-5'], description: 'Claude API (키 필요)' },
  { id: 'zai', name: 'Z.AI', provider: 'anthropic' as const, defaultBaseUrl: 'https://api.z.ai/api/anthropic', requiresApiKey: true, suggestedModels: ['glm-5.1', 'glm-5-turbo', 'glm-4.5-air'], description: 'GLM 모델 (Anthropic 호환)' },
  { id: 'openai', name: 'OpenAI', provider: 'openai' as const, defaultBaseUrl: '', requiresApiKey: true, suggestedModels: ['gpt-4o', 'gpt-4o-mini'], description: 'GPT 모델 (키 필요)' },
  { id: 'ollama', name: 'Ollama', provider: 'openai' as const, defaultBaseUrl: 'http://localhost:11434/v1', requiresApiKey: false, suggestedModels: [], description: '로컬 실행 (키 불필요)' },
  { id: 'custom', name: '직접 입력', provider: 'openai' as const, defaultBaseUrl: '', requiresApiKey: true, suggestedModels: [], description: '호환 API 직접 설정' },
] as const

const CLI_PRESET_IDS = new Set<string>(SERVICE_PRESETS.filter((p) => !p.requiresApiKey && !p.defaultBaseUrl).map((p) => p.id))

interface PresetFormState {
  auth_token: string
  base_url: string
  model: string
  max_input_tokens: number
  max_output_tokens: number
}

/** AI(LLM) 요약 모델 설정 카드: 서비스 프리셋 선택 + 키/모델/토큰 제한 + 연결 테스트/저장. */
export function LlmSettingsPanel() {
  const [llmSettings, setLlmSettings] = useState<LlmSettings | null>(null)
  const [presetCache, setPresetCache] = useState<Record<string, PresetFormState>>({})
  const [selectedPreset, setSelectedPreset] = useState('anthropic')
  const [llmSaving, setLlmSaving] = useState(false)
  const [llmSuccess, setLlmSuccess] = useState<string | null>(null)
  const [llmError, setLlmError] = useState<string | null>(null)
  const [llmTesting, setLlmTesting] = useState(false)
  const [llmTestResult, setLlmTestResult] = useState<{ success: boolean; error?: string } | null>(null)
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [ollamaLoading, setOllamaLoading] = useState(false)
  const [ollamaError, setOllamaError] = useState<string | null>(null)
  const [useCustomModel, setUseCustomModel] = useState(false)
  const [chatPresetId, setChatPresetId] = useState('')      // '' = 요약과 동일
  const [chatAuthToken, setChatAuthToken] = useState('')
  const [chatBaseUrl, setChatBaseUrl] = useState('')
  const [chatModel, setChatModel] = useState('')
  const [chatMaskedToken, setChatMaskedToken] = useState('')

  useEffect(() => {
    getLlmSettings().then((llm) => {
      if (!llm) return
      setLlmSettings(llm)
      setSelectedPreset(llm.active_preset || 'anthropic')
      const chat = llm.chat
      if (chat && chat.provider) {
        setChatPresetId(chat.preset_id || '')
        setChatBaseUrl(chat.base_url || '')
        setChatModel(chat.model || '')
        setChatMaskedToken(chat.auth_token_masked || '')
      } else {
        setChatPresetId('')
        setChatModel(llm.chat_model || '')
        setChatMaskedToken('')
      }
      setChatAuthToken('')
      const cache: Record<string, PresetFormState> = {}
      for (const [id, preset] of Object.entries(llm.presets || {})) {
        cache[id] = {
          auth_token: '',
          base_url: preset.base_url || SERVICE_PRESETS.find((p) => p.id === id)?.defaultBaseUrl || '',
          model: preset.model || '',
          max_input_tokens: preset.max_input_tokens || 200000,
          max_output_tokens: preset.max_output_tokens || 10000,
        }
      }
      setPresetCache(cache)
    }).catch(() => {})
  }, [])

  const currentForm = presetCache[selectedPreset] || { auth_token: '', base_url: '', model: '', max_input_tokens: 200000, max_output_tokens: 10000 }
  const updateCurrentForm = (updates: Partial<PresetFormState>) => {
    setPresetCache((c) => ({
      ...c,
      [selectedPreset]: { ...currentForm, ...updates },
    }))
  }

  const handlePresetSelect = (presetId: string) => {
    setSelectedPreset(presetId)
    const presetDef = SERVICE_PRESETS.find((p) => p.id === presetId)
    if (!presetCache[presetId]) {
      setPresetCache((c) => ({
        ...c,
        [presetId]: {
          auth_token: '',
          base_url: presetDef?.defaultBaseUrl ?? '',
          model: presetDef?.suggestedModels[0] ?? '',
          max_input_tokens: 200000,
          max_output_tokens: 10000,
        },
      }))
    }
    setUseCustomModel(false)
    setLlmTestResult(null)
    setOllamaModels([])
    setOllamaError(null)
  }

  const loadOllamaModels = useCallback(async (baseUrl: string) => {
    setOllamaLoading(true)
    setOllamaError(null)
    try {
      const models = await fetchOllamaModels(baseUrl)
      setOllamaModels(models)
      if (models.length > 0 && !currentForm.model) {
        updateCurrentForm({ model: models[0] })
      }
    } catch {
      setOllamaError('Ollama에 연결할 수 없습니다. 실행 중인지 확인하세요.')
      setOllamaModels([])
    } finally {
      setOllamaLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentForm.model, selectedPreset])

  useEffect(() => {
    if (selectedPreset === 'ollama' && currentForm.base_url) {
      loadOllamaModels(currentForm.base_url)
    }
  }, [selectedPreset, currentForm.base_url, loadOllamaModels])

  const currentPreset = SERVICE_PRESETS.find((p) => p.id === selectedPreset)!
  const modelOptions = selectedPreset === 'ollama' ? ollamaModels : currentPreset.suggestedModels
  const showModelSelect = modelOptions.length > 0 && !useCustomModel

  const chatPreset = SERVICE_PRESETS.find((p) => p.id === chatPresetId)
  const chatActualProvider = chatPreset?.provider ?? ''
  const chatIsCli = chatPresetId !== '' && CLI_PRESET_IDS.has(chatPresetId)
  const chatRequiresKey = chatPreset?.requiresApiKey ?? false
  const chatModelSuggestions: readonly string[] = chatPreset?.suggestedModels ?? []

  const handleChatServiceSelect = (id: string) => {
    setChatPresetId(id)
    const def = SERVICE_PRESETS.find((p) => p.id === id)
    setChatBaseUrl(def?.defaultBaseUrl ?? '')
    setChatModel(def?.suggestedModels[0] ?? '')
    setChatAuthToken('')
    setChatMaskedToken('')
  }

  const handleLlmTest = async () => {
    setLlmTesting(true)
    setLlmTestResult(null)
    try {
      const testParams: { provider: string; model: string; preset_id: string; auth_token?: string; base_url?: string } = {
        provider: currentPreset.provider,
        model: currentForm.model,
        preset_id: selectedPreset,
      }
      if (currentForm.auth_token) testParams.auth_token = currentForm.auth_token
      if (currentForm.base_url) testParams.base_url = currentForm.base_url
      const result = await testLlmConnection(testParams)
      setLlmTestResult(result)
    } catch {
      setLlmTestResult({ success: false, error: '테스트 요청에 실패했습니다.' })
    } finally {
      setLlmTesting(false)
    }
  }

  const handleLlmSave = async () => {
    setLlmSaving(true)
    setLlmError(null)
    setLlmSuccess(null)
    try {
      const presetData: Record<string, string | number> = {
        provider: currentPreset.provider,
        model: currentForm.model,
        base_url: currentForm.base_url,
        max_input_tokens: currentForm.max_input_tokens,
        max_output_tokens: currentForm.max_output_tokens,
      }
      if (currentForm.auth_token) {
        presetData.auth_token = currentForm.auth_token
      }

      const chatPayload =
        chatPresetId === ''
          ? { provider: '' }
          : {
              preset_id: chatPresetId,
              provider: chatActualProvider,
              base_url: chatBaseUrl,
              model: chatModel,
              ...(chatAuthToken ? { auth_token: chatAuthToken } : {}),
            }

      const result = await updateLlmSettings({
        active_preset: selectedPreset,
        chat_model: chatPresetId === '' ? (chatModel.trim() || '') : '',
        chat: chatPayload,
        preset_id: selectedPreset,
        preset_data: presetData,
      })
      setLlmSettings(result)
      // 저장 응답으로 챗 폼 재초기화
      const rc = result.chat
      if (rc && rc.provider) {
        setChatPresetId(rc.preset_id || '')
        setChatBaseUrl(rc.base_url || '')
        setChatModel(rc.model || '')
        setChatMaskedToken(rc.auth_token_masked || '')
      } else {
        setChatPresetId('')
        setChatModel(result.chat_model || '')
        setChatMaskedToken('')
      }
      setChatAuthToken('')
      updateCurrentForm({ auth_token: '' })
      setLlmSuccess('AI 설정이 저장되었습니다.')
    } catch {
      setLlmError('AI 설정 저장에 실패했습니다.')
    } finally {
      setLlmSaving(false)
    }
  }

  return (
    <div className="rounded-lg border bg-card p-6">
      <h2 className="text-lg font-semibold mb-1">LLM 모델 설정</h2>
      <p className="text-sm text-muted-foreground mb-4">
        회의록 요약에 사용할 AI 서비스를 선택합니다.
      </p>

      <div className="space-y-4">
        {/* 서비스 프리셋 카드 */}
        <div>
          <label className="block text-sm font-medium mb-2">서비스 선택</label>
          <div className="grid grid-cols-4 gap-2">
            {SERVICE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handlePresetSelect(preset.id)}
                className={`
                  rounded-lg border p-3 text-left transition-all
                  ${selectedPreset === preset.id
                    ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                    : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                  }
                `}
              >
                <div className="flex items-center gap-1">
                  <p className="text-sm font-medium">{preset.name}</p>
                  {llmSettings?.active_preset === preset.id && (
                    <span className="text-[10px] text-green-600 font-medium">●</span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{preset.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* CLI 프로바이더 안내 */}
        {CLI_PRESET_IDS.has(selectedPreset) && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="font-medium mb-1">CLI 모드 안내</p>
            <p className="text-xs leading-relaxed">
              CLI 모드는 호출마다 프로세스를 새로 시작하여 <strong>약 6~7초의 지연</strong>이 발생합니다.
              실시간 회의록에는 부적합하며, <strong>일회성 테스트나 배치 작업</strong>에 적합합니다.
              실시간 요약이 필요하면 API 키 방식(Anthropic, Z.AI, OpenAI 등)을 사용하세요.
            </p>
          </div>
        )}

        {/* API Base URL (CLI 프로바이더에서는 불필요) */}
        {!CLI_PRESET_IDS.has(selectedPreset) && (
          <div>
            <label className="block text-sm font-medium mb-1">API Base URL</label>
            <input
              type="text"
              value={currentForm.base_url}
              onChange={(e) => updateCurrentForm({ base_url: e.target.value })}
              placeholder={currentPreset.defaultBaseUrl || 'https://api.anthropic.com'}
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono min-h-[44px]"
            />
          </div>
        )}

        {/* API Key (Ollama이면 숨김) */}
        {currentPreset.requiresApiKey && (() => {
          const serverPreset = llmSettings?.presets?.[selectedPreset]
          const tokenMasked = serverPreset?.auth_token_masked
          return (
            <div>
              <label className="block text-sm font-medium mb-1">API Key</label>
              <input
                type="password"
                value={currentForm.auth_token}
                onChange={(e) => updateCurrentForm({ auth_token: e.target.value })}
                placeholder={tokenMasked || '토큰을 입력하세요'}
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono min-h-[44px]"
              />
              {tokenMasked && !currentForm.auth_token && (
                <p className="text-xs text-muted-foreground mt-1">현재: {tokenMasked}</p>
              )}
            </div>
          )
        })()}

        {/* 모델명 */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium">회의록 작성 모델명</label>
            {modelOptions.length > 0 && (
              <button
                onClick={() => setUseCustomModel(!useCustomModel)}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                {useCustomModel ? '목록에서 선택' : '직접 입력'}
              </button>
            )}
            {selectedPreset === 'ollama' && (
              <button
                onClick={() => loadOllamaModels(currentForm.base_url)}
                disabled={ollamaLoading}
                className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
              >
                {ollamaLoading ? '감지 중...' : '모델 새로고침'}
              </button>
            )}
          </div>
          {showModelSelect ? (
            <select
              value={currentForm.model}
              onChange={(e) => updateCurrentForm({ model: e.target.value })}
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono bg-white min-h-[44px]"
            >
              {modelOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={currentForm.model}
              onChange={(e) => updateCurrentForm({ model: e.target.value })}
              placeholder="모델명을 입력하세요"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono min-h-[44px]"
            />
          )}
          {selectedPreset === 'ollama' && ollamaError && (
            <p className="text-xs text-yellow-600 mt-1">{ollamaError}</p>
          )}
          {selectedPreset === 'ollama' && ollamaModels.length === 0 && !ollamaLoading && !ollamaError && (
            <p className="text-xs text-muted-foreground mt-1">설치된 모델이 없습니다. ollama pull로 모델을 설치하세요.</p>
          )}
        </div>

        {/* 토큰 제한 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">최대 입력 토큰</label>
            <input
              type="number"
              value={currentForm.max_input_tokens}
              onChange={(e) => updateCurrentForm({ max_input_tokens: parseInt(e.target.value) || 0 })}
              placeholder="200000"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono min-h-[44px]"
            />
            <p className="text-xs text-muted-foreground mt-1">기본: 200,000</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">최대 출력 토큰</label>
            <input
              type="number"
              value={currentForm.max_output_tokens}
              onChange={(e) => updateCurrentForm({ max_output_tokens: parseInt(e.target.value) || 0 })}
              placeholder="32768"
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono min-h-[44px]"
            />
            <p className="text-xs text-muted-foreground mt-1">기본: 32,768 (회의록이 길면 늘리세요)</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          사용 중인 모델의 스펙에 맞게 설정하세요. 모르겠으면 기본값을 유지하면 됩니다.
        </p>

        {/* AI 챗 모델 (독립 섹션) */}
        <section className="mt-6 border-t border-gray-200 pt-4">
          <h3 className="text-sm font-semibold text-gray-800">AI 챗 모델 (독립)</h3>
          <p className="mb-2 text-xs text-gray-500">
            비우면(요약과 동일) 요약 모델을 사용합니다. 실시간 챗에 CLI(Claude Code·Antigravity·Codex)는 6~7초 지연으로 부적합합니다.
          </p>

          <label htmlFor="chat-service" className="block text-xs text-gray-600 mb-1">챗 서비스</label>
          <select
            id="chat-service"
            value={chatPresetId}
            onChange={(e) => handleChatServiceSelect(e.target.value)}
            className="mb-2 w-full rounded-md border px-3 py-2 text-sm bg-white min-h-[44px]"
          >
            <option value="">요약과 동일</option>
            {SERVICE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {chatPresetId !== '' && chatRequiresKey && (
            <div className="mb-2">
              <label htmlFor="chat-key" className="block text-xs text-gray-600 mb-1">챗 API 키</label>
              <input
                id="chat-key"
                type="password"
                value={chatAuthToken}
                onChange={(e) => setChatAuthToken(e.target.value)}
                placeholder={chatMaskedToken || '토큰을 입력하세요'}
                className="w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[44px]"
              />
              {chatMaskedToken && !chatAuthToken && (
                <p className="text-xs text-muted-foreground mt-1">현재: {chatMaskedToken}</p>
              )}
            </div>
          )}

          {chatPresetId !== '' && !chatIsCli && (
            <div className="mb-2">
              <label htmlFor="chat-base" className="block text-xs text-gray-600 mb-1">챗 base URL</label>
              <input
                id="chat-base"
                type="text"
                value={chatBaseUrl}
                onChange={(e) => setChatBaseUrl(e.target.value)}
                placeholder={chatPreset?.defaultBaseUrl || 'https://api.anthropic.com'}
                className="w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[44px]"
              />
            </div>
          )}

          <label htmlFor="chat-model" className="block text-xs text-gray-600 mb-1">챗 모델</label>
          {chatModelSuggestions.length > 0 ? (
            <select
              id="chat-model"
              value={chatModel}
              onChange={(e) => setChatModel(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm bg-white font-mono min-h-[44px]"
            >
              {(chatModel && !chatModelSuggestions.includes(chatModel)
                ? [...chatModelSuggestions, chatModel]
                : chatModelSuggestions
              ).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <input
              id="chat-model"
              type="text"
              value={chatModel}
              onChange={(e) => setChatModel(e.target.value)}
              placeholder="모델명을 입력하세요 (비우면 요약 모델)"
              className="w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[44px]"
            />
          )}
          <p className="text-xs text-muted-foreground mt-1">비우면 요약 모델을 사용합니다</p>
        </section>

        {/* 버튼 + 결과 */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleLlmTest}
            disabled={llmTesting || !currentForm.model}
            className="px-4 py-2 rounded-md text-sm font-medium border border-blue-600 text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {llmTesting ? '테스트 중...' : '연결 테스트'}
          </button>
          <button
            onClick={handleLlmSave}
            disabled={llmSaving}
            className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors min-h-[44px]"
          >
            {llmSaving ? '저장 중...' : '저장'}
          </button>
        </div>
        {llmTestResult && (
          <p className={`text-sm ${llmTestResult.success ? 'text-green-600' : 'text-red-600'}`}>
            {llmTestResult.success ? '연결 성공' : `연결 실패: ${llmTestResult.error}`}
          </p>
        )}
        {llmError && <p className="text-sm text-red-600">{llmError}</p>}
        {llmSuccess && <p className="text-sm text-green-600">{llmSuccess}</p>}
        {llmSettings?.offline && (
          <p className="text-sm text-yellow-600">Sidecar 연결 불가 — 오프라인 상태</p>
        )}
      </div>
    </div>
  )
}
