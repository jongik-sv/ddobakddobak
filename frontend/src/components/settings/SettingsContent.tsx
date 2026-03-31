import { useState, useEffect, useCallback } from 'react'
import { HTTPError } from 'ky'
import { getSttSettings, updateSttEngine, getLlmSettings, updateLlmSettings, getHfSettings, updateHfToken, testLlmConnection, fetchOllamaModels } from '../../api/settings'
import type { SttSettings, LlmSettings, LlmPreset, HfSettings } from '../../api/settings'
import { useAppSettingsStore, AUDIO_DEFAULTS, DIARIZATION_DEFAULTS } from '../../stores/appSettingsStore'
import { ENGINE_LABELS, SUMMARY_INTERVAL_OPTIONS, AUDIO, DIARIZATION, LANGUAGES } from '../../config'
import PromptTemplateManager from '../PromptTemplateManager'

const SERVICE_PRESETS = [
  { id: 'claude_cli', name: 'Claude Code', provider: 'claude_cli' as const, defaultBaseUrl: '', requiresApiKey: false, suggestedModels: ['sonnet', 'opus', 'haiku'], description: 'Claude Code CLI (키 불필요)' },
  { id: 'gemini_cli', name: 'Gemini CLI', provider: 'gemini_cli' as const, defaultBaseUrl: '', requiresApiKey: false, suggestedModels: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-pro'], description: 'Gemini CLI (키 불필요)' },
  { id: 'codex_cli', name: 'Codex CLI', provider: 'codex_cli' as const, defaultBaseUrl: '', requiresApiKey: false, suggestedModels: ['o4-mini', 'o3', 'gpt-4.1'], description: 'Codex CLI (키 불필요)' },
  { id: 'anthropic', name: 'Anthropic', provider: 'anthropic' as const, defaultBaseUrl: '', requiresApiKey: true, suggestedModels: ['claude-sonnet-4-6', 'claude-haiku-4-5'], description: 'Claude API (키 필요)' },
  { id: 'zai', name: 'Z.AI', provider: 'anthropic' as const, defaultBaseUrl: 'https://api.z.ai/api/anthropic', requiresApiKey: true, suggestedModels: ['glm-4.7', 'glm-4.5', 'glm-5', 'glm-5-turbo', 'glm-4.5-air'], description: 'GLM 모델 (Anthropic 호환)' },
  { id: 'openai', name: 'OpenAI', provider: 'openai' as const, defaultBaseUrl: '', requiresApiKey: true, suggestedModels: ['gpt-4o', 'gpt-4o-mini'], description: 'GPT 모델 (키 필요)' },
  { id: 'ollama', name: 'Ollama', provider: 'openai' as const, defaultBaseUrl: 'http://localhost:11434/v1', requiresApiKey: false, suggestedModels: [], description: '로컬 실행 (키 불필요)' },
  { id: 'custom', name: '직접 입력', provider: 'openai' as const, defaultBaseUrl: '', requiresApiKey: true, suggestedModels: [], description: '호환 API 직접 설정' },
] as const

const CLI_PRESET_IDS = new Set(SERVICE_PRESETS.filter((p) => !p.requiresApiKey && !p.defaultBaseUrl).map((p) => p.id))

function SettingSlider({
  label,
  description,
  value,
  defaultValue,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  description: string
  value: number
  defaultValue: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
}) {
  const isModified = value !== defaultValue
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-800">{label}</label>
        <span className={`text-sm tabular-nums font-mono ${isModified ? 'text-blue-600 font-semibold' : 'text-gray-500'}`}>
          {value}{unit ?? ''}
        </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-600 h-2"
      />
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>{min}{unit ?? ''}</span>
        <span>{max}{unit ?? ''}</span>
      </div>
    </div>
  )
}

export default function SettingsContent() {
  const [settings, setSettings] = useState<SttSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      getSttSettings().catch(() => null),
      getLlmSettings().catch(() => null),
      getHfSettings().catch(() => null),
    ]).then(([stt, llm, hf]) => {
      if (stt) setSettings(stt)
      else setError('설정을 불러오지 못했습니다.')
      if (llm) {
        setLlmSettings(llm)
        setSelectedPreset(llm.active_preset || 'anthropic')
        // 서버 프리셋 데이터로 로컬 캐시 초기화
        const cache: Record<string, PresetFormState> = {}
        for (const [id, preset] of Object.entries(llm.presets || {})) {
          cache[id] = {
            auth_token: '',  // 마스킹된 값이므로 비워둠
            base_url: preset.base_url || SERVICE_PRESETS.find((p) => p.id === id)?.defaultBaseUrl || '',
            model: preset.model || '',
            max_input_tokens: preset.max_input_tokens || 200000,
            max_output_tokens: preset.max_output_tokens || 10000,
          }
        }
        setPresetCache(cache)
      }
      if (hf) setHfSettings(hf)
    }).finally(() => setLoading(false))
  }, [])

  const handleEngineChange = async (engine: string) => {
    if (!settings || engine === settings.stt_engine) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await updateSttEngine(engine)
      setSettings((prev) => prev ? { ...prev, stt_engine: result.stt_engine, model_loaded: result.model_loaded } : prev)
      setSuccess(`STT 모델이 "${ENGINE_LABELS[engine] ?? engine}"으로 변경되었습니다.`)
    } catch (err) {
      if (err instanceof HTTPError) {
        const body = await err.response.json().catch(() => ({})) as Record<string, string>
        setError(body.error ?? body.detail ?? 'STT 모델 변경에 실패했습니다.')
      } else {
        setError('STT 모델 변경에 실패했습니다.')
      }
    } finally {
      setSaving(false)
    }
  }

  // LLM 설정 — 프리셋별 폼 캐시
  interface PresetFormState {
    auth_token: string
    base_url: string
    model: string
    max_input_tokens: number
    max_output_tokens: number
  }

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

  // 현재 선택된 프리셋의 폼 값
  const currentForm = presetCache[selectedPreset] || { auth_token: '', base_url: '', model: '' }
  const updateCurrentForm = (updates: Partial<PresetFormState>) => {
    setPresetCache((c) => ({
      ...c,
      [selectedPreset]: { ...currentForm, ...updates },
    }))
  }

  const handlePresetSelect = (presetId: string) => {
    setSelectedPreset(presetId)
    // 캐시에 없으면 기본값으로 초기화
    if (!presetCache[presetId]) {
      const presetDef = SERVICE_PRESETS.find((p) => p.id === presetId)!
      setPresetCache((c) => ({
        ...c,
        [presetId]: {
          auth_token: '',
          base_url: presetDef.defaultBaseUrl,
          model: presetDef.suggestedModels[0] ?? '',
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
  }, [currentForm.model, selectedPreset])

  useEffect(() => {
    if (selectedPreset === 'ollama' && currentForm.base_url) {
      loadOllamaModels(currentForm.base_url)
    }
  }, [selectedPreset, currentForm.base_url, loadOllamaModels])

  const currentPreset = SERVICE_PRESETS.find((p) => p.id === selectedPreset)!
  const modelOptions = selectedPreset === 'ollama' ? ollamaModels : currentPreset.suggestedModels
  const showModelSelect = modelOptions.length > 0 && !useCustomModel

  const handleLlmTest = async () => {
    setLlmTesting(true)
    setLlmTestResult(null)
    try {
      const testParams: { provider: string; model: string; auth_token?: string; base_url?: string } = {
        provider: currentPreset.provider,
        model: currentForm.model,
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

      const result = await updateLlmSettings({
        active_preset: selectedPreset,
        preset_id: selectedPreset,
        preset_data: presetData,
      })
      setLlmSettings(result)
      updateCurrentForm({ auth_token: '' })
      setLlmSuccess('AI 설정이 저장되었습니다.')
    } catch {
      setLlmError('AI 설정 저장에 실패했습니다.')
    } finally {
      setLlmSaving(false)
    }
  }

  // HuggingFace 설정
  const [hfSettings, setHfSettings] = useState<HfSettings | null>(null)
  const [hfToken, setHfToken] = useState('')
  const [hfSaving, setHfSaving] = useState(false)
  const [hfSuccess, setHfSuccess] = useState<string | null>(null)
  const [hfError, setHfError] = useState<string | null>(null)

  const handleHfSave = async () => {
    if (!hfToken.trim()) return
    setHfSaving(true)
    setHfError(null)
    setHfSuccess(null)
    try {
      const result = await updateHfToken(hfToken.trim())
      setHfSettings(result)
      setHfToken('')
      setHfSuccess('HuggingFace 토큰이 저장되었습니다.')
    } catch {
      setHfError('HuggingFace 토큰 저장에 실패했습니다.')
    } finally {
      setHfSaving(false)
    }
  }

  const summaryIntervalSec = useAppSettingsStore((s) => s.summaryIntervalSec)
  const setSummaryIntervalSec = useAppSettingsStore((s) => s.setSummaryIntervalSec)

  const selectedLanguages = useAppSettingsStore((s) => s.selectedLanguages)
  const toggleLanguage = useAppSettingsStore((s) => s.toggleLanguage)

  const audioOverrides = useAppSettingsStore((s) => s.audioOverrides)
  const setAudioOverride = useAppSettingsStore((s) => s.setAudioOverride)
  const resetAudioOverrides = useAppSettingsStore((s) => s.resetAudioOverrides)

  const diarizationEnabled = useAppSettingsStore((s) => s.diarizationEnabled)
  const setDiarizationEnabled = useAppSettingsStore((s) => s.setDiarizationEnabled)

  const diarizationOverrides = useAppSettingsStore((s) => s.diarizationOverrides)
  const setDiarizationOverride = useAppSettingsStore((s) => s.setDiarizationOverride)
  const resetDiarizationOverrides = useAppSettingsStore((s) => s.resetDiarizationOverrides)

  // 현재 유효값: 오버라이드가 있으면 오버라이드, 없으면 config.yaml 기본값
  const av = (key: keyof typeof AUDIO) => (audioOverrides as Record<string, number>)[key] ?? AUDIO[key]
  const dv = (key: keyof typeof DIARIZATION) => (diarizationOverrides as Record<string, number>)[key] ?? DIARIZATION[key]

  const hasAudioOverrides = Object.keys(audioOverrides).length > 0
  const hasDiarizationOverrides = Object.keys(diarizationOverrides).length > 0

  return (
    <div className="max-w-2xl space-y-6">
      {/* STT 모델 설정 */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold mb-1">STT 모델</h2>
        <p className="text-sm text-muted-foreground mb-4">음성 인식에 사용할 엔진을 선택합니다. 파일 업로드 시에는 Whisper가 자동 선택됩니다.</p>

        {loading && (
          <p className="text-sm text-muted-foreground">불러오는 중...</p>
        )}

        {!loading && settings && (
          <div className="space-y-2">
            {settings.available_engines.map((engine) => (
              <label
                key={engine}
                className="flex items-center gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <input
                  type="radio"
                  name="stt_engine"
                  value={engine}
                  checked={settings.stt_engine === engine}
                  onChange={() => handleEngineChange(engine)}
                  disabled={saving}
                  className="accent-primary"
                />
                <div>
                  <p className="text-sm font-medium">{ENGINE_LABELS[engine] ?? engine}</p>
                  {settings.stt_engine === engine && (
                    <p className="text-xs text-muted-foreground">
                      {settings.model_loaded ? '모델 로드됨' : '모델 로드 중...'}
                    </p>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}

        {saving && (
          <p className="mt-3 text-sm text-blue-600">모델 변경 중... (모델에 따라 시간이 걸릴 수 있습니다)</p>
        )}
        {error && (
          <p className="mt-3 text-sm text-red-600">{error}</p>
        )}
        {success && (
          <p className="mt-3 text-sm text-green-600">{success}</p>
        )}
      </div>

      {/* 회의 언어 설정 */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold mb-1">회의 언어</h2>
        <p className="text-sm text-muted-foreground mb-4">
          회의에서 사용되는 언어를 선택합니다. 여러 언어를 동시에 선택할 수 있습니다.
        </p>

        <div className="space-y-2">
          {LANGUAGES.map((lang) => {
            const checked = selectedLanguages.includes(lang.code)
            const isOnly = checked && selectedLanguages.length === 1
            return (
              <label
                key={lang.code}
                className="flex items-center gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isOnly}
                  onChange={() => toggleLanguage(lang.code)}
                  className="accent-blue-600 w-4 h-4"
                />
                <span className="text-sm font-medium">{lang.label}</span>
                <span className="text-xs text-muted-foreground">({lang.code})</span>
              </label>
            )
          })}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          선택한 언어의 음성만 인식됩니다. 최소 1개 이상 선택해야 합니다.
        </p>
      </div>

      {/* AI (LLM) 설정 */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold mb-1">AI 요약 모델</h2>
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
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono"
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
                  className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono"
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
              <label className="block text-sm font-medium">모델명</label>
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
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono bg-white"
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
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono"
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
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono"
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
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono"
              />
              <p className="text-xs text-muted-foreground mt-1">기본: 32,768 (회의록이 길면 늘리세요)</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            사용 중인 모델의 스펙에 맞게 설정하세요. 모르겠으면 기본값을 유지하면 됩니다.
          </p>

          {/* 버튼 + 결과 */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleLlmTest}
              disabled={llmTesting || !currentForm.model}
              className="px-4 py-2 rounded-md text-sm font-medium border border-blue-600 text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
            >
              {llmTesting ? '테스트 중...' : '연결 테스트'}
            </button>
            <button
              onClick={handleLlmSave}
              disabled={llmSaving}
              className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
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

      {/* AI 회의록 적용 주기 설정 */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold mb-1">AI 회의록 적용 주기</h2>
        <p className="text-sm text-muted-foreground mb-4">
          라이브 기록을 AI 회의록에 반영하는 간격을 설정합니다.
        </p>

        <div className="flex flex-wrap gap-2">
          {SUMMARY_INTERVAL_OPTIONS.map((opt) => {
            const selected = summaryIntervalSec === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => setSummaryIntervalSec(opt.value)}
                className={`
                  px-4 py-2 rounded-full text-sm font-medium border transition-all
                  ${selected
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:text-blue-600'
                  }
                `}
              >
                {opt.label}
              </button>
            )
          })}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          {summaryIntervalSec === 0
            ? '"안함" 선택 시 녹음 중 실시간 요약 없이, 회의 종료 시 한 번만 정리합니다.'
            : '주기가 짧을수록 회의록이 자주 갱신되지만, AI 처리 부하가 높아질 수 있습니다.'}
        </p>
      </div>

      {/* 회의록 양식 관리 */}
      <PromptTemplateManager />

      {/* 음성 청킹 설정 */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">음성 청킹 설정</h2>
          {hasAudioOverrides && (
            <button
              onClick={resetAudioOverrides}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              기본값으로 초기화
            </button>
          )}
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          음성 감지 및 청크 분할을 세밀하게 조정합니다. 변경사항은 다음 녹음부터 적용됩니다.
        </p>

        <div className="space-y-5">
          <SettingSlider
            label="음성 감지 민감도"
            description="RMS 에너지 기준값. 낮을수록 작은 소리도 음성으로 인식합니다. 주변 소음이 많으면 높이세요."
            value={av('silence_threshold')}
            defaultValue={AUDIO_DEFAULTS.silence_threshold}
            min={0.01} max={0.10} step={0.01}
            onChange={(v) => setAudioOverride('silence_threshold', v)}
          />
          <SettingSlider
            label="음성 복귀 기준"
            description="무음 판정 후 다시 음성으로 전환되는 기준값. 음성 감지 민감도보다 높아야 합니다."
            value={av('speech_threshold')}
            defaultValue={AUDIO_DEFAULTS.speech_threshold}
            min={0.02} max={0.20} step={0.01}
            onChange={(v) => setAudioOverride('speech_threshold', v)}
          />
          <SettingSlider
            label="무음 지속 시간"
            description="이 시간만큼 무음이 지속되면 하나의 청크로 전송합니다. 짧으면 빠른 응답, 길면 자연스러운 문장 단위."
            value={av('silence_duration_ms')}
            defaultValue={AUDIO_DEFAULTS.silence_duration_ms}
            min={300} max={2000} step={100}
            unit="ms"
            onChange={(v) => setAudioOverride('silence_duration_ms', v)}
          />
          <SettingSlider
            label="최대 청크 길이"
            description="연속 발화 시 강제로 분할하는 최대 시간. 너무 길면 STT 처리가 느려질 수 있습니다."
            value={av('max_chunk_sec')}
            defaultValue={AUDIO_DEFAULTS.max_chunk_sec}
            min={5} max={30} step={1}
            unit="초"
            onChange={(v) => setAudioOverride('max_chunk_sec', v)}
          />
          <SettingSlider
            label="최소 청크 길이"
            description="이보다 짧은 음성 구간은 무시됩니다. 짧은 소음이나 기침 등을 필터링합니다."
            value={av('min_chunk_sec')}
            defaultValue={AUDIO_DEFAULTS.min_chunk_sec}
            min={1} max={5} step={0.5}
            unit="초"
            onChange={(v) => setAudioOverride('min_chunk_sec', v)}
          />
          <SettingSlider
            label="프리롤"
            description="음성이 시작되기 전에 포함되는 여유 시간. 첫 음절이 잘리는 것을 방지합니다."
            value={av('preroll_ms')}
            defaultValue={AUDIO_DEFAULTS.preroll_ms}
            min={100} max={500} step={50}
            unit="ms"
            onChange={(v) => setAudioOverride('preroll_ms', v)}
          />
          <SettingSlider
            label="청크 간 겹침"
            description="이전 청크의 끝부분을 다음 청크에 포함시킵니다. 청크 경계에서 음절이 잘리는 것을 방지합니다."
            value={av('overlap_ms')}
            defaultValue={AUDIO_DEFAULTS.overlap_ms}
            min={0} max={500} step={50}
            unit="ms"
            onChange={(v) => setAudioOverride('overlap_ms', v)}
          />
          <SettingSlider
            label="파일 STT 청크 분할"
            description={`파일 업로드 및 STT 재생성 시 오디오를 이 길이로 분할하여 처리합니다. 0이면 분할하지 않습니다.${selectedLanguages.length > 1 ? ' 다국어 사용 시 10~15초로 짧게 설정하면 언어 감지가 정확해집니다.' : ''}`}
            value={av('file_chunk_sec')}
            defaultValue={AUDIO_DEFAULTS.file_chunk_sec}
            min={0} max={60} step={5}
            unit="초"
            onChange={(v) => setAudioOverride('file_chunk_sec', v)}
          />
        </div>
      </div>

      {/* HuggingFace 설정 */}
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold mb-1">HuggingFace</h2>
        <p className="text-sm text-muted-foreground mb-4">
          화자 분리(pyannote) 모델 다운로드에 필요한 토큰입니다.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">HF Token</label>
            <input
              type="password"
              value={hfToken}
              onChange={(e) => setHfToken(e.target.value)}
              placeholder={hfSettings?.hf_token_masked || 'hf_...'}
              className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono"
            />
            {hfSettings?.has_token && !hfToken && (
              <p className="text-xs text-muted-foreground mt-1">현재: {hfSettings.hf_token_masked}</p>
            )}
            {hfSettings && !hfSettings.has_token && (
              <p className="text-xs text-yellow-600 mt-1">토큰 미설정 — 화자 분리 기능이 비활성화됩니다.</p>
            )}
          </div>
          <button
            onClick={handleHfSave}
            disabled={hfSaving || !hfToken.trim()}
            className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {hfSaving ? '저장 중...' : '저장'}
          </button>
          {hfError && <p className="text-sm text-red-600">{hfError}</p>}
          {hfSuccess && <p className="text-sm text-green-600">{hfSuccess}</p>}
          {hfSettings?.offline && (
            <p className="text-sm text-yellow-600">Sidecar 연결 불가 — 오프라인 상태</p>
          )}
        </div>
      </div>

      {/* 화자 분리 설정 */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">화자 분리 설정</h2>
          <div className="flex items-center gap-3">
            {hasDiarizationOverrides && (
              <button
                onClick={resetDiarizationOverrides}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                기본값으로 초기화
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3 mb-5">
          <div>
            <p className="text-sm font-medium">화자 분리 사용</p>
            <p className="text-xs text-muted-foreground">비활성화하면 화자 구분 없이 빠르게 녹음됩니다.</p>
          </div>
          <button
            onClick={() => setDiarizationEnabled(!diarizationEnabled)}
            className={`
              relative w-11 h-6 rounded-full transition-colors
              ${diarizationEnabled ? 'bg-blue-600' : 'bg-gray-300'}
            `}
          >
            <span
              className={`
                absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform
                ${diarizationEnabled ? 'translate-x-5' : 'translate-x-0'}
              `}
            />
          </button>
        </div>

        {!diarizationEnabled && (
          <p className="text-sm text-yellow-600 mb-4">
            화자 분리가 비활성화되어 있습니다. 모든 발화가 하나의 화자로 기록됩니다.
          </p>
        )}

        <div className={`space-y-5 ${!diarizationEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="rounded-md border border-blue-100 bg-blue-50/50 p-3 mb-2">
            <p className="text-xs text-blue-700">
              <span className="font-semibold">스트리밍 엔진</span> — 롤링 버퍼 방식으로 긴 컨텍스트에서 화자를 분리합니다.
              파일 업로드 시에는 WhisperX 배치 처리로 최고 정확도를 제공합니다.
            </p>
          </div>
          <SettingSlider
            label="화자 매칭 기준"
            description="임베딩 유사도가 이 값 이상이면 기존 화자로 인식합니다. 낮을수록 같은 화자로 쉽게 매칭되고, 높을수록 새 화자로 분리됩니다."
            value={dv('similarity_threshold')}
            defaultValue={DIARIZATION_DEFAULTS.similarity_threshold}
            min={0.10} max={0.60} step={0.05}
            onChange={(v) => setDiarizationOverride('similarity_threshold', v)}
          />
          <SettingSlider
            label="화자 병합 기준"
            description="처리 후 유사한 화자를 하나로 합치는 기준값. 높을수록 병합이 까다로워져 화자가 많아집니다."
            value={dv('merge_threshold')}
            defaultValue={DIARIZATION_DEFAULTS.merge_threshold}
            min={0.20} max={0.80} step={0.05}
            onChange={(v) => setDiarizationOverride('merge_threshold', v)}
          />
          <SettingSlider
            label="화자당 최대 임베딩 수"
            description="화자를 식별하기 위해 보관하는 음성 샘플 수. 많을수록 정확하지만 메모리를 더 사용합니다."
            value={dv('max_embeddings_per_speaker')}
            defaultValue={DIARIZATION_DEFAULTS.max_embeddings_per_speaker}
            min={3} max={25} step={1}
            unit="개"
            onChange={(v) => setDiarizationOverride('max_embeddings_per_speaker', v)}
          />
        </div>
      </div>
    </div>
  )
}
