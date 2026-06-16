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
    fireEvent.change(chatModelInput, { target: { value: 'opus' } })

    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => {
      expect(mockUpdateLlmSettings).toHaveBeenCalledWith(
        expect.objectContaining({ chat_model: 'opus' }),
      )
    })
    expect(mockTestLlmConnection).not.toHaveBeenCalled()
  })
})
