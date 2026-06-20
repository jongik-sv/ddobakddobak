import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { LlmSettingsPanel } from './LlmSettingsPanel'
import type { LlmSettings } from '../../api/settings'

// API 모듈 모킹
vi.mock('../../api/settings', () => ({
  getLlmSettings: vi.fn(),
  updateLlmSettings: vi.fn(),
  testLlmConnection: vi.fn(),
  fetchOllamaModels: vi.fn(),
  fetchLmStudioModels: vi.fn(),
}))

import { getLlmSettings, updateLlmSettings, fetchOllamaModels, fetchLmStudioModels } from '../../api/settings'

const mockGetLlmSettings = vi.mocked(getLlmSettings)
const mockUpdateLlmSettings = vi.mocked(updateLlmSettings)
const mockFetchOllamaModels = vi.mocked(fetchOllamaModels)
const mockFetchLmStudioModels = vi.mocked(fetchLmStudioModels)

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

describe('LlmSettingsPanel - AI 챗 독립 섹션', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchOllamaModels.mockResolvedValue([])
    mockFetchLmStudioModels.mockResolvedValue([])
  })

  it('기본(요약과 동일): 요약과 동일 카드 선택됨, 키/URL 숨김', async () => {
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('LLM 모델 설정'))

    const chatGrid = screen.getByTestId('chat-service-grid')
    const sameasBtn = within(chatGrid).getByText('요약과 동일').closest('button')!
    expect(sameasBtn.getAttribute('aria-pressed')).toBe('true')
    // 키/URL 필드 미노출
    expect(screen.queryByLabelText('챗 API 키')).toBeNull()
    expect(screen.queryByLabelText('챗 base URL')).toBeNull()
  })

  it('챗 서비스=OpenAI 카드 선택 시 키·base URL·모델 필드 노출', async () => {
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('LLM 모델 설정'))

    const chatGrid = screen.getByTestId('chat-service-grid')
    fireEvent.click(within(chatGrid).getByText('OpenAI').closest('button')!)
    expect(screen.getByLabelText('챗 API 키')).toBeInTheDocument()
    expect(screen.getByLabelText('챗 base URL')).toBeInTheDocument()
    expect(screen.getByLabelText('챗 모델')).toBeInTheDocument()
  })

  it('저장: 독립 챗 설정이면 chat 객체를 전송', async () => {
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    mockUpdateLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('LLM 모델 설정'))

    const chatGrid = screen.getByTestId('chat-service-grid')
    fireEvent.click(within(chatGrid).getByText('Ollama').closest('button')!)
    fireEvent.change(screen.getByLabelText('챗 base URL'), { target: { value: 'http://localhost:11434/v1' } })
    fireEvent.change(screen.getByLabelText('챗 모델'), { target: { value: 'llama-3.1-8b' } })

    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => {
      expect(mockUpdateLlmSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          chat: expect.objectContaining({
            preset_id: 'ollama',
            provider: 'openai',
            base_url: 'http://localhost:11434/v1',
            model: 'llama-3.1-8b',
          }),
        }),
      )
    })
  })

  it('저장: 요약과 동일이면 chat.provider 빈값 + 레거시 chat_model 전송', async () => {
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    mockUpdateLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('LLM 모델 설정'))

    // 기본은 '요약과 동일'. 챗 모델만 입력
    fireEvent.change(screen.getByLabelText('챗 모델'), { target: { value: 'claude-haiku-4-5' } })
    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => {
      expect(mockUpdateLlmSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          chat: expect.objectContaining({ provider: '' }),
          chat_model: 'claude-haiku-4-5',
        }),
      )
    })
  })

  it('로드: llm.chat 있으면 해당 서비스 카드 aria-pressed true + 마스킹 키 placeholder', async () => {
    mockGetLlmSettings.mockResolvedValue({
      ...settingsResponse,
      chat: { preset_id: 'openai', provider: 'openai', auth_token_masked: 'sk-c****9999',
              base_url: '', model: 'gpt-4o-mini' },
    })
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('LLM 모델 설정'))

    const chatGrid = screen.getByTestId('chat-service-grid')
    await waitFor(() => {
      const openaiBtn = within(chatGrid).getByText('OpenAI').closest('button')!
      expect(openaiBtn.getAttribute('aria-pressed')).toBe('true')
    })
    const keyInput = screen.getByLabelText('챗 API 키') as HTMLInputElement
    expect(keyInput.placeholder).toContain('sk-c****9999')
  })

  it('챗 서비스=LM Studio 선택 시 base URL에 1234 포함, API 키 필드 없음', async () => {
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('LLM 모델 설정'))

    const chatGrid = screen.getByTestId('chat-service-grid')
    fireEvent.click(within(chatGrid).getByText('LM Studio').closest('button')!)
    expect((screen.getByLabelText('챗 base URL') as HTMLInputElement).value).toContain('1234')
    expect(screen.queryByLabelText('챗 API 키')).toBeNull()
  })

  it('챗 서비스=Ollama 선택 시 설치 모델 목록을 fetch해 챗 모델 SELECT로 렌더링', async () => {
    mockFetchOllamaModels.mockResolvedValue(['gemma4:e2b', 'llama3.2'])
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('LLM 모델 설정'))

    const chatGrid = screen.getByTestId('chat-service-grid')
    fireEvent.click(within(chatGrid).getByText('Ollama').closest('button')!)

    await waitFor(() => {
      const chatModelEl = screen.getByLabelText('챗 모델')
      expect(chatModelEl.tagName).toBe('SELECT')
      const options = Array.from((chatModelEl as HTMLSelectElement).options).map((o) => o.value)
      expect(options).toContain('gemma4:e2b')
      expect(options).toContain('llama3.2')
    })
  })

  it('챗 서비스=LM Studio 선택 시 모델 목록을 fetch해 챗 모델 SELECT로 렌더링', async () => {
    mockFetchLmStudioModels.mockResolvedValue(['qwen2.5-7b', 'phi-4'])
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('LLM 모델 설정'))

    const chatGrid = screen.getByTestId('chat-service-grid')
    fireEvent.click(within(chatGrid).getByText('LM Studio').closest('button')!)

    await waitFor(() => {
      const chatModelEl = screen.getByLabelText('챗 모델')
      expect(chatModelEl.tagName).toBe('SELECT')
      const options = Array.from((chatModelEl as HTMLSelectElement).options).map((o) => o.value)
      expect(options).toContain('qwen2.5-7b')
      expect(options).toContain('phi-4')
    })
  })
})
