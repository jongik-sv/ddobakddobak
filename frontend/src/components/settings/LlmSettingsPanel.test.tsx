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

import { getLlmSettings, updateLlmSettings, testLlmConnection, fetchOllamaModels, fetchLmStudioModels } from '../../api/settings'

const mockGetLlmSettings = vi.mocked(getLlmSettings)
const mockUpdateLlmSettings = vi.mocked(updateLlmSettings)
const mockTestLlmConnection = vi.mocked(testLlmConnection)
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

  const chatCard = () => screen.getByTestId('chat-card')

  it('기본(요약과 동일): 요약과 동일 카드 선택됨, 키/URL 숨김', async () => {
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('LLM 모델 설정'))

    const chatGrid = screen.getByTestId('chat-service-grid')
    const sameasBtn = within(chatGrid).getByText('요약과 동일').closest('button')!
    expect(sameasBtn.getAttribute('aria-pressed')).toBe('true')
    // 키/URL 필드 미노출
    expect(within(chatCard()).queryByLabelText('API Key')).toBeNull()
    expect(within(chatCard()).queryByLabelText('API Base URL')).toBeNull()
  })

  it('챗 서비스=OpenAI 카드 선택 시 키·base URL·모델 필드 노출', async () => {
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('LLM 모델 설정'))

    const chatGrid = screen.getByTestId('chat-service-grid')
    fireEvent.click(within(chatGrid).getByText('OpenAI').closest('button')!)
    expect(within(chatCard()).getByLabelText('API Key')).toBeInTheDocument()
    expect(within(chatCard()).getByLabelText('API Base URL')).toBeInTheDocument()
    expect(within(chatCard()).getByLabelText('모델명')).toBeInTheDocument()
  })

  it('저장: 독립 챗 설정이면 chat 객체를 전송', async () => {
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    mockUpdateLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('LLM 모델 설정'))

    const chatGrid = screen.getByTestId('chat-service-grid')
    fireEvent.click(within(chatGrid).getByText('Ollama').closest('button')!)
    fireEvent.change(within(chatCard()).getByLabelText('API Base URL'), { target: { value: 'http://localhost:11434/v1' } })
    fireEvent.change(within(chatCard()).getByLabelText('모델명'), { target: { value: 'llama-3.1-8b' } })

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

    // 기본은 '요약과 동일'. 챗 모델만 입력 (레거시 라벨 '챗 모델' 그대로)
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
    const keyInput = within(chatCard()).getByLabelText('API Key') as HTMLInputElement
    expect(keyInput.placeholder).toContain('sk-c****9999')
  })

  it('챗 서비스=LM Studio 선택 시 base URL에 1234 포함, API 키 필드 없음', async () => {
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('LLM 모델 설정'))

    const chatGrid = screen.getByTestId('chat-service-grid')
    fireEvent.click(within(chatGrid).getByText('LM Studio').closest('button')!)
    expect((within(chatCard()).getByLabelText('API Base URL') as HTMLInputElement).value).toContain('1234')
    expect(within(chatCard()).queryByLabelText('API Key')).toBeNull()
  })

  it('챗 서비스=Ollama 선택 시 설치 모델 목록을 fetch해 챗 모델 SELECT로 렌더링', async () => {
    mockFetchOllamaModels.mockResolvedValue(['gemma4:e2b', 'llama3.2'])
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('LLM 모델 설정'))

    const chatGrid = screen.getByTestId('chat-service-grid')
    fireEvent.click(within(chatGrid).getByText('Ollama').closest('button')!)

    await waitFor(() => {
      const chatModelEl = within(chatCard()).getByLabelText('모델명')
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
      const chatModelEl = within(chatCard()).getByLabelText('모델명')
      expect(chatModelEl.tagName).toBe('SELECT')
      const options = Array.from((chatModelEl as HTMLSelectElement).options).map((o) => o.value)
      expect(options).toContain('qwen2.5-7b')
      expect(options).toContain('phi-4')
    })
  })

  it('presetCache 왕복: anthropic 모델 입력→openai 전환→복귀 시 값 유지', async () => {
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('LLM 모델 설정'))

    const summaryGrid = screen.getByTestId('summary-service-grid')
    const summaryCard = screen.getByTestId('summary-card')

    // '직접 입력' 토글 버튼 (버튼 타입이고 text-xs 클래스)
    // '직접 입력' 이름의 프리셋 버튼과 구분: 모델명 토글 버튼은 type="button"이고 p.text-sm이 아님
    const customInputBtns = within(summaryCard).getAllByRole('button', { name: '직접 입력' })
    // 프리셋 그리드 버튼은 aria-pressed 속성이 있고, 토글은 없음
    const modelToggleBtn = customInputBtns.find(b => b.getAttribute('aria-pressed') === null)!
    fireEvent.click(modelToggleBtn)

    // 요약 카드 내 모델명 input 확인 후 입력
    const modelInput = () => within(summaryCard).getByLabelText('모델명') as HTMLInputElement
    await waitFor(() => expect(modelInput().tagName).toBe('INPUT'))
    fireEvent.change(modelInput(), { target: { value: 'my-claude' } })
    await waitFor(() => expect(modelInput().value).toBe('my-claude'))

    // openai 전환
    fireEvent.click(within(summaryGrid).getByText('OpenAI').closest('button')!)
    // anthropic 복귀
    await waitFor(() => within(summaryGrid).getByText('OpenAI').closest('button')!.getAttribute('aria-pressed') === 'true')
    fireEvent.click(within(summaryGrid).getByText('Anthropic').closest('button')!)

    await waitFor(() => expect(modelInput().value).toBe('my-claude'))
  })

  it('요약 그리드 8프리셋 렌더: Z.AI·Ollama 등 존재', async () => {
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('LLM 모델 설정'))

    const summaryGrid = screen.getByTestId('summary-service-grid')
    expect(within(summaryGrid).getByText('Z.AI')).toBeInTheDocument()
    expect(within(summaryGrid).getByText('Ollama')).toBeInTheDocument()
    expect(within(summaryGrid).getByText('Anthropic')).toBeInTheDocument()
  })

  // #5: 비동기 onChange(로컬 모델 자동채움)가 동시 base_url 편집을 덮어쓰지 않아야 한다.
  // updateCurrentForm이 렌더 시점 스냅샷이 아니라 최신 캐시에 병합하므로 두 편집이 모두 유지된다.
  it('#5 동시성: in-flight 로컬 모델 자동채움이 직후 base_url 편집을 되돌리지 않음', async () => {
    // fetchOllamaModels를 수동 제어 가능한 promise로: resolve를 보류해 base_url 편집을 끼워넣는다.
    let resolveFetch!: (models: string[]) => void
    const fetchGate = new Promise<string[]>((res) => { resolveFetch = res })
    mockFetchOllamaModels.mockReturnValue(fetchGate)
    mockGetLlmSettings.mockResolvedValue(settingsResponse)

    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('LLM 모델 설정'))

    const summaryGrid = screen.getByTestId('summary-service-grid')
    const summaryCard = screen.getByTestId('summary-card')

    // Ollama 선택 → base_url 기본값으로 loadLocal(useEffect) 발화, fetch는 게이트에서 대기
    fireEvent.click(within(summaryGrid).getByText('Ollama').closest('button')!)

    const baseInput = () => within(summaryCard).getByLabelText('API Base URL') as HTMLInputElement
    await waitFor(() => expect(baseInput()).toBeInTheDocument())

    // fetch가 아직 resolve되지 않은 사이(stale onChange 보유) base_url을 편집
    fireEvent.change(baseInput(), { target: { value: 'http://localhost:11434/v1/custom' } })
    await waitFor(() => expect(baseInput().value).toBe('http://localhost:11434/v1/custom'))

    // 이제 보류된 fetch가 resolve → loadLocal이 onChange({ model: models[0] }) 호출(model 비어있었음)
    resolveFetch(['gemma:2b'])

    // 모델은 자동채움되지만 base_url 편집은 유지되어야 한다(되돌림 없음)
    await waitFor(() => {
      const modelEl = within(summaryCard).getByLabelText('모델명') as HTMLSelectElement
      expect(modelEl.value).toBe('gemma:2b')
    })
    expect(baseInput().value).toBe('http://localhost:11434/v1/custom')
  })

  // #13: SERVICE_PRESETS에 없는 active_preset이어도 Test/Save 핸들러가 TypeError로 죽지 않아야 한다.
  it('#13 안전성: 알 수 없는 selectedPreset이어도 Test/Save 핸들러가 크래시하지 않음', async () => {
    mockGetLlmSettings.mockResolvedValue({ ...settingsResponse, active_preset: 'totally_unknown_preset' })
    mockUpdateLlmSettings.mockResolvedValue(settingsResponse)
    mockTestLlmConnection.mockResolvedValue({ success: true })
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('LLM 모델 설정'))

    // 저장: currentPreset이 undefined였다면 currentPreset.provider에서 TypeError로 크래시했을 것
    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => expect(mockUpdateLlmSettings).toHaveBeenCalled())
    // 폴백 프리셋(anthropic)의 provider로 전송되며 active_preset은 원래 id 유지
    expect(mockUpdateLlmSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        active_preset: 'totally_unknown_preset',
        preset_data: expect.objectContaining({ provider: 'anthropic' }),
      }),
    )

    // 연결 테스트: 모델 입력 후(버튼 활성화) 클릭해도 크래시 없이 결과 표시
    const summaryCard = screen.getByTestId('summary-card')
    fireEvent.change(within(summaryCard).getByLabelText('모델명'), { target: { value: 'some-model' } })
    fireEvent.click(screen.getByText('연결 테스트'))
    await waitFor(() => expect(mockTestLlmConnection).toHaveBeenCalled())
    expect(screen.getByText('연결 성공')).toBeInTheDocument()
  })
})
