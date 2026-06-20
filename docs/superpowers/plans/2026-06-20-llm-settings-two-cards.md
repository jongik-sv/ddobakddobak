# LLM 설정 2카드 통합 (요약 / AI 챗) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 전역(`LlmSettingsPanel`)·개인(`UserLlmSettings`) LLM UI를 동일한 **요약 카드 + AI 챗 카드 2분할** + 동일 8서비스 프리셋으로 통일한다.

**Architecture:** 공유 presentation 컴포넌트 `LlmProviderCard`(controlled) + 공유 데이터 모듈 `llmServicePresets.ts`를 추출해 4곳(전역요약·전역챗·개인요약·개인챗)이 재사용. 영속(persistence)은 각 부모 패널이 담당 — 백엔드 스키마/저장 payload 불변.

**Tech Stack:** React + TypeScript + Vitest + Testing Library (frontend), Rails + RSpec (backend).

## Global Constraints

- **ZERO behavior change (refactor).** 백엔드 영속 스키마 불변. 전역 저장 payload(`active_preset`/`preset_data`/`chat` sub-hash) 형태 **그대로 유지**. 개인 저장 payload(`llm_settings.{provider,api_key,model,base_url,chat_*}`) 형태 **그대로 유지**.
- **테스트가 저장 payload assertion을 고치게 두지 말 것.** 카드 추출은 DOM 조회 방식만 바뀐다. payload assertion이 바뀌면 그것은 회귀 신호다(테스트 갱신 아님). 바뀌어도 되는 것은 카드를 찾는 쿼리(`getByTestId('summary-service-grid')` 등)뿐.
- 8서비스 프리셋 = `claude_cli` · `gemini_cli` · `codex_cli` · `anthropic` · `zai`(glm-5.2) · `openai` · `ollama` · `lmstudio` · `custom` (정의는 현재 `LlmSettingsPanel.tsx:11-21` 그대로 이동).
- "선택 안함" 배치: 전역요약=❌없음 / 전역챗="요약과 동일"(id `''`) / 개인요약="선택 안함(서버 기본)"(id `'none'`) / 개인챗="요약과 동일"(id `''`).
- DB 컬럼 추가 금지. 개인은 `(provider, base_url)` → presetId 순수 함수로 역매핑.
- 한 페이지에 카드 2개가 공존하므로 카드 내부 `id`/`htmlFor`/`data-testid`는 `idPrefix`로 유일화.

---

## File Structure

- **Create** `frontend/src/components/settings/llmServicePresets.ts` — `SERVICE_PRESETS`, `ServicePreset` 타입, `LOCAL_MODEL_FETCHERS`, `isLocalListable`, `CLI_PRESET_IDS`, `presetIdFromUserConfig`.
- **Create** `frontend/src/components/settings/llmServicePresets.test.ts` — 모듈 단위 테스트.
- **Create** `frontend/src/components/settings/LlmProviderCard.tsx` — 공유 controlled 카드.
- **Create** `frontend/src/components/settings/LlmProviderCard.test.tsx` — 카드 플래그 매트릭스 테스트.
- **Modify** `frontend/src/components/settings/LlmSettingsPanel.tsx` — 2 카드로 재구성, 프리셋 상수는 모듈 import.
- **Modify** `frontend/src/components/settings/LlmSettingsPanel.test.tsx` — 카드 조회 쿼리만 갱신 + presetCache 왕복 테스트 추가.
- **Modify** `frontend/src/components/settings/UserLlmSettings.tsx` — `ProviderRadioGroup`/단일 챗 섹션 → 2 `LlmProviderCard`, 8프리셋.
- **Modify** `frontend/src/components/settings/UserLlmSettings.test.tsx` — 카드 조회 + `api/settings` 로컬 fetch 모킹 추가.
- **Delete (T4 끝에)** `frontend/src/components/settings/ProviderRadioGroup.tsx` — 사용처 0이 되면 제거.
- **Modify** `backend/app/controllers/api/v1/user/llm_settings_controller.rb` — VALID_PROVIDERS에 CLI 추가, test CLI skip.
- **Modify** `backend/spec/requests/api/v1/user/llm_settings_spec.rb` — CLI 저장/스킵 케이스.
- **유지** `UserLlmStatusBanner.tsx`(상태 배너, 변경 없음).

---

## Task 1: `llmServicePresets.ts` 공유 모듈 추출

**Files:**
- Create: `frontend/src/components/settings/llmServicePresets.ts`
- Create: `frontend/src/components/settings/llmServicePresets.test.ts`
- Modify: `frontend/src/components/settings/LlmSettingsPanel.tsx:1-23` (상수 → import)

**Interfaces:**
- Produces:
  - `interface ServicePreset { id: string; name: string; provider: string; defaultBaseUrl: string; requiresApiKey: boolean; suggestedModels: readonly string[]; description: string }`
  - `const SERVICE_PRESETS: readonly ServicePreset[]`
  - `const LOCAL_MODEL_FETCHERS: Record<string, (baseUrl: string) => Promise<string[]>>`
  - `function isLocalListable(presetId: string): boolean`
  - `const CLI_PRESET_IDS: Set<string>`
  - `function presetIdFromUserConfig(provider: string | null, baseUrl: string | null): string | null` — 비어있으면 `null`(호출자가 none 센티넬 결정).

- [ ] **Step 1: Write the failing test**

```ts
// llmServicePresets.test.ts
import { describe, it, expect } from 'vitest'
import { SERVICE_PRESETS, CLI_PRESET_IDS, isLocalListable, presetIdFromUserConfig } from './llmServicePresets'

describe('llmServicePresets', () => {
  it('8개 프리셋 + zai glm-5.2 보유', () => {
    const ids = SERVICE_PRESETS.map((p) => p.id)
    expect(ids).toEqual(['claude_cli', 'gemini_cli', 'codex_cli', 'anthropic', 'zai', 'openai', 'ollama', 'lmstudio', 'custom'])
    expect(SERVICE_PRESETS.find((p) => p.id === 'zai')!.suggestedModels).toContain('glm-5.2')
    expect(SERVICE_PRESETS.find((p) => p.id === 'zai')!.provider).toBe('anthropic')
  })
  it('CLI 프리셋 3개 식별(키불요+base없음)', () => {
    expect([...CLI_PRESET_IDS].sort()).toEqual(['claude_cli', 'codex_cli', 'gemini_cli'])
  })
  it('ollama/lmstudio는 로컬 목록 대상', () => {
    expect(isLocalListable('ollama')).toBe(true)
    expect(isLocalListable('lmstudio')).toBe(true)
    expect(isLocalListable('anthropic')).toBe(false)
  })
  it('presetIdFromUserConfig 역매핑', () => {
    expect(presetIdFromUserConfig(null, null)).toBeNull()
    expect(presetIdFromUserConfig('', '')).toBeNull()
    expect(presetIdFromUserConfig('claude_cli', '')).toBe('claude_cli')
    expect(presetIdFromUserConfig('gemini_cli', '')).toBe('gemini_cli')
    expect(presetIdFromUserConfig('codex_cli', '')).toBe('codex_cli')
    expect(presetIdFromUserConfig('anthropic', null)).toBe('anthropic')
    expect(presetIdFromUserConfig('anthropic', 'https://api.z.ai/api/anthropic')).toBe('zai')
    expect(presetIdFromUserConfig('openai', '')).toBe('openai')
    expect(presetIdFromUserConfig('openai', 'http://localhost:11434/v1')).toBe('ollama')
    expect(presetIdFromUserConfig('openai', 'http://localhost:1234/v1')).toBe('lmstudio')
    expect(presetIdFromUserConfig('openai', 'http://my-server:8000/v1')).toBe('custom')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/settings/llmServicePresets.test.ts`
Expected: FAIL (module not found / exports undefined).

- [ ] **Step 3: Write the module**

```ts
// llmServicePresets.ts
import { fetchOllamaModels, fetchLmStudioModels } from '../../api/settings'

export interface ServicePreset {
  id: string
  name: string
  provider: string
  defaultBaseUrl: string
  requiresApiKey: boolean
  suggestedModels: readonly string[]
  description: string
}

export const SERVICE_PRESETS: readonly ServicePreset[] = [
  { id: 'claude_cli', name: 'Claude Code', provider: 'claude_cli', defaultBaseUrl: '', requiresApiKey: false, suggestedModels: ['sonnet', 'opus', 'haiku'], description: 'Claude Code CLI (키 불필요)' },
  { id: 'gemini_cli', name: 'Antigravity CLI', provider: 'gemini_cli', defaultBaseUrl: '', requiresApiKey: false, suggestedModels: ['Gemini 3.5 Flash (Medium)', 'Gemini 3.5 Flash (High)', 'Gemini 3.5 Flash (Low)', 'Gemini 3.1 Pro (Low)', 'Gemini 3.1 Pro (High)', 'Claude Sonnet 4.6 (Thinking)', 'Claude Opus 4.6 (Thinking)', 'GPT-OSS 120B (Medium)'], description: 'Antigravity CLI(agy) — Gemini CLI 후속. agy models 기준' },
  { id: 'codex_cli', name: 'Codex CLI', provider: 'codex_cli', defaultBaseUrl: '', requiresApiKey: false, suggestedModels: ['gpt-5.5', 'gpt-5.4-mini'], description: 'Codex CLI (키 불필요)' },
  { id: 'anthropic', name: 'Anthropic', provider: 'anthropic', defaultBaseUrl: '', requiresApiKey: true, suggestedModels: ['claude-sonnet-4-6', 'claude-haiku-4-5'], description: 'Claude API (키 필요)' },
  { id: 'zai', name: 'Z.AI', provider: 'anthropic', defaultBaseUrl: 'https://api.z.ai/api/anthropic', requiresApiKey: true, suggestedModels: ['glm-5.2', 'glm-5.1', 'glm-5-turbo', 'glm-5v-turbo', 'glm-4.7', 'glm-4.5-air'], description: 'GLM 모델 (Anthropic 호환)' },
  { id: 'openai', name: 'OpenAI', provider: 'openai', defaultBaseUrl: '', requiresApiKey: true, suggestedModels: ['gpt-4o', 'gpt-4o-mini'], description: 'GPT 모델 (키 필요)' },
  { id: 'ollama', name: 'Ollama', provider: 'openai', defaultBaseUrl: 'http://localhost:11434/v1', requiresApiKey: false, suggestedModels: [], description: '로컬 실행 (키 불필요)' },
  { id: 'lmstudio', name: 'LM Studio', provider: 'openai', defaultBaseUrl: 'http://localhost:1234/v1', requiresApiKey: false, suggestedModels: [], description: '로컬 실행 (키 불필요)' },
  { id: 'custom', name: '직접 입력', provider: 'openai', defaultBaseUrl: '', requiresApiKey: true, suggestedModels: [], description: '호환 API 직접 설정' },
]

export const LOCAL_MODEL_FETCHERS: Record<string, (baseUrl: string) => Promise<string[]>> = {
  ollama: fetchOllamaModels,
  lmstudio: fetchLmStudioModels,
}

export const isLocalListable = (presetId: string): boolean => presetId in LOCAL_MODEL_FETCHERS

export const CLI_PRESET_IDS = new Set<string>(
  SERVICE_PRESETS.filter((p) => !p.requiresApiKey && !p.defaultBaseUrl).map((p) => p.id),
)

/** 개인 설정의 (provider, base_url) 저장값 → 프리셋 id 역매핑. 빈 provider면 null(호출자가 none 센티넬 결정). */
export function presetIdFromUserConfig(provider: string | null, baseUrl: string | null): string | null {
  if (!provider) return null
  if (provider === 'claude_cli' || provider === 'gemini_cli' || provider === 'codex_cli') return provider
  const b = (baseUrl ?? '').trim()
  if (provider === 'anthropic') {
    if (!b) return 'anthropic'
    if (b.includes('z.ai')) return 'zai'
    return 'zai'
  }
  if (provider === 'openai') {
    if (!b) return 'openai'
    if (b.includes('11434')) return 'ollama'
    if (b.includes('1234')) return 'lmstudio'
    return 'custom'
  }
  return 'anthropic'
}
```

- [ ] **Step 4: Switch `LlmSettingsPanel.tsx` to import (delete inline 상수)**

`LlmSettingsPanel.tsx:5-23`(`LOCAL_MODEL_FETCHERS`/`isLocalListable`/`SERVICE_PRESETS`/`CLI_PRESET_IDS` 인라인 정의)를 삭제하고 상단 import에 추가:

```ts
import { SERVICE_PRESETS, LOCAL_MODEL_FETCHERS, isLocalListable, CLI_PRESET_IDS } from './llmServicePresets'
```

(파일 나머지 로직은 이 4개 심볼을 그대로 참조하므로 변경 불필요.)

- [ ] **Step 5: Run module test + 기존 전역 패널 테스트(회귀)**

Run: `cd frontend && npx vitest run src/components/settings/llmServicePresets.test.ts src/components/settings/LlmSettingsPanel.test.tsx`
Expected: PASS (둘 다). 전역 패널 테스트는 한 줄도 안 고쳤는데 green이면 추출 무회귀.

- [ ] **Step 6: tsc + commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/settings/llmServicePresets.ts frontend/src/components/settings/llmServicePresets.test.ts frontend/src/components/settings/LlmSettingsPanel.tsx
git commit -m "refactor(llm-settings): SERVICE_PRESETS·역매핑을 llmServicePresets 모듈로 추출"
```

---

## Task 2: `LlmProviderCard` 공유 컴포넌트

**Files:**
- Create: `frontend/src/components/settings/LlmProviderCard.tsx`
- Create: `frontend/src/components/settings/LlmProviderCard.test.tsx`

**Interfaces:**
- Consumes (T1): `SERVICE_PRESETS`, `ServicePreset`, `LOCAL_MODEL_FETCHERS`, `isLocalListable`, `CLI_PRESET_IDS`.
- Produces:
  - `interface LlmProviderCardValue { presetId: string; base_url: string; model: string; auth_token: string; max_input_tokens?: number; max_output_tokens?: number }`
  - `interface LlmProviderCardProps { title: string; idPrefix: string; presets: readonly ServicePreset[]; noneOption?: { id: string; label: string; description: string }; value: LlmProviderCardValue; maskedToken?: string; showTokenLimits?: boolean; showCliBanner?: boolean; onSelectPreset: (presetId: string) => void; onChange: (partial: Partial<LlmProviderCardValue>) => void }`
  - `function LlmProviderCard(props: LlmProviderCardProps): JSX.Element` (default + named export 둘 다)
- 동작: 프리셋 그리드(+noneOption 우선) 렌더, CLI 배너(`showCliBanner!==false && CLI_PRESET_IDS.has(presetId)`), base URL(비CLI·비none), API Key(`requiresApiKey`·비CLI), 모델 select/직접입력 토글, 로컬 자동 fetch(useEffect, isLocalListable), 토큰 제한(`showTokenLimits`). 그리드 testid=`${idPrefix}-service-grid`, label id=`${idPrefix}-base`/`${idPrefix}-key`/`${idPrefix}-model`.

- [ ] **Step 1: Write the failing test**

```tsx
// LlmProviderCard.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { LlmProviderCard, type LlmProviderCardValue } from './LlmProviderCard'
import { SERVICE_PRESETS } from './llmServicePresets'

vi.mock('../../api/settings', () => ({
  fetchOllamaModels: vi.fn(),
  fetchLmStudioModels: vi.fn(),
}))
import { fetchOllamaModels } from '../../api/settings'
const mockOllama = vi.mocked(fetchOllamaModels)

const baseValue: LlmProviderCardValue = { presetId: 'anthropic', base_url: '', model: 'claude-sonnet-4-6', auth_token: '' }
const noop = () => {}

function renderCard(overrides: Partial<React.ComponentProps<typeof LlmProviderCard>> = {}) {
  return render(
    <LlmProviderCard
      title="요약 모델" idPrefix="sum" presets={SERVICE_PRESETS}
      value={baseValue} onSelectPreset={noop} onChange={noop} {...overrides}
    />,
  )
}

describe('LlmProviderCard', () => {
  beforeEach(() => { vi.clearAllMocks(); mockOllama.mockResolvedValue([]) })

  it('title + 프리셋 그리드 렌더', () => {
    renderCard()
    expect(screen.getByText('요약 모델')).toBeInTheDocument()
    const grid = screen.getByTestId('sum-service-grid')
    expect(within(grid).getByText('Anthropic')).toBeInTheDocument()
    expect(within(grid).getByText('Z.AI')).toBeInTheDocument()
  })

  it('noneOption 있으면 그리드 첫 버튼으로 노출 + 선택 시 onSelectPreset(none.id)', () => {
    const onSelectPreset = vi.fn()
    renderCard({ noneOption: { id: 'none', label: '선택 안함', description: '서버 기본' }, onSelectPreset })
    const grid = screen.getByTestId('sum-service-grid')
    fireEvent.click(within(grid).getByText('선택 안함').closest('button')!)
    expect(onSelectPreset).toHaveBeenCalledWith('none')
  })

  it('CLI 프리셋이면 배너 노출 + base/key 숨김', () => {
    renderCard({ value: { ...baseValue, presetId: 'claude_cli' } })
    expect(screen.getByText('CLI 모드 안내')).toBeInTheDocument()
    expect(screen.queryByLabelText('API Base URL')).toBeNull()
    expect(screen.queryByLabelText('API Key')).toBeNull()
  })

  it('requiresApiKey면 키 필드 + 마스킹 placeholder', () => {
    renderCard({ value: { ...baseValue, presetId: 'anthropic', auth_token: '' }, maskedToken: 'sk-a****99' })
    const key = screen.getByLabelText('API Key') as HTMLInputElement
    expect(key.placeholder).toContain('sk-a****99')
  })

  it('키 불필요 프리셋(ollama)이면 키 필드 없음', () => {
    renderCard({ value: { ...baseValue, presetId: 'ollama', base_url: 'http://localhost:11434/v1' } })
    expect(screen.queryByLabelText('API Key')).toBeNull()
  })

  it('showTokenLimits=true면 토큰 입력 2개, false/미지정이면 없음', () => {
    const { rerender } = renderCard({ showTokenLimits: true, value: { ...baseValue, max_input_tokens: 200000, max_output_tokens: 10000 } })
    expect(screen.getByLabelText('최대 입력 토큰')).toBeInTheDocument()
    rerender(
      <LlmProviderCard title="요약 모델" idPrefix="sum" presets={SERVICE_PRESETS} value={baseValue} onSelectPreset={noop} onChange={noop} />,
    )
    expect(screen.queryByLabelText('최대 입력 토큰')).toBeNull()
  })

  it('로컬(ollama) 프리셋이면 fetch 결과를 모델 SELECT로 렌더', async () => {
    mockOllama.mockResolvedValue(['gemma:2b', 'llama3.2'])
    renderCard({ value: { ...baseValue, presetId: 'ollama', base_url: 'http://localhost:11434/v1', model: '' } })
    await waitFor(() => {
      const el = screen.getByLabelText('모델명') as HTMLSelectElement
      expect(el.tagName).toBe('SELECT')
      expect(Array.from(el.options).map((o) => o.value)).toContain('gemma:2b')
    })
  })

  it('필드 편집 시 onChange(partial)', () => {
    const onChange = vi.fn()
    renderCard({ value: { ...baseValue, presetId: 'anthropic' }, onChange })
    fireEvent.change(screen.getByLabelText('API Base URL'), { target: { value: 'https://x' } })
    expect(onChange).toHaveBeenCalledWith({ base_url: 'https://x' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/settings/LlmProviderCard.test.tsx`
Expected: FAIL (component undefined).

- [ ] **Step 3: Implement `LlmProviderCard.tsx`**

전역 패널의 요약 카드 마크업(서비스 그리드 + CLI 배너 + base + key + 모델 select/토글 + 토큰)을 controlled 컴포넌트로 옮긴다. 모델 라벨 텍스트는 양쪽 공용을 위해 `"모델명"`으로 통일(전역 패널 기존 `"회의록 작성 모델명"` → 카드 prop `modelLabel`로 받지 말고 고정 `"모델명"` 사용; 호출부 텍스트 변경은 무해). 핵심 골격:

```tsx
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
    <div className="rounded-lg border bg-card p-4">
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
```

- [ ] **Step 4: Run card test**

Run: `cd frontend && npx vitest run src/components/settings/LlmProviderCard.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: tsc + commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/settings/LlmProviderCard.tsx frontend/src/components/settings/LlmProviderCard.test.tsx
git commit -m "feat(llm-settings): 공유 LlmProviderCard(controlled) 컴포넌트 + 단위 테스트"
```

---

## Task 3: 전역 `LlmSettingsPanel` 2카드 재구성

**Files:**
- Modify: `frontend/src/components/settings/LlmSettingsPanel.tsx`
- Modify: `frontend/src/components/settings/LlmSettingsPanel.test.tsx`

**Interfaces:**
- Consumes (T1, T2): `LlmProviderCard`, `LlmProviderCardValue`, `SERVICE_PRESETS`, `presetIdFromUserConfig`(불요), `isLocalListable`/`CLI_PRESET_IDS`(잔존 로직).
- Produces: 사용자 표시상 요약 카드 + 챗 카드 2분할. **저장 payload·로드 매핑 동일 유지.**

> **CRITICAL (Global Constraint 재확인):** 이 task는 마크업/상태 owner만 카드로 옮긴다. `handleLlmSave`의 `updateLlmSettings({active_preset, chat_model, chat, preset_id, preset_data})` payload는 **글자 그대로 유지**. 챗/요약 로컬모델 fetch 로직은 카드가 흡수하므로 패널의 `loadLocalModels`/`loadChatLocalModels`/관련 state는 제거. `presetCache`(서비스별 값 기억)는 패널에 **그대로 남긴다**.

- [ ] **Step 1: 회귀 가드 테스트 먼저 추가 (presetCache 왕복 + 카드 조회 갱신)**

`LlmSettingsPanel.test.tsx`에 추가(기존 챗 테스트의 `getByTestId('chat-service-grid')`는 → 챗 카드 idPrefix에 맞춰 `chat-service-grid` 유지하도록 챗 카드 `idPrefix="chat"`로 둔다. 요약 카드 그리드는 새 testid `summary-service-grid`):

```tsx
it('presetCache 왕복: anthropic 모델 입력→openai 전환→복귀 시 값 유지', async () => {
  mockGetLlmSettings.mockResolvedValue(settingsResponse)
  render(<LlmSettingsPanel />)
  await waitFor(() => screen.getByText('LLM 모델 설정'))
  const grid = screen.getByTestId('summary-service-grid')
  // anthropic 모델명 입력
  const modelInput = () => screen.getByLabelText('모델명') as HTMLInputElement
  // 직접입력 토글이 필요하면 누르고 입력
  // (suggestedModels 있으므로 select; '직접 입력' 눌러 input 전환)
  fireEvent.click(screen.getAllByText('직접 입력')[0])
  fireEvent.change(modelInput(), { target: { value: 'my-claude' } })
  // openai 전환
  fireEvent.click(within(grid).getByText('OpenAI').closest('button')!)
  // anthropic 복귀
  fireEvent.click(within(grid).getByText('Anthropic').closest('button')!)
  await waitFor(() => expect(modelInput().value).toBe('my-claude'))
})
```

기존 챗 테스트들에서 `screen.getByText('OpenAI')` 등이 이제 두 그리드(요약·챗)에 중복 등장하므로, **반드시 `within(chatGrid)` 스코프** 유지. 요약 카드 클릭이 필요한 기존 테스트가 있으면 `within(screen.getByTestId('summary-service-grid'))`로 한정.

- [ ] **Step 2: Run to verify new test fails (current single-card)**

Run: `cd frontend && npx vitest run src/components/settings/LlmSettingsPanel.test.tsx`
Expected: 새 `presetCache 왕복`/요약 그리드 testid 테스트 FAIL (아직 단일 카드).

- [ ] **Step 3: 패널을 2카드로 재구성**

요약 카드: `value = presetCache[selectedPreset]`를 `LlmProviderCardValue`로 어댑트(필드명 동일: base_url/model/auth_token/max_*; presetId=selectedPreset). `onSelectPreset={handlePresetSelect}`, `onChange={updateCurrentForm}`, `showTokenLimits`, `maskedToken={llmSettings?.presets?.[selectedPreset]?.auth_token_masked}`, `idPrefix="summary"`, noneOption 없음.

챗 카드: `value={{presetId: chatPresetId, base_url: chatBaseUrl, model: chatModel, auth_token: chatAuthToken}}`, `onSelectPreset={handleChatServiceSelect}`, `onChange`로 chat* state 갱신, `noneOption={{id:'', label:'요약과 동일', description:'요약 모델 그대로 사용'}}`, `maskedToken={chatMaskedToken}`, `idPrefix="chat"`, showTokenLimits 미지정.

제거: 패널 내 `loadLocalModels`/`loadChatLocalModels`/`localModels*`/`chatLocalModels*`/`useCustomModel`/요약·챗 마크업 블록. 유지: `presetCache`/`selectedPreset`/`handlePresetSelect`/`updateCurrentForm`/`handleChatServiceSelect`/`handleLlmTest`/`handleLlmSave`(payload 불변)/저장·테스트 버튼·결과·offline 배너.

- [ ] **Step 4: Run full panel test (payload assertions unchanged must still pass)**

Run: `cd frontend && npx vitest run src/components/settings/LlmSettingsPanel.test.tsx`
Expected: PASS 전체. **저장 payload assertion을 못 고친다** — green이어야 한다. red면 마크업/owner 배선 오류이지 테스트 문제 아님.

- [ ] **Step 5: tsc + commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/settings/LlmSettingsPanel.tsx frontend/src/components/settings/LlmSettingsPanel.test.tsx
git commit -m "refactor(llm-settings): 전역 패널을 요약/챗 2카드(LlmProviderCard)로 재구성 — payload 불변"
```

---

## Task 4: 개인 `UserLlmSettings` 2카드 + 8프리셋

**Files:**
- Modify: `frontend/src/components/settings/UserLlmSettings.tsx`
- Modify: `frontend/src/components/settings/UserLlmSettings.test.tsx`
- Delete: `frontend/src/components/settings/ProviderRadioGroup.tsx` (사용처 0 확인 후)

**Interfaces:**
- Consumes (T1,T2): `LlmProviderCard`, `SERVICE_PRESETS`, `presetIdFromUserConfig`, `CLI_PRESET_IDS`, `ServicePreset`.
- Produces: 요약 카드(noneOption='none') + 챗 카드(noneOption=''). 저장 payload 동일 유지(`llm_settings.{provider,api_key,model,base_url,chat_provider,chat_base_url,chat_model,chat_api_key}`). provider/base_url은 프리셋→실제값 매핑.

> **매핑 규칙:** 저장 시 선택 presetId → `preset.provider`(실제 provider) + `preset.defaultBaseUrl`(또는 사용자가 편집한 base_url). 로드 시 `presetIdFromUserConfig(provider, base_url) ?? 'none'`(요약), 챗은 `presetIdFromUserConfig(chat_provider, chat_base_url) ?? ''`. CLI 프리셋 저장 시 base_url='' / api_key 미전송.

- [ ] **Step 1: 테스트 — `api/settings` 로컬 fetch 모킹 추가 + 8프리셋·CLI·매핑 케이스**

`UserLlmSettings.test.tsx` 상단에 추가(카드가 useEffect로 로컬 fetch하므로 **필수** — 없으면 jsdom real fetch로 행):

```tsx
vi.mock('../../api/settings', () => ({
  fetchOllamaModels: vi.fn().mockResolvedValue([]),
  fetchLmStudioModels: vi.fn().mockResolvedValue([]),
}))
```

기존 케이스 중 `getByLabelText(/챗 제공자/i)`·`/챗 엔드포인트/i`·`/챗 모델 \(AI 챗에만 적용\)/i` 셀렉트/인풋은 카드로 대체되므로 **카드 기반 조회로 갱신**한다. 새/갱신 케이스:

```tsx
it('요약 카드에 8프리셋 + 선택 안함 노출', async () => {
  mockGetUserLlmSettings.mockResolvedValue(unconfiguredResponse)
  render(<UserLlmSettings />)
  const grid = await screen.findByTestId('user-summary-service-grid')
  expect(within(grid).getByText('선택 안함')).toBeInTheDocument()
  expect(within(grid).getByText('Claude Code')).toBeInTheDocument()
  expect(within(grid).getByText('Z.AI')).toBeInTheDocument()
  expect(within(grid).getByText('Ollama')).toBeInTheDocument()
})

it('CLI(Claude Code) 선택 시 키 필드 숨김 + 저장 payload provider=claude_cli·base 없음', async () => {
  mockGetUserLlmSettings.mockResolvedValue(unconfiguredResponse)
  mockUpdateUserLlmSettings.mockResolvedValue(configuredResponse)
  render(<UserLlmSettings />)
  const grid = await screen.findByTestId('user-summary-service-grid')
  fireEvent.click(within(grid).getByText('Claude Code').closest('button')!)
  expect(screen.queryByLabelText('API Key')).toBeNull()
  fireEvent.change(screen.getByLabelText('모델명'), { target: { value: 'sonnet' } })
  fireEvent.click(screen.getAllByRole('button', { name: /저장/ })[0])
  await waitFor(() => expect(mockUpdateUserLlmSettings).toHaveBeenCalledWith(
    expect.objectContaining({ llm_settings: expect.objectContaining({ provider: 'claude_cli', model: 'sonnet' }) }),
  ))
})

it('zai 선택 시 저장 payload provider=anthropic + z.ai base_url', async () => {
  mockGetUserLlmSettings.mockResolvedValue(unconfiguredResponse)
  mockUpdateUserLlmSettings.mockResolvedValue(configuredResponse)
  render(<UserLlmSettings />)
  const grid = await screen.findByTestId('user-summary-service-grid')
  fireEvent.click(within(grid).getByText('Z.AI').closest('button')!)
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'k' } })
  fireEvent.change(screen.getByLabelText('모델명'), { target: { value: 'glm-5.2' } })
  fireEvent.click(screen.getAllByRole('button', { name: /저장/ })[0])
  await waitFor(() => expect(mockUpdateUserLlmSettings).toHaveBeenCalledWith(
    expect.objectContaining({ llm_settings: expect.objectContaining({ provider: 'anthropic', base_url: 'https://api.z.ai/api/anthropic', model: 'glm-5.2' }) }),
  ))
})

it('로드: 저장된 anthropic+z.ai base는 Z.AI 카드 선택으로 복원', async () => {
  mockGetUserLlmSettings.mockResolvedValue({
    ...configuredResponse,
    llm_settings: { ...configuredResponse.llm_settings, provider: 'anthropic', base_url: 'https://api.z.ai/api/anthropic', model: 'glm-5.2' },
  })
  render(<UserLlmSettings />)
  const grid = await screen.findByTestId('user-summary-service-grid')
  await waitFor(() => expect(within(grid).getByText('Z.AI').closest('button')!.getAttribute('aria-pressed')).toBe('true'))
})

it('챗 카드: 요약과 동일이 기본 선택', async () => {
  mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
  render(<UserLlmSettings />)
  const chatGrid = await screen.findByTestId('user-chat-service-grid')
  expect(within(chatGrid).getByText('요약과 동일').closest('button')!.getAttribute('aria-pressed')).toBe('true')
})
```

기존 `chat_model` 저장/표시 테스트는 챗 카드 모델 입력(`within(chatGrid)` + `getByLabelText('모델명')` 중 챗 카드 것)으로 갱신하되, 저장 payload의 `chat_model`/`chat_provider`/`chat_base_url` 키는 유지.

- [ ] **Step 2: Run to verify fails**

Run: `cd frontend && npx vitest run src/components/settings/UserLlmSettings.test.tsx`
Expected: 새 testid·8프리셋 케이스 FAIL.

- [ ] **Step 3: 재구성 구현**

`PROVIDER_OPTIONS`/`ProviderRadioGroup`/단일 챗 `<section>` 제거. 요약 카드 state: `summaryPresetId`, `summaryForm:{base_url,model,auth_token}`. 챗 카드 state: `chatPresetId`, `chatForm:{base_url,model,auth_token}`. 매핑 헬퍼는 T1 `presetIdFromUserConfig` 사용.

`initFormFromSettings`: `summaryPresetId = presetIdFromUserConfig(ls.provider, ls.base_url) ?? 'none'`; base_url/model을 form에 채움(저장값 우선, 없으면 preset.defaultBaseUrl). 챗: `chatPresetId = presetIdFromUserConfig(ls.chat_provider, ls.chat_base_url) ?? ''`.

요약 카드 렌더:
```tsx
<LlmProviderCard
  title="요약 모델" idPrefix="user-summary" presets={SERVICE_PRESETS}
  noneOption={{ id: 'none', label: '선택 안함', description: '서버 기본 LLM 사용' }}
  value={{ presetId: summaryPresetId, ...summaryForm }}
  maskedToken={settings.llm_settings.api_key_masked ?? undefined}
  onSelectPreset={handleSummarySelect} onChange={(p) => setSummaryForm((f) => ({ ...f, ...p }))}
/>
```
챗 카드 렌더: `idPrefix="user-chat"`, `noneOption={{ id:'', label:'요약과 동일', description:'요약 모델 그대로' }}`, `maskedToken={settings.llm_settings.chat_api_key_masked ?? undefined}`.

`handleSummarySelect(id)`: presetId='none'이면 form 비움; 아니면 preset.defaultBaseUrl/suggestedModels[0]로 form 초기화.

`handleSave` 매핑(요약):
```ts
if (summaryPresetId === 'none') {
  await updateUserLlmSettings({ llm_settings: { provider: '' } }); ...
} else {
  const sp = SERVICE_PRESETS.find((p) => p.id === summaryPresetId)!
  const cp = chatPresetId === '' ? null : SERVICE_PRESETS.find((p) => p.id === chatPresetId)!
  await updateUserLlmSettings({ llm_settings: {
    provider: sp.provider,
    ...(summaryForm.auth_token ? { api_key: summaryForm.auth_token } : {}),
    model: summaryForm.model,
    base_url: summaryForm.base_url || null,
    chat_provider: cp ? cp.provider : null,
    chat_base_url: cp ? (chatForm.base_url || null) : null,
    chat_model: cp ? (chatForm.model || null) : null,
    chat_api_key: chatForm.auth_token,
  }})
}
```
토글/배너/초기화/테스트 버튼은 유지(테스트는 요약 카드 presetId·form 기준으로 재배선).

- [ ] **Step 4: ProviderRadioGroup 제거**

```bash
grep -rn "ProviderRadioGroup" frontend/src   # UserLlmSettings 외 0 확인
rm frontend/src/components/settings/ProviderRadioGroup.tsx
```
(테스트 파일 `ProviderRadioGroup.test.tsx`가 있으면 함께 제거.)

- [ ] **Step 5: Run personal test + tsc**

Run: `cd frontend && npx vitest run src/components/settings/UserLlmSettings.test.tsx && npx tsc --noEmit`
Expected: PASS 전체, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/settings/UserLlmSettings.tsx frontend/src/components/settings/UserLlmSettings.test.tsx
git rm frontend/src/components/settings/ProviderRadioGroup.tsx
git commit -m "feat(llm-settings): 개인 설정을 요약/챗 2카드 + 8프리셋(CLI 포함)으로 통일"
```

---

## Task 5: 백엔드 — 개인 CLI provider 허용 + 테스트 skip

**Files:**
- Modify: `backend/app/models/user.rb` (`llm_configured?:44-46`, `llm_has_settings?:49-51`, 상수 추가)
- Modify: `backend/app/controllers/api/v1/user/llm_settings_controller.rb` (`VALID_PROVIDERS:9`, `test:49-68`)
- Modify: `backend/spec/requests/api/v1/user/llm_settings_spec.rb`
- Modify: `backend/spec/models/user_llm_spec.rb`

**조사 결과 핵심 (make-or-break):**
- 요약 경로(`meeting_summarization_job:50`·`meeting_finalizer_service:4`·`file_transcription_job:202`·`agenda_reference_job:23`·`meetings_controller:560`)는 모두 `creator.effective_llm_config` → Ruby `LlmService`로 흐른다. `LlmService`는 `claude_cli/gemini_cli/codex_cli`를 Open3로 지원(보고서 confirmed). 챗 경로는 `effective_chat_llm_config`.
- **함정**: `llm_configured?`가 `llm_api_key.present?`를 요구 → CLI(키 없음)는 false → `effective_llm_config`가 **서버 기본으로 silent fallback**(선택한 CLI 미사용). 따라서 단순 "permit + skip"으로는 부족하고 `llm_configured?`/`llm_has_settings?`를 CLI에 한해 키 없이 configured로 완화해야 한다.
- `sidecar_llm_config`는 app/lib 소비처 0(실시간 사이드카 부작용 없음). 모델 컬럼 검증 없음(스키마 변경 불요).

**Interfaces:**
- Produces: `User::CLI_LLM_PROVIDERS` 상수, `User#llm_provider_cli?`. `effective_llm_config`가 CLI 저장 시 `{provider:'claude_cli', model:..}` 빌드(서버 기본 아님).

- [ ] **Step 1: 모델 스펙 실패 테스트 추가**

`backend/spec/models/user_llm_spec.rb`에 추가:

```ruby
describe "CLI provider (키 없음)" do
  it "claude_cli + 키 없음이면 configured로 인정하고 effective_llm_config가 CLI config를 빌드한다" do
    user = create(:user, llm_provider: "claude_cli", llm_api_key: nil, llm_model: "sonnet", llm_enabled: true)
    expect(user.llm_configured?).to be(true)
    expect(user.llm_has_settings?).to be(true)
    cfg = user.effective_llm_config
    expect(cfg[:provider]).to eq("claude_cli")
    expect(cfg[:model]).to eq("sonnet")
  end

  it "비-CLI provider는 여전히 키를 요구한다(회귀 가드)" do
    user = create(:user, llm_provider: "anthropic", llm_api_key: nil, llm_enabled: true)
    expect(user.llm_configured?).to be(false)
  end
end
```

- [ ] **Step 2: Run to verify fails**

Run: `cd backend && bundle exec rspec spec/models/user_llm_spec.rb -e "CLI provider"`
Expected: FAIL (현재 키 요구 → configured false).

- [ ] **Step 3: 모델 완화 구현**

`backend/app/models/user.rb` — `local_account?` 아래/`llm_configured?` 위에 상수+헬퍼 추가하고 두 메서드 완화:

```ruby
# LlmService::CLI_PROVIDERS 와 동일(키·base 불요 CLI 프로바이더). 모델 자기완결성 위해 미러.
CLI_LLM_PROVIDERS = %w[claude_cli gemini_cli codex_cli].freeze

def llm_provider_cli?
  CLI_LLM_PROVIDERS.include?(llm_provider)
end

def llm_configured?
  llm_provider.present? && (llm_api_key.present? || llm_provider_cli?) && llm_enabled?
end

# 설정 자체가 존재하는지 (활성 여부와 무관)
def llm_has_settings?
  llm_provider.present? && (llm_api_key.present? || llm_provider_cli?)
end
```

(`effective_llm_config`/`sidecar_llm_config` 본문은 변경 불필요 — `provider`를 그대로 통과시키며 이제 CLI에서도 `llm_configured?` 통과.)

- [ ] **Step 4: Run model spec**

Run: `cd backend && bundle exec rspec spec/models/user_llm_spec.rb`
Expected: PASS 전체.

- [ ] **Step 5: 컨트롤러 스펙 실패 테스트 추가**

`backend/spec/requests/api/v1/user/llm_settings_spec.rb`에 추가:

```ruby
describe "CLI provider 저장/테스트" do
  it "claude_cli를 키 없이 저장하고 provider를 영속한다" do
    put "/api/v1/user/llm_settings", params: {
      llm_settings: { provider: "claude_cli", model: "sonnet" }
    }, as: :json
    expect(response).to have_http_status(:ok)
    user.reload
    expect(user.llm_provider).to eq("claude_cli")
    expect(user.llm_configured?).to be(true)
    expect(user.effective_llm_config[:provider]).to eq("claude_cli")
    expect(user.effective_llm_config[:model]).to eq("sonnet")
  end

  it "POST test: CLI provider는 LlmService 호출 없이 success skip" do
    expect(LlmService).not_to receive(:new)
    post "/api/v1/user/llm_settings/test", params: { provider: "gemini_cli", model: "x" }, as: :json
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["success"]).to be(true)
  end

  it "여전히 알 수 없는 provider는 422" do
    put "/api/v1/user/llm_settings", params: {
      llm_settings: { provider: "bogus_provider" }
    }, as: :json
    expect(response).to have_http_status(:unprocessable_entity)
  end
end
```

- [ ] **Step 6: Run to verify fails**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/user/llm_settings_spec.rb -e "CLI provider"`
Expected: FAIL (현재 claude_cli → 422; test가 LlmService.new 호출).

- [ ] **Step 7: 컨트롤러 구현**

`backend/app/controllers/api/v1/user/llm_settings_controller.rb`:

```ruby
# Line 9 교체
VALID_PROVIDERS = (%w[anthropic openai] + LlmService::CLI_PROVIDERS).freeze
```

`test` 액션을 CLI early-return으로 교체(provider 먼저, model 나중):

```ruby
def test
  provider = params.require(:provider)

  # CLI 프로바이더는 API 연결 테스트 불필요 (전역 test_llm 과 동일 처리)
  if LlmService::CLI_PROVIDERS.include?(provider)
    return render json: { "success" => true, "note" => "CLI 프로바이더는 별도 연결 테스트가 필요 없습니다." }
  end

  model = params.require(:model)
  api_key = params[:api_key].presence || current_user.llm_api_key
  base_url = params[:base_url].presence || current_user.llm_base_url

  llm_config = {
    provider: provider,
    model: model,
    auth_token: api_key,
    base_url: base_url
  }.compact

  result = LlmService.new(llm_config: llm_config).test_connection
  render json: result
rescue ActionController::ParameterMissing => e
  render json: { success: false, error: "#{e.param}은(는) 필수입니다" },
         status: :bad_request
end
```

(`VALID_PROVIDERS` 확장으로 `update`의 422 게이트는 CLI를 통과시킨다 — `update` 본문 변경 불요.)

- [ ] **Step 8: Run request spec + 전체 백엔드 회귀**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/user/llm_settings_spec.rb spec/models/user_llm_spec.rb`
Expected: PASS 전체(신규 + 기존 anthropic/openai/invalid).

- [ ] **Step 9: Commit**

```bash
git add backend/app/models/user.rb backend/app/controllers/api/v1/user/llm_settings_controller.rb backend/spec/requests/api/v1/user/llm_settings_spec.rb backend/spec/models/user_llm_spec.rb
git commit -m "feat(llm-settings): 개인 CLI provider(키 없이) 허용 + 연결테스트 skip + configured 인정"
```

---

## Task 6: 통합 검증 + E2E

**Files:** 없음(검증). 발견된 회귀는 해당 task로 되돌아가 수정.

- [ ] **Step 1: 프론트 풀 테스트 + tsc + build**

Run: `cd frontend && npx vitest run && npx tsc --noEmit && npx vite build`
Expected: 전부 green, build 성공.

- [ ] **Step 2: 백엔드 풀 rspec**

Run: `cd backend && bundle exec rspec`
Expected: green (기존 + T5 신규).

- [ ] **Step 3: dev 서버 기동 + 브라우저 E2E 4영역**

`./dev.sh`(LAN 노출) 기동 후 `/settings` LLM 탭에서:
- 전역 요약 카드: anthropic 저장 → 새로고침 후 복원, 토큰 제한 표시.
- 전역 챗 카드: ollama 선택 → 모델 자동목록 → 저장 → 복원.
- 개인 요약 카드: **CLI(Claude Code) 선택**(riskiest 신규) → 키 숨김 → 저장 → 복원, 실제 요약 1회 동작 확인.
- 개인 챗 카드: zai 선택 → 저장 → 복원.

증거 캡처(스크린샷/네트워크 payload). payload가 기존 형태와 동일한지 네트워크 탭에서 확인.

- [ ] **Step 4: 회귀 0 확인 후 마무리**

브랜치 정리·머지는 별도(사용자 승인). 메모리 `project_llm_settings_two_cards` 갱신.

---

## Self-Review (작성자 체크)

- **Spec coverage:** design.md 구현단위 1~6 → Task 1~6 1:1. "선택 안함" 4배치 매트릭스 → T2 noneOption + T3/T4 호출부. zai 유지 → T1 프리셋. 백엔드 CLI 허용/skip → T5.
- **Type consistency:** `LlmProviderCardValue`(presetId/base_url/model/auth_token/max_*) T2 정의 → T3/T4 동일 사용. `presetIdFromUserConfig` 시그니처 T1 정의 → T4 사용. `ServicePreset.provider`(string) → T4 저장 매핑.
- **Placeholder scan:** T5만 의도적 보류(백엔드 조사 의존) — 나머지 전 step 실제 코드/명령 포함.
