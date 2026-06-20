import { useCallback, useEffect, useState } from 'react'
import { type ServicePreset, LOCAL_MODEL_FETCHERS, isLocalListable, CLI_PRESET_IDS } from './llmServicePresets'

export interface LlmProviderCardValue {
  presetId: string
  base_url: string
  model: string
  auth_token: string
  max_input_tokens?: number
  max_output_tokens?: number
}

export interface LlmProviderCardProps {
  title: string
  idPrefix: string
  presets: readonly ServicePreset[]
  noneOption?: { id: string; label: string; description: string }
  value: LlmProviderCardValue
  maskedToken?: string
  showTokenLimits?: boolean
  showCliBanner?: boolean
  onSelectPreset: (presetId: string) => void
  onChange: (partial: Partial<LlmProviderCardValue>) => void
}

export function LlmProviderCard(props: LlmProviderCardProps) {
  const { title, idPrefix, presets, noneOption, value, maskedToken, showTokenLimits, showCliBanner = true, onSelectPreset, onChange } = props
  const [useCustomModel, setUseCustomModel] = useState(false)
  const [localModels, setLocalModels] = useState<string[]>([])
  const [localLoading, setLocalLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const preset = presets.find((p) => p.id === value.presetId)
  const isNone = !!noneOption && value.presetId === noneOption.id
  const isCli = CLI_PRESET_IDS.has(value.presetId)
  const requiresKey = preset?.requiresApiKey ?? false

  const loadLocal = useCallback(async (baseUrl: string) => {
    setLocalLoading(true); setLocalError(null)
    try {
      const fetcher = LOCAL_MODEL_FETCHERS[value.presetId]
      const models = fetcher ? await fetcher(baseUrl) : []
      setLocalModels(models)
      if (models.length > 0 && !value.model) onChange({ model: models[0] })
    } catch {
      setLocalError('로컬 서버에 연결할 수 없습니다. 실행 중인지 확인하세요.')
      setLocalModels([])
    } finally { setLocalLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.presetId, value.model])

  useEffect(() => {
    if (isLocalListable(value.presetId) && value.base_url) loadLocal(value.base_url)
    else { setLocalModels([]); setLocalError(null) }
  }, [value.presetId, value.base_url, loadLocal])

  const modelOptions = isLocalListable(value.presetId) ? localModels : (preset?.suggestedModels ?? [])
  const showModelSelect = modelOptions.length > 0 && !useCustomModel

  return (
    <div className="rounded-lg border bg-card p-4" data-testid={`${idPrefix}-card`}>
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      <div role="group" data-testid={`${idPrefix}-service-grid`} className="grid grid-cols-4 gap-2 mb-3">
        {noneOption && (
          <button type="button" aria-pressed={isNone} onClick={() => onSelectPreset(noneOption.id)}
            className={cardCls(isNone)}>
            <p className="text-sm font-medium">{noneOption.label}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{noneOption.description}</p>
          </button>
        )}
        {presets.map((p) => (
          <button key={p.id} type="button" aria-pressed={value.presetId === p.id} onClick={() => onSelectPreset(p.id)}
            className={cardCls(value.presetId === p.id)}>
            <p className="text-sm font-medium">{p.name}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{p.description}</p>
          </button>
        ))}
      </div>

      {!isNone && showCliBanner && isCli && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-3">
          <p className="font-medium mb-1">CLI 모드 안내</p>
          <p className="text-xs leading-relaxed">CLI 모드는 호출마다 프로세스를 새로 시작하여 <strong>약 6~7초 지연</strong>이 발생합니다. 실시간에는 부적합하며 일회성 테스트·배치에 적합합니다.</p>
        </div>
      )}

      {!isNone && !isCli && (
        <div className="mb-3">
          <label htmlFor={`${idPrefix}-base`} className="block text-sm font-medium mb-1">API Base URL</label>
          <input id={`${idPrefix}-base`} type="text" value={value.base_url}
            onChange={(e) => onChange({ base_url: e.target.value })}
            placeholder={preset?.defaultBaseUrl || 'https://api.anthropic.com'}
            className="w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[44px]" />
        </div>
      )}

      {!isNone && requiresKey && (
        <div className="mb-3">
          <label htmlFor={`${idPrefix}-key`} className="block text-sm font-medium mb-1">API Key</label>
          <input id={`${idPrefix}-key`} type="password" value={value.auth_token}
            onChange={(e) => onChange({ auth_token: e.target.value })}
            placeholder={maskedToken || '토큰을 입력하세요'}
            className="w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[44px]" />
          {maskedToken && !value.auth_token && <p className="text-xs text-muted-foreground mt-1">현재: {maskedToken}</p>}
        </div>
      )}

      {!isNone && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <label htmlFor={`${idPrefix}-model`} className="block text-sm font-medium">모델명</label>
            <div className="flex gap-2">
              {modelOptions.length > 0 && (
                <button type="button" onClick={() => setUseCustomModel((v) => !v)} className="text-xs text-blue-600 hover:text-blue-800">
                  {useCustomModel ? '목록에서 선택' : '직접 입력'}
                </button>
              )}
              {isLocalListable(value.presetId) && (
                <button type="button" aria-label="모델 새로고침" disabled={localLoading}
                  onClick={() => loadLocal(value.base_url)} className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50">
                  {localLoading ? '감지 중...' : '모델 새로고침'}
                </button>
              )}
            </div>
          </div>
          {showModelSelect ? (
            <select id={`${idPrefix}-model`} value={value.model} onChange={(e) => onChange({ model: e.target.value })}
              className="w-full rounded-md border px-3 py-2 text-sm bg-white font-mono min-h-[44px]">
              {(value.model && !modelOptions.includes(value.model) ? [...modelOptions, value.model] : modelOptions).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <input id={`${idPrefix}-model`} type="text" value={value.model} onChange={(e) => onChange({ model: e.target.value })}
              placeholder="모델명을 입력하세요" className="w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[44px]" />
          )}
          {isLocalListable(value.presetId) && localError && <p className="text-xs text-yellow-600 mt-1">{localError}</p>}
        </div>
      )}

      {!isNone && showTokenLimits && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${idPrefix}-maxin`} className="block text-sm font-medium mb-1">최대 입력 토큰</label>
            <input id={`${idPrefix}-maxin`} type="number" value={value.max_input_tokens ?? 200000}
              onChange={(e) => onChange({ max_input_tokens: parseInt(e.target.value) || 0 })}
              className="w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[44px]" />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-maxout`} className="block text-sm font-medium mb-1">최대 출력 토큰</label>
            <input id={`${idPrefix}-maxout`} type="number" value={value.max_output_tokens ?? 10000}
              onChange={(e) => onChange({ max_output_tokens: parseInt(e.target.value) || 0 })}
              className="w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[44px]" />
          </div>
        </div>
      )}
    </div>
  )
}

const cardCls = (active: boolean) =>
  `rounded-lg border p-3 text-left transition-all ${active ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'}`

export default LlmProviderCard
