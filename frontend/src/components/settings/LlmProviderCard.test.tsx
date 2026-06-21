// LlmProviderCard.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { LlmProviderCard, type LlmProviderCardValue } from './LlmProviderCard'
import { SERVICE_PRESETS } from './llmServicePresets'

vi.mock('../../api/settings', () => ({
  fetchOllamaModels: vi.fn(),
  fetchLmStudioModels: vi.fn(),
}))
import { fetchOllamaModels, fetchLmStudioModels } from '../../api/settings'
const mockOllama = vi.mocked(fetchOllamaModels)
const mockLmStudio = vi.mocked(fetchLmStudioModels)

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
  beforeEach(() => { vi.clearAllMocks(); mockOllama.mockResolvedValue([]); mockLmStudio.mockResolvedValue([]) })

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

  // #4 — 이미 선택된 프리셋 재클릭은 no-op (폼 리셋 방지)
  it('이미 선택된 프리셋 버튼을 다시 클릭하면 onSelectPreset를 호출하지 않는다', () => {
    const onSelectPreset = vi.fn()
    renderCard({ value: { ...baseValue, presetId: 'anthropic' }, onSelectPreset })
    const grid = screen.getByTestId('sum-service-grid')
    fireEvent.click(within(grid).getByText('Anthropic').closest('button')!)
    expect(onSelectPreset).not.toHaveBeenCalled()
    // 다른 프리셋은 정상 호출
    fireEvent.click(within(grid).getByText('OpenAI').closest('button')!)
    expect(onSelectPreset).toHaveBeenCalledWith('openai')
  })

  it('이미 선택된 noneOption 재클릭도 no-op', () => {
    const onSelectPreset = vi.fn()
    renderCard({ noneOption: { id: 'none', label: '선택 안함', description: '서버 기본' }, value: { ...baseValue, presetId: 'none' }, onSelectPreset })
    const grid = screen.getByTestId('sum-service-grid')
    fireEvent.click(within(grid).getByText('선택 안함').closest('button')!)
    expect(onSelectPreset).not.toHaveBeenCalled()
  })

  // #6 — base_url 변경은 auto-fetch를 재발화하지 않는다 (프리셋 선택/마운트 시 1회만)
  it('로컬 모델 fetch는 프리셋 선택 시 1회만, 이후 base_url 변경에는 재호출되지 않는다', async () => {
    mockOllama.mockResolvedValue(['gemma:2b'])
    const { rerender } = renderCard({ value: { ...baseValue, presetId: 'ollama', base_url: 'http://localhost:11434/v1', model: '' } })
    await waitFor(() => expect(mockOllama).toHaveBeenCalledTimes(1))
    // base_url만 바뀐 리렌더 — auto-fetch가 다시 발화되면 안 됨
    rerender(
      <LlmProviderCard title="요약 모델" idPrefix="sum" presets={SERVICE_PRESETS}
        value={{ ...baseValue, presetId: 'ollama', base_url: 'http://localhost:11434/v2', model: '' }} onSelectPreset={noop} onChange={noop} />,
    )
    await waitFor(() => expect(mockOllama).toHaveBeenCalledTimes(1))
  })

  // #6 — 수동 새로고침 버튼은 현재 base_url로 재감지한다
  it('모델 새로고침 버튼은 현재 base_url로 fetch를 호출한다', async () => {
    mockOllama.mockResolvedValue(['gemma:2b'])
    renderCard({ value: { ...baseValue, presetId: 'ollama', base_url: 'http://localhost:11434/v1', model: '' } })
    await waitFor(() => expect(mockOllama).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByLabelText('모델 새로고침'))
    await waitFor(() => expect(mockOllama).toHaveBeenCalledTimes(2))
  })

  // #7 — out-of-order 가드: 느린 이전 fetch가 새 프리셋의 목록을 덮어쓰지 않는다
  it('out-of-order: 늦게 resolve된 이전 프리셋 fetch가 새 프리셋 목록을 덮어쓰지 않는다', async () => {
    let resolveOllama!: (v: string[]) => void
    mockOllama.mockImplementation(() => new Promise<string[]>((r) => { resolveOllama = r }))
    mockLmStudio.mockResolvedValue(['lmstudio-model'])
    const { rerender } = renderCard({ value: { ...baseValue, presetId: 'ollama', base_url: 'http://localhost:11434/v1', model: '' } })
    await waitFor(() => expect(mockOllama).toHaveBeenCalledTimes(1))
    // 프리셋을 lmstudio로 전환 → 새 load가 먼저 끝남
    rerender(
      <LlmProviderCard title="요약 모델" idPrefix="sum" presets={SERVICE_PRESETS}
        value={{ ...baseValue, presetId: 'lmstudio', base_url: 'http://localhost:1234/v1', model: '' }} onSelectPreset={noop} onChange={noop} />,
    )
    await waitFor(() => {
      const el = screen.getByLabelText('모델명') as HTMLSelectElement
      expect(Array.from(el.options).map((o) => o.value)).toContain('lmstudio-model')
    })
    // 이제 stale한 ollama fetch가 뒤늦게 resolve — 목록을 덮어쓰면 안 됨
    resolveOllama(['stale-ollama'])
    await waitFor(() => expect(mockOllama).toHaveBeenCalled())
    const el = screen.getByLabelText('모델명') as HTMLSelectElement
    const opts = Array.from(el.options).map((o) => o.value)
    expect(opts).toContain('lmstudio-model')
    expect(opts).not.toContain('stale-ollama')
  })

  // #8 — 토큰 입력을 비우면 0이 아니라 undefined를 emit (기본값 복원 가능)
  it('토큰 입력을 비우면 max_input_tokens=undefined를 emit (0 아님)', () => {
    const onChange = vi.fn()
    renderCard({ showTokenLimits: true, value: { ...baseValue, max_input_tokens: 200000, max_output_tokens: 10000 }, onChange })
    const input = screen.getByLabelText('최대 입력 토큰') as HTMLInputElement
    expect(input.min).toBe('1')
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith({ max_input_tokens: undefined })
    expect(onChange).not.toHaveBeenCalledWith({ max_input_tokens: 0 })
  })

  // #9 — 프리셋 변경 시 '직접 입력' 토글이 리셋되어 모델 SELECT가 다시 보인다
  it('프리셋 변경 시 직접 입력 토글이 리셋되어 SELECT 모드로 복귀한다', () => {
    const { rerender } = renderCard({ value: { ...baseValue, presetId: 'anthropic' } })
    // anthropic은 suggestedModels가 있어 SELECT + 직접 입력 토글 노출
    // (그리드의 custom 프리셋 카드와 텍스트가 겹치므로 정확한 accessible name으로 토글 버튼만 타겟)
    fireEvent.click(screen.getByRole('button', { name: '직접 입력' }))
    expect((screen.getByLabelText('모델명') as HTMLElement).tagName).toBe('INPUT')
    // 다른 프리셋으로 전환 → 토글 리셋 → 다시 SELECT
    rerender(
      <LlmProviderCard title="요약 모델" idPrefix="sum" presets={SERVICE_PRESETS}
        value={{ ...baseValue, presetId: 'openai' }} onSelectPreset={noop} onChange={noop} />,
    )
    expect((screen.getByLabelText('모델명') as HTMLElement).tagName).toBe('SELECT')
  })
})
