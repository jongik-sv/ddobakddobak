import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LlmSettingsPanel } from './LlmSettingsPanel'
import type { LlmSettings } from '../../api/settings'

// API 모듈 모킹
vi.mock('../../api/settings', () => ({
  getLlmSettings: vi.fn(),
  updateLlmSettings: vi.fn(),
  testLlmConnection: vi.fn(),
  fetchOllamaModels: vi.fn(),
}))

import { getLlmSettings, updateLlmSettings, testLlmConnection, fetchOllamaModels } from '../../api/settings'

const mockGetLlmSettings = vi.mocked(getLlmSettings)
const mockUpdateLlmSettings = vi.mocked(updateLlmSettings)
const mockTestLlmConnection = vi.mocked(testLlmConnection)
const mockFetchOllamaModels = vi.mocked(fetchOllamaModels)

const settingsResponse: LlmSettings = {
  active_preset: 'anthropic',
  chat_model: 'haiku',
  presets: {
    anthropic: {
      provider: 'anthropic',
      auth_token_masked: 'sk-a****5678',
      model: 'claude-sonnet-4-6',
      max_input_tokens: 200000,
      max_output_tokens: 10000,
    },
  },
}

describe('LlmSettingsPanel - AI 챗 모델명', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchOllamaModels.mockResolvedValue([])
  })

  it('설정 응답의 chat_model로 "AI 챗 모델명" 필드를 채운다', async () => {
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('AI 요약 모델'))

    const chatModelInput = screen.getByLabelText('AI 챗 모델명') as HTMLInputElement
    await waitFor(() => expect(chatModelInput.value).toBe('haiku'))
  })

  it('저장 시 updateLlmSettings에 chat_model을 포함하여 호출한다', async () => {
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    mockUpdateLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('AI 요약 모델'))

    const chatModelInput = screen.getByLabelText('AI 챗 모델명')
    fireEvent.change(chatModelInput, { target: { value: 'claude-haiku-4-5' } })

    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => {
      expect(mockUpdateLlmSettings).toHaveBeenCalledWith(
        expect.objectContaining({ chat_model: 'claude-haiku-4-5' }),
      )
    })
    expect(mockTestLlmConnection).not.toHaveBeenCalled()
  })

  it('모델 목록이 있는 프리셋(anthropic)에서 챗 모델 필드를 select(combobox)로 렌더한다', async () => {
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('AI 요약 모델'))

    const chatSelect = screen.getByLabelText('AI 챗 모델명')
    expect(chatSelect.tagName).toBe('SELECT')

    // 첫 옵션 "요약 모델과 동일" (빈 값) + 프리셋 제안 모델
    const options = Array.from((chatSelect as HTMLSelectElement).options)
    expect(options[0].value).toBe('')
    expect(options[0].textContent).toBe('요약 모델과 동일')
    const optionValues = options.map((o) => o.value)
    expect(optionValues).toContain('claude-sonnet-4-6')
    expect(optionValues).toContain('claude-haiku-4-5')
  })

  it('빈 옵션(요약 모델과 동일) 선택 시 저장 payload의 chat_model이 빈 문자열이다', async () => {
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    mockUpdateLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('AI 요약 모델'))

    const chatSelect = screen.getByLabelText('AI 챗 모델명')
    fireEvent.change(chatSelect, { target: { value: '' } })

    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => {
      expect(mockUpdateLlmSettings).toHaveBeenCalledWith(
        expect.objectContaining({ chat_model: '' }),
      )
    })
  })

  it('저장된 챗 모델 값이 목록에 없어도 옵션으로 보존되어 선택된다', async () => {
    // settingsResponse.chat_model === 'haiku' (anthropic 제안 목록에 없음)
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('AI 요약 모델'))

    const chatSelect = screen.getByLabelText('AI 챗 모델명') as HTMLSelectElement
    await waitFor(() => expect(chatSelect.value).toBe('haiku'))
    const optionValues = Array.from(chatSelect.options).map((o) => o.value)
    expect(optionValues).toContain('haiku')
    // 중복 없이 한 번만
    expect(optionValues.filter((v) => v === 'haiku')).toHaveLength(1)
  })

  it('모델 목록이 없는 프리셋(custom)에서는 챗 모델 필드를 텍스트 입력으로 폴백한다', async () => {
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('AI 요약 모델'))

    // suggestedModels가 빈 'custom' 프리셋 카드 선택 (설명으로 카드 특정)
    const customCard = screen.getByText('호환 API 직접 설정').closest('button')!
    fireEvent.click(customCard)

    const chatField = screen.getByLabelText('AI 챗 모델명')
    expect(chatField.tagName).toBe('INPUT')
  })
})
