import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PROFILE_PRESETS,
  LOCAL_MODEL_FETCHERS,
  isLocalListable,
  isCloudListable,
  presetFormDefaults,
} from './llmServicePresets'
import { createLlmProfile, updateLlmProfile, type LlmProfile } from '../../api/llmProfiles'
import { testUserLlmConnection, fetchUserLlmModels, type UserLlmTestResult } from '../../api/userLlmSettings'
import { openExternal } from '../../lib/openExternal'
import { PasswordInput } from '../ui/PasswordInput'

export interface LlmProfileFormProps {
  scope: 'personal' | 'server'
  initial: LlmProfile | null
  onSaved: (profile: LlmProfile) => void
  onCancel: () => void
}

const cardCls = (active: boolean) =>
  `rounded-lg border p-3 text-left transition-all ${active ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-border hover:border-blue-300 hover:bg-accent'}`

const inputCls = 'w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[44px]'

export function LlmProfileForm({ scope, initial, onSaved, onCancel }: LlmProfileFormProps) {
  const [presetId, setPresetId] = useState(initial?.preset_id ?? 'anthropic')
  const [form, setForm] = useState({
    base_url: initial?.base_url ?? presetFormDefaults(initial?.preset_id ?? 'anthropic').base_url,
    model: initial?.model ?? presetFormDefaults(initial?.preset_id ?? 'anthropic').model,
    auth_token: '',
    name: initial?.name ?? '',
    max_input_tokens: initial?.max_input_tokens ?? 200000,
    max_output_tokens: initial?.max_output_tokens ?? 10000,
  })

  const [useCustomModel, setUseCustomModel] = useState(false)
  const [localModels, setLocalModels] = useState<string[]>([])
  const [localLoading, setLocalLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  // 클라우드(anthropic/openai) 모델 목록 — 로컬과 달리 키가 필요하므로 자동조회 안 하고 버튼으로만 조회.
  const [cloudModels, setCloudModels] = useState<string[]>([])
  const [cloudLoading, setCloudLoading] = useState(false)
  const [cloudError, setCloudError] = useState<string | null>(null)
  const modelRef = useRef(form.model)
  modelRef.current = form.model
  const loadGenRef = useRef(0)
  const baseUrlRef = useRef(form.base_url)
  baseUrlRef.current = form.base_url

  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<UserLlmTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const preset = PROFILE_PRESETS.find((p) => p.id === presetId)
  const requiresKey = preset?.requiresApiKey ?? false

  const loadLocal = useCallback(async (baseUrl: string) => {
    const gen = ++loadGenRef.current
    setLocalLoading(true); setLocalError(null)
    try {
      const fetcher = LOCAL_MODEL_FETCHERS[presetId]
      const models = fetcher ? await fetcher(baseUrl) : []
      if (gen !== loadGenRef.current) return // out-of-order: a newer load superseded this one
      setLocalModels(models)
      if (models.length > 0 && !modelRef.current) setForm((f) => ({ ...f, model: models[0] }))
    } catch {
      if (gen !== loadGenRef.current) return
      setLocalError('로컬 서버에 연결할 수 없습니다. 실행 중인지 확인하세요.')
      setLocalModels([])
    } finally { if (gen === loadGenRef.current) setLocalLoading(false) }
  }, [presetId])

  useEffect(() => {
    // Auto-fetch on preset-change/mount only; base_url is intentionally excluded so
    // typing in the URL field does not fire a request per keystroke (use 모델 새로고침).
    if (isLocalListable(presetId) && baseUrlRef.current) loadLocal(baseUrlRef.current)
    else if (!isLocalListable(presetId) && localModels.length > 0) { setLocalModels([]); setLocalError(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId, loadLocal])

  // Reset '직접 입력' (custom model) toggle when the preset changes, so a switched-to
  // preset shows its model SELECT instead of a stale free-text input.
  useEffect(() => { setUseCustomModel(false) }, [presetId])

  // 클라우드 프로바이더 모델 목록 조회(수동 새로고침 전용 — 키가 필요해 자동 조회하지 않는다).
  const loadCloud = useCallback(async () => {
    const p = PROFILE_PRESETS.find((x) => x.id === presetId)
    if (!p) return
    const gen = ++loadGenRef.current
    setCloudLoading(true); setCloudError(null)
    try {
      const models = await fetchUserLlmModels({ provider: p.provider, base_url: form.base_url, api_key: form.auth_token })
      if (gen !== loadGenRef.current) return
      setCloudModels(models)
      if (models.length > 0 && !modelRef.current) setForm((f) => ({ ...f, model: models[0] }))
    } catch {
      if (gen !== loadGenRef.current) return
      setCloudError('모델 목록을 불러올 수 없습니다. API 키·Base URL을 확인하세요.')
      setCloudModels([])
    } finally { if (gen === loadGenRef.current) setCloudLoading(false) }
  }, [presetId, form.base_url, form.auth_token])

  // 프리셋이 바뀌면 이전 클라우드 목록/에러를 비운다(자동 재조회 없음 — 버튼으로만).
  useEffect(() => { setCloudModels([]); setCloudError(null) }, [presetId])

  const cloudActive = isCloudListable(presetId)
  // 동적 목록: 로컬은 localModels, 클라우드는 cloudModels. 비었으면 하드코딩 추천목록으로 폴백.
  const dynamicModels = isLocalListable(presetId) ? localModels : cloudModels
  const modelOptions = dynamicModels.length > 0 ? dynamicModels : (preset?.suggestedModels ?? [])
  const showModelSelect = modelOptions.length > 0 && !useCustomModel
  const canRefresh = isLocalListable(presetId) || cloudActive
  const refreshing = isLocalListable(presetId) ? localLoading : cloudLoading
  const listError = isLocalListable(presetId) ? localError : cloudError

  const handleSelectPreset = (id: string) => {
    if (id === presetId) return
    const defaults = presetFormDefaults(id)
    setPresetId(id)
    setForm((f) => ({ ...f, base_url: defaults.base_url, model: defaults.model, auth_token: '' }))
    setTestResult(null)
    setError(null)
  }

  const autoName = () => {
    const base = preset?.name ?? presetId
    return form.model ? `${base} · ${form.model}` : base
  }

  const handleSave = async () => {
    setSaving(true); setError(null)
    try {
      const params = {
        name: form.name.trim() || autoName(),
        preset_id: presetId,
        provider: preset?.provider ?? 'openai',
        base_url: form.base_url || undefined,
        model: form.model || undefined,
        ...(form.auth_token ? { auth_token: form.auth_token } : {}),
        ...(scope === 'server' ? { max_input_tokens: form.max_input_tokens, max_output_tokens: form.max_output_tokens } : {}),
      }
      const saved = initial ? await updateLlmProfile(initial.id, params) : await createLlmProfile(scope, params)
      onSaved(saved)
    } catch {
      setError('프로필을 저장하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true); setTestResult(null)
    try {
      // 편집 중 키 미입력이면 profile_id로 저장된 키 폴백(백엔드 Task 3/4)
      const result = await testUserLlmConnection({
        provider: preset?.provider ?? 'openai', model: form.model,
        ...(form.auth_token ? { api_key: form.auth_token } : {}),
        ...(form.base_url ? { base_url: form.base_url } : {}),
        ...(!form.auth_token && initial ? { profile_id: initial.id } : {}),
      })
      setTestResult(result)
    } catch {
      setTestResult({ success: false, error: '연결 테스트에 실패했습니다.' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div role="group" data-testid="profile-preset-grid" className="grid grid-cols-4 gap-2">
        {PROFILE_PRESETS.map((p) => (
          <button key={p.id} type="button" aria-pressed={presetId === p.id}
            onClick={() => handleSelectPreset(p.id)}
            className={cardCls(presetId === p.id)}>
            <p className="text-sm font-medium">{p.name}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{p.description}</p>
          </button>
        ))}
      </div>

      <div>
        <label htmlFor="profile-base" className="block text-sm font-medium mb-1">API Base URL</label>
        <input id="profile-base" type="text" value={form.base_url}
          onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
          placeholder={preset?.defaultBaseUrl || 'https://api.anthropic.com'}
          className={inputCls} />
      </div>

      {requiresKey && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="profile-key" className="block text-sm font-medium">API Key</label>
            {preset?.apiKeyUrl && (
              <button type="button" onClick={() => openExternal(preset.apiKeyUrl!)}
                className="text-xs text-blue-600 hover:text-blue-800">
                API 키 발급 ↗
              </button>
            )}
          </div>
          <PasswordInput id="profile-key" value={form.auth_token}
            onChange={(e) => setForm((f) => ({ ...f, auth_token: e.target.value }))}
            placeholder={initial?.auth_token_masked ?? '토큰을 입력하세요'}
            className={inputCls} />
          {initial?.auth_token_masked && !form.auth_token && (
            <p className="text-xs text-muted-foreground mt-1">현재: {initial.auth_token_masked} — 비워두면 기존 키 유지</p>
          )}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <label htmlFor="profile-model" className="block text-sm font-medium">모델명</label>
          <div className="flex gap-2">
            {modelOptions.length > 0 && (
              <button type="button" onClick={() => setUseCustomModel((v) => !v)} className="text-xs text-blue-600 hover:text-blue-800">
                {useCustomModel ? '목록에서 선택' : '직접 입력'}
              </button>
            )}
            {canRefresh && (
              <button type="button" aria-label="모델 새로고침" disabled={refreshing}
                onClick={() => (isLocalListable(presetId) ? loadLocal(form.base_url) : loadCloud())}
                className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50">
                {refreshing ? (isLocalListable(presetId) ? '감지 중...' : '불러오는 중...') : '모델 새로고침'}
              </button>
            )}
          </div>
        </div>
        {showModelSelect ? (
          <select id="profile-model" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            className="w-full rounded-md border px-3 py-2 text-sm bg-card font-mono min-h-[44px]">
            {(form.model && !modelOptions.includes(form.model) ? [...modelOptions, form.model] : modelOptions).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        ) : (
          <input id="profile-model" type="text" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            placeholder="모델명을 입력하세요" className={inputCls} />
        )}
        {canRefresh && listError && <p className="text-xs text-yellow-600 mt-1">{listError}</p>}
      </div>

      {scope === 'server' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="profile-maxin" className="block text-sm font-medium mb-1">최대 입력 토큰</label>
            <input id="profile-maxin" type="number" min={1} value={form.max_input_tokens}
              onChange={(e) => {
                const v = e.target.value
                const n = v === '' ? NaN : parseInt(v, 10)
                setForm((f) => ({ ...f, max_input_tokens: Number.isNaN(n) ? f.max_input_tokens : n }))
              }}
              className={inputCls} />
          </div>
          <div>
            <label htmlFor="profile-maxout" className="block text-sm font-medium mb-1">최대 출력 토큰</label>
            <input id="profile-maxout" type="number" min={1} value={form.max_output_tokens}
              onChange={(e) => {
                const v = e.target.value
                const n = v === '' ? NaN : parseInt(v, 10)
                setForm((f) => ({ ...f, max_output_tokens: Number.isNaN(n) ? f.max_output_tokens : n }))
              }}
              className={inputCls} />
          </div>
        </div>
      )}

      <div>
        <label htmlFor="profile-name" className="block text-sm font-medium mb-1">프로필 이름</label>
        <input id="profile-name" type="text" value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder={autoName()}
          className={inputCls} />
      </div>

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

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

      <div className="flex items-center gap-2">
        <button type="button" onClick={onCancel}
          className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent transition-colors min-h-[44px]">
          취소
        </button>
        <button type="button" onClick={handleTest} disabled={testing || !form.model}
          className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors min-h-[44px]">
          {testing ? '테스트 중...' : '연결 테스트'}
        </button>
        <button type="button" onClick={handleSave} disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors min-h-[44px]">
          {saving ? '저장 중...' : '프로필 저장'}
        </button>
      </div>
    </div>
  )
}

export default LlmProfileForm
