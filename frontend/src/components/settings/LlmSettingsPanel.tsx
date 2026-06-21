import { useState, useEffect } from 'react'
import { getLlmSettings, updateLlmSettings, testLlmConnection } from '../../api/settings'
import type { LlmSettings } from '../../api/settings'
import { SERVICE_PRESETS, presetFormDefaults } from './llmServicePresets'
import LlmProviderCard from './LlmProviderCard'
import type { LlmProviderCardValue } from './LlmProviderCard'

interface PresetFormState {
  auth_token: string
  base_url: string
  model: string
  max_input_tokens: number
  max_output_tokens: number
}

/** AI(LLM) 요약/챗 모델 설정 카드: 요약 카드 + AI 챗 카드 2분할. */
export function LlmSettingsPanel() {
  const [llmSettings, setLlmSettings] = useState<LlmSettings | null>(null)
  const [presetCache, setPresetCache] = useState<Record<string, PresetFormState>>({})
  const [selectedPreset, setSelectedPreset] = useState('anthropic')
  const [llmSaving, setLlmSaving] = useState(false)
  const [llmSuccess, setLlmSuccess] = useState<string | null>(null)
  const [llmError, setLlmError] = useState<string | null>(null)
  const [llmTesting, setLlmTesting] = useState(false)
  const [llmTestResult, setLlmTestResult] = useState<{ success: boolean; error?: string } | null>(null)
  const [chatPresetId, setChatPresetId] = useState('')      // '' = 요약과 동일
  const [chatForm, setChatForm] = useState({ base_url: '', model: '', auth_token: '' })
  const [chatMaskedToken, setChatMaskedToken] = useState('')

  useEffect(() => {
    getLlmSettings().then((llm) => {
      if (!llm) return
      setLlmSettings(llm)
      setSelectedPreset(llm.active_preset || 'anthropic')
      const chat = llm.chat
      if (chat && chat.provider) {
        setChatPresetId(chat.preset_id || '')
        setChatForm({ base_url: chat.base_url || '', model: chat.model || '', auth_token: '' })
        setChatMaskedToken(chat.auth_token_masked || '')
      } else {
        setChatPresetId('')
        setChatForm({ base_url: '', model: llm.chat_model || '', auth_token: '' })
        setChatMaskedToken('')
      }
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
  const updateCurrentForm = (updates: Partial<LlmProviderCardValue>) => {
    // 함수형 업데이터: 렌더 시점 스냅샷(currentForm)이 아니라 최신 캐시(c)에 병합한다.
    // 비동기 onChange(로컬 모델 자동채움 등)가 동시 편집(base_url/token)을 덮어쓰는 것을 방지.
    setPresetCache((c) => ({
      ...c,
      [selectedPreset]: { ...(c[selectedPreset] ?? currentForm), ...updates },
    }))
  }

  const handlePresetSelect = (presetId: string) => {
    setSelectedPreset(presetId)
    if (!presetCache[presetId]) {
      setPresetCache((c) => ({
        ...c,
        [presetId]: { ...presetFormDefaults(presetId), max_input_tokens: 200000, max_output_tokens: 10000 },
      }))
    }
    setLlmTestResult(null)
  }

  const handleChatServiceSelect = (id: string) => {
    setChatPresetId(id)
    setChatForm(presetFormDefaults(id))
    setChatMaskedToken('')
  }

  // selectedPreset이 SERVICE_PRESETS에 없는 id(예: 백엔드의 out-of-band active_preset)일 수 있으므로
  // non-null 단언 대신 안전한 기본 프리셋(anthropic, 없으면 첫 항목)으로 폴백한다. 유효 프리셋 동작은 불변.
  const currentPreset =
    SERVICE_PRESETS.find((p) => p.id === selectedPreset) ??
    SERVICE_PRESETS.find((p) => p.id === 'anthropic') ??
    SERVICE_PRESETS[0]
  const chatPreset = SERVICE_PRESETS.find((p) => p.id === chatPresetId)
  const chatActualProvider = chatPreset?.provider ?? ''

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
              base_url: chatForm.base_url,
              model: chatForm.model,
              ...(chatForm.auth_token ? { auth_token: chatForm.auth_token } : {}),
            }

      const result = await updateLlmSettings({
        active_preset: selectedPreset,
        chat_model: chatPresetId === '' ? (chatForm.model.trim() || '') : '',
        chat: chatPayload,
        preset_id: selectedPreset,
        preset_data: presetData,
      })
      setLlmSettings(result)
      // 저장 응답으로 챗 폼 재초기화
      const rc = result.chat
      if (rc && rc.provider) {
        setChatPresetId(rc.preset_id || '')
        setChatForm({ base_url: rc.base_url || '', model: rc.model || '', auth_token: '' })
        setChatMaskedToken(rc.auth_token_masked || '')
      } else {
        setChatPresetId('')
        setChatForm({ base_url: '', model: result.chat_model || '', auth_token: '' })
        setChatMaskedToken('')
      }
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
        {/* 요약 모델 카드 */}
        <LlmProviderCard
          title="요약 모델"
          idPrefix="summary"
          presets={SERVICE_PRESETS}
          showTokenLimits
          value={{
            presetId: selectedPreset,
            base_url: currentForm.base_url,
            model: currentForm.model,
            auth_token: currentForm.auth_token,
            max_input_tokens: currentForm.max_input_tokens,
            max_output_tokens: currentForm.max_output_tokens,
          }}
          maskedToken={llmSettings?.presets?.[selectedPreset]?.auth_token_masked ?? undefined}
          onSelectPreset={handlePresetSelect}
          onChange={updateCurrentForm}
        />

        {/* AI 챗 모델 카드 */}
        <LlmProviderCard
          title="AI 챗 모델"
          idPrefix="chat"
          presets={SERVICE_PRESETS}
          noneOption={{ id: '', label: '요약과 동일', description: '요약 모델 그대로 사용' }}
          value={{ presetId: chatPresetId, ...chatForm }}
          maskedToken={chatMaskedToken || undefined}
          onSelectPreset={handleChatServiceSelect}
          onChange={(p) => setChatForm((f) => ({ ...f, ...p }))}
        />

        {/* ADDENDUM B: 레거시 챗 모델 입력 (요약과 동일일 때만) */}
        {chatPresetId === '' && (
          <div className="mt-2">
            <label htmlFor="chat-legacy-model" className="block text-xs text-gray-600 mb-1">챗 모델</label>
            <input
              id="chat-legacy-model"
              value={chatForm.model}
              onChange={(e) => setChatForm((f) => ({ ...f, model: e.target.value }))}
              placeholder="모델명을 입력하세요 (비우면 요약 모델)"
              className="w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[44px]"
            />
          </div>
        )}

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
