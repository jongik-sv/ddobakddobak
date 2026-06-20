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
