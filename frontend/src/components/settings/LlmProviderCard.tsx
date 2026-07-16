import { useCallback, useEffect, useRef, useState } from 'react'
import { type ServicePreset, LOCAL_MODEL_FETCHERS, isLocalListable, isCloudListable, CLI_PRESET_IDS } from './llmServicePresets'
import { getMode } from '../../config'
import { PasswordInput } from '../ui/PasswordInput'

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
  /** 프리셋 그리드 앞에 놓이는 특수(비-프로바이더) 옵션. 예: '선택 안함', '요약과 동일', '서버 모델'. */
  noneOption?: { id: string; label: string; description: string }
  /** 특수 옵션이 2개 이상일 때 사용(예: AI 챗의 '요약과 동일' + '서버 모델'). 지정 시 noneOption보다 우선. */
  noneOptions?: readonly { id: string; label: string; description: string }[]
  value: LlmProviderCardValue
  maskedToken?: string
  showTokenLimits?: boolean
  /** true면 CLI 프리셋을 항상 노출(서버 원격 모드의 admin용). getMode()==='local' 과 OR. */
  admin?: boolean
  onSelectPreset: (presetId: string) => void
  onChange: (partial: Partial<LlmProviderCardValue>) => void
  /** 클라우드 프로바이더(anthropic/openai)의 모델 목록을 원격 조회하는 콜백. 지정 시 클라우드
   *  프리셋에도 '모델 새로고침' 버튼이 노출된다. 미지정(예: admin 패널)이면 클라우드 조회 비활성. */
  onFetchModels?: (args: { provider: string; base_url: string; api_key: string }) => Promise<string[]>
}

export function LlmProviderCard(props: LlmProviderCardProps) {
  const { title, idPrefix, presets, noneOption, noneOptions, value, maskedToken, showTokenLimits, admin, onSelectPreset, onChange, onFetchModels } = props
  // 특수 옵션들(비-프로바이더). noneOptions(복수)가 있으면 우선, 없으면 noneOption(단수) 1개로 정규화.
  const specialOptions = noneOptions ?? (noneOption ? [noneOption] : [])
  const [useCustomModel, setUseCustomModel] = useState(false)
  const [localModels, setLocalModels] = useState<string[]>([])
  const [localLoading, setLocalLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  // 클라우드(anthropic/openai) 모델 목록 — 로컬과 달리 키가 필요하므로 자동조회 안 하고 버튼으로만 조회.
  const [cloudModels, setCloudModels] = useState<string[]>([])
  const [cloudLoading, setCloudLoading] = useState(false)
  const [cloudError, setCloudError] = useState<string | null>(null)
  const modelRef = useRef(value.model)
  modelRef.current = value.model
  const loadGenRef = useRef(0)
  const baseUrlRef = useRef(value.base_url)
  baseUrlRef.current = value.base_url

  const preset = presets.find((p) => p.id === value.presetId)
  const isNone = specialOptions.some((o) => o.id === value.presetId)
  const isCli = CLI_PRESET_IDS.has(value.presetId)
  const requiresKey = preset?.requiresApiKey ?? false

  // CLI 프리셋은 CLI 실행 가능 환경(로컬 모드)에서만 노출한다. 단 원격 서버 모드라도
  // admin은 서버측 CLI를 관리해야 하므로 admin=true면 노출한다(아래 OR). 그 외(웹·모바일·
  // 데스크톱 원격, 비admin)에서는 숨기되, 이미 그 CLI를 저장해 둔 사용자에게는 잠금(비활성)
  // 버튼으로 남겨 안내한다.
  const cliAllowed = getMode() === 'local' || !!admin
  const visiblePresets = cliAllowed
    ? presets
    : presets.filter((p) => !CLI_PRESET_IDS.has(p.id) || p.id === value.presetId)

  const loadLocal = useCallback(async (baseUrl: string) => {
    const gen = ++loadGenRef.current
    setLocalLoading(true); setLocalError(null)
    try {
      const fetcher = LOCAL_MODEL_FETCHERS[value.presetId]
      const models = fetcher ? await fetcher(baseUrl) : []
      if (gen !== loadGenRef.current) return // out-of-order: a newer load superseded this one
      setLocalModels(models)
      if (models.length > 0 && !modelRef.current) onChange({ model: models[0] })
    } catch {
      if (gen !== loadGenRef.current) return
      setLocalError('로컬 서버에 연결할 수 없습니다. 실행 중인지 확인하세요.')
      setLocalModels([])
    } finally { if (gen === loadGenRef.current) setLocalLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.presetId])

  useEffect(() => {
    // Auto-fetch on preset-change/mount only; base_url is intentionally excluded so
    // typing in the URL field does not fire a request per keystroke (use 모델 새로고침).
    if (isLocalListable(value.presetId) && baseUrlRef.current) loadLocal(baseUrlRef.current)
    else if (!isLocalListable(value.presetId) && localModels.length > 0) { setLocalModels([]); setLocalError(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.presetId, loadLocal])

  // Reset '직접 입력' (custom model) toggle when the preset changes, so a switched-to
  // preset shows its model SELECT instead of a stale free-text input.
  useEffect(() => { setUseCustomModel(false) }, [value.presetId])

  // 클라우드 프로바이더 모델 목록 조회(수동 새로고침 전용 — 키가 필요해 자동 조회하지 않는다).
  // loadGenRef 를 로컬 조회와 공유해 로컬↔클라우드 전환 중 out-of-order 응답도 함께 무시한다.
  const loadCloud = useCallback(async () => {
    const p = presets.find((x) => x.id === value.presetId)
    if (!onFetchModels || !p) return
    const gen = ++loadGenRef.current
    setCloudLoading(true); setCloudError(null)
    try {
      const models = await onFetchModels({ provider: p.provider, base_url: value.base_url, api_key: value.auth_token })
      if (gen !== loadGenRef.current) return
      setCloudModels(models)
      if (models.length > 0 && !modelRef.current) onChange({ model: models[0] })
    } catch {
      if (gen !== loadGenRef.current) return
      setCloudError('모델 목록을 불러올 수 없습니다. API 키·Base URL을 확인하세요.')
      setCloudModels([])
    } finally { if (gen === loadGenRef.current) setCloudLoading(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.presetId, value.base_url, value.auth_token, onFetchModels])

  // 프리셋이 바뀌면 이전 클라우드 목록/에러를 비운다(자동 재조회 없음 — 버튼으로만).
  useEffect(() => { setCloudModels([]); setCloudError(null) }, [value.presetId])

  const cloudActive = !!onFetchModels && isCloudListable(value.presetId)
  // 동적 목록: 로컬은 localModels, 클라우드는 cloudModels. 비었으면 하드코딩 추천목록으로 폴백.
  const dynamicModels = isLocalListable(value.presetId) ? localModels : cloudModels
  const modelOptions = dynamicModels.length > 0 ? dynamicModels : (preset?.suggestedModels ?? [])
  const showModelSelect = modelOptions.length > 0 && !useCustomModel
  const canRefresh = isLocalListable(value.presetId) || cloudActive
  const refreshing = isLocalListable(value.presetId) ? localLoading : cloudLoading
  const listError = isLocalListable(value.presetId) ? localError : cloudError

  return (
    <div className="rounded-lg border bg-card p-4" data-testid={`${idPrefix}-card`}>
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      <div role="group" data-testid={`${idPrefix}-service-grid`} className="grid grid-cols-4 gap-2 mb-3">
        {specialOptions.map((opt) => {
          const active = opt.id === value.presetId
          return (
            <button key={opt.id || '__none__'} type="button" aria-pressed={active}
              onClick={() => { if (opt.id !== value.presetId) onSelectPreset(opt.id) }}
              className={cardCls(active)}>
              <p className="text-sm font-medium">{opt.label}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{opt.description}</p>
            </button>
          )
        })}
        {visiblePresets.map((p) => {
          // CLI 잠금: server 모드에서 저장값이라 남아있는 CLI 프리셋은 선택 불가.
          const locked = !cliAllowed && CLI_PRESET_IDS.has(p.id)
          return (
            <button key={p.id} type="button" aria-pressed={value.presetId === p.id}
              disabled={locked} aria-disabled={locked}
              onClick={() => { if (!locked && p.id !== value.presetId) onSelectPreset(p.id) }}
              className={`${cardCls(value.presetId === p.id)}${locked ? ' opacity-60 cursor-not-allowed' : ''}`}>
              <p className="text-sm font-medium">{p.name}{locked && ' 🔒'}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{locked ? '이 환경에서 사용 불가' : p.description}</p>
            </button>
          )
        })}
      </div>

      {!isNone && (<>
      {isCli && (cliAllowed ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-3">
          <p className="font-medium mb-1">CLI 모드 안내</p>
          <p className="text-xs leading-relaxed">CLI 모드는 호출마다 프로세스를 새로 시작하여 <strong>약 6~7초 지연</strong>이 발생합니다. 실시간에는 부적합하며 일회성 테스트·배치에 적합합니다.</p>
        </div>
      ) : (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 mb-3">
          <p className="font-medium mb-1">CLI 사용 불가</p>
          <p className="text-xs leading-relaxed">이 환경에서는 CLI를 사용할 수 없습니다. 다른 프로바이더를 선택하세요.</p>
        </div>
      ))}

      {!isCli && (
        <div className="mb-3">
          <label htmlFor={`${idPrefix}-base`} className="block text-sm font-medium mb-1">API Base URL</label>
          <input id={`${idPrefix}-base`} type="text" value={value.base_url}
            onChange={(e) => onChange({ base_url: e.target.value })}
            placeholder={preset?.defaultBaseUrl || 'https://api.anthropic.com'}
            className="w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[44px]" />
        </div>
      )}

      {requiresKey && (
        <div className="mb-3">
          <label htmlFor={`${idPrefix}-key`} className="block text-sm font-medium mb-1">API Key</label>
          <PasswordInput id={`${idPrefix}-key`} value={value.auth_token}
            onChange={(e) => onChange({ auth_token: e.target.value })}
            placeholder={maskedToken || '토큰을 입력하세요'}
            className="w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[44px]" />
          {maskedToken && !value.auth_token && <p className="text-xs text-muted-foreground mt-1">현재: {maskedToken}</p>}
        </div>
      )}

      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <label htmlFor={`${idPrefix}-model`} className="block text-sm font-medium">모델명</label>
          <div className="flex gap-2">
            {modelOptions.length > 0 && (
              <button type="button" onClick={() => setUseCustomModel((v) => !v)} className="text-xs text-blue-600 hover:text-blue-800">
                {useCustomModel ? '목록에서 선택' : '직접 입력'}
              </button>
            )}
            {canRefresh && (
              <button type="button" aria-label="모델 새로고침" disabled={refreshing}
                onClick={() => (isLocalListable(value.presetId) ? loadLocal(value.base_url) : loadCloud())}
                className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50">
                {refreshing ? (isLocalListable(value.presetId) ? '감지 중...' : '불러오는 중...') : '모델 새로고침'}
              </button>
            )}
          </div>
        </div>
        {showModelSelect ? (
          <select id={`${idPrefix}-model`} value={value.model} onChange={(e) => onChange({ model: e.target.value })}
            className="w-full rounded-md border px-3 py-2 text-sm bg-card font-mono min-h-[44px]">
            {(value.model && !modelOptions.includes(value.model) ? [...modelOptions, value.model] : modelOptions).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        ) : (
          <input id={`${idPrefix}-model`} type="text" value={value.model} onChange={(e) => onChange({ model: e.target.value })}
            placeholder="모델명을 입력하세요" className="w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[44px]" />
        )}
        {canRefresh && listError && <p className="text-xs text-yellow-600 mt-1">{listError}</p>}
      </div>

      {showTokenLimits && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${idPrefix}-maxin`} className="block text-sm font-medium mb-1">최대 입력 토큰</label>
            <input id={`${idPrefix}-maxin`} type="number" min={1} value={value.max_input_tokens ?? 200000}
              onChange={(e) => { const v = e.target.value; const n = v === '' ? undefined : parseInt(v, 10); onChange({ max_input_tokens: Number.isNaN(n) ? undefined : n }) }}
              className="w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[44px]" />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-maxout`} className="block text-sm font-medium mb-1">최대 출력 토큰</label>
            <input id={`${idPrefix}-maxout`} type="number" min={1} value={value.max_output_tokens ?? 10000}
              onChange={(e) => { const v = e.target.value; const n = v === '' ? undefined : parseInt(v, 10); onChange({ max_output_tokens: Number.isNaN(n) ? undefined : n }) }}
              className="w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[44px]" />
          </div>
        </div>
      )}
      </>)}
    </div>
  )
}

const cardCls = (active: boolean) =>
  `rounded-lg border p-3 text-left transition-all ${active ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-border hover:border-blue-300 hover:bg-accent'}`

export default LlmProviderCard
