import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import UserLlmSettings from './UserLlmSettings'
import type { UserLlmSettingsResponse, UserLlmTestResult } from '../../api/userLlmSettings'

// API 모듈 모킹
vi.mock('../../api/userLlmSettings', () => ({
  getUserLlmSettings: vi.fn(),
  updateUserLlmSettings: vi.fn(),
  testUserLlmConnection: vi.fn(),
  toggleUserLlm: vi.fn(),
}))

// 카드가 useEffect로 로컬 fetch하므로 필수 — 없으면 jsdom real fetch로 행
vi.mock('../../api/settings', () => ({
  fetchOllamaModels: vi.fn().mockResolvedValue([]),
  fetchLmStudioModels: vi.fn().mockResolvedValue([]),
}))

import { getUserLlmSettings, updateUserLlmSettings, testUserLlmConnection, toggleUserLlm } from '../../api/userLlmSettings'

const mockGetUserLlmSettings = vi.mocked(getUserLlmSettings)
const mockUpdateUserLlmSettings = vi.mocked(updateUserLlmSettings)
const mockTestUserLlmConnection = vi.mocked(testUserLlmConnection)
const mockToggleUserLlm = vi.mocked(toggleUserLlm)

// 테스트용 응답 데이터
const configuredResponse: UserLlmSettingsResponse = {
  llm_settings: {
    provider: 'anthropic',
    api_key_masked: 'sk-a****5678',
    model: 'claude-sonnet-4-6',
    chat_model: 'claude-haiku-4-5',
    base_url: null,
    configured: true,
    enabled: true,
    has_settings: true,
  },
  server_default: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    has_key: true,
  },
}

const unconfiguredResponse: UserLlmSettingsResponse = {
  llm_settings: {
    provider: null,
    api_key_masked: null,
    model: null,
    base_url: null,
    configured: false,
    enabled: true,
    has_settings: false,
  },
  server_default: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    has_key: true,
  },
}

describe('UserLlmSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // 6.2.1 로딩 상태
  it('로딩 중일 때 로딩 텍스트를 표시한다', async () => {
    // getUserLlmSettings가 pending 상태를 유지하도록 resolve하지 않음
    mockGetUserLlmSettings.mockReturnValue(new Promise(() => {}))
    render(<UserLlmSettings />)
    expect(screen.getByText('불러오는 중...')).toBeInTheDocument()
  })

  // 6.2.2 미설정 상태
  it('LLM 미설정 시 "서버 기본값 사용 중" 배너를 표시한다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(unconfiguredResponse)
    render(<UserLlmSettings />)
    await waitFor(() => {
      expect(screen.getByText(/서버 기본값 사용 중/)).toBeInTheDocument()
    })
  })

  // 6.2.3 설정된 상태 — summary 카드에 Anthropic aria-pressed true
  it('LLM 설정 시 현재 provider와 model을 표시한다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    render(<UserLlmSettings />)
    const summaryCard = await screen.findByTestId('user-summary-card')
    await waitFor(() => {
      expect(within(summaryCard).getByText('Anthropic').closest('button')!.getAttribute('aria-pressed')).toBe('true')
    })
  })

  // 6.2.4 Provider 선택 — summary 카드 내에서 OpenAI 클릭
  it('Provider 카드를 클릭하면 해당 provider가 선택된다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    render(<UserLlmSettings />)
    await screen.findByTestId('user-summary-card')

    const summaryCard = screen.getByTestId('user-summary-card')
    fireEvent.click(within(summaryCard).getByText('OpenAI'))
    // OpenAI 버튼이 aria-pressed=true 가 되어야 한다
    await waitFor(() => {
      expect(within(summaryCard).getByText('OpenAI').closest('button')!.getAttribute('aria-pressed')).toBe('true')
    })
  })

  // 6.2.5 저장
  it('저장 버튼 클릭 시 API를 호출하고 성공 메시지를 표시한다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    mockUpdateUserLlmSettings.mockResolvedValue(configuredResponse)
    render(<UserLlmSettings />)
    await screen.findByTestId('user-summary-card')

    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => {
      expect(screen.getByText(/저장되었습니다/)).toBeInTheDocument()
    })
    expect(mockUpdateUserLlmSettings).toHaveBeenCalled()
  })

  // 6.2.6 연결 테스트 성공
  it('연결 테스트 성공 시 초록색 메시지를 표시한다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    const successResult: UserLlmTestResult = { success: true, response_time_ms: 500 }
    mockTestUserLlmConnection.mockResolvedValue(successResult)
    render(<UserLlmSettings />)
    await screen.findByTestId('user-summary-card')

    fireEvent.click(screen.getByText('연결 테스트'))
    await waitFor(() => {
      expect(screen.getByText(/연결 성공/)).toBeInTheDocument()
    })
  })

  // 6.2.7 연결 테스트 실패
  it('연결 테스트 실패 시 빨간색 에러 메시지를 표시한다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    const failResult: UserLlmTestResult = { success: false, error: 'Invalid API key' }
    mockTestUserLlmConnection.mockResolvedValue(failResult)
    render(<UserLlmSettings />)
    await screen.findByTestId('user-summary-card')

    fireEvent.click(screen.getByText('연결 테스트'))
    await waitFor(() => {
      expect(screen.getByText(/연결 실패/)).toBeInTheDocument()
    })
  })

  // 6.2.8 설정 초기화
  it('설정 초기화 시 폼을 리셋하고 "서버 기본값 사용 중"을 표시한다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    mockUpdateUserLlmSettings.mockResolvedValue(unconfiguredResponse)
    render(<UserLlmSettings />)
    await screen.findByTestId('user-summary-card')

    fireEvent.click(screen.getByText('설정 초기화'))
    await waitFor(() => {
      expect(screen.getByText(/서버 기본값 사용 중/)).toBeInTheDocument()
    })
  })

  // 챗 모델 표시 (독립 섹션 — chatPresetId='' 이면 레거시 입력 표시)
  it('설정 응답의 chat_model로 "챗 모델" 필드를 채운다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    render(<UserLlmSettings />)
    await screen.findByTestId('user-summary-card')

    const chatModelInput = screen.getByLabelText(/챗 모델 \(AI 챗에만 적용\)/i) as HTMLInputElement
    expect(chatModelInput.value).toBe('claude-haiku-4-5')
  })

  // 챗 모델 저장 (독립 섹션 — chat_model 파라미터, payload 키 동결)
  it('저장 시 PUT payload에 chat_model을 포함한다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    mockUpdateUserLlmSettings.mockResolvedValue(configuredResponse)
    render(<UserLlmSettings />)
    await screen.findByTestId('user-summary-card')

    const chatModelInput = screen.getByLabelText(/챗 모델 \(AI 챗에만 적용\)/i)
    fireEvent.change(chatModelInput, { target: { value: 'claude-sonnet-4-6' } })

    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => {
      expect(screen.getByText(/저장되었습니다/)).toBeInTheDocument()
    })
    expect(mockUpdateUserLlmSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        llm_settings: expect.objectContaining({ chat_model: 'claude-sonnet-4-6' }),
      })
    )
  })

  // 챗 모델 빈 값 시 null 저장
  it('챗 모델 입력 비움 시 chat_model을 null로 저장한다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    mockUpdateUserLlmSettings.mockResolvedValue(configuredResponse)
    render(<UserLlmSettings />)
    await screen.findByTestId('user-summary-card')

    const chatModelInput = screen.getByLabelText(/챗 모델 \(AI 챗에만 적용\)/i)
    fireEvent.change(chatModelInput, { target: { value: '' } })

    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => {
      expect(screen.getByText(/저장되었습니다/)).toBeInTheDocument()
    })
    expect(mockUpdateUserLlmSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        llm_settings: expect.objectContaining({ chat_model: null }),
      })
    )
  })

  // 6.2.9 API 키 마스킹 표시
  it('현재 저장된 API 키를 마스킹하여 표시한다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    render(<UserLlmSettings />)
    await waitFor(() => {
      expect(screen.getByText(/sk-a\*+5678/)).toBeInTheDocument()
    })
  })

  // 6.2.10 API 에러 처리
  it('API 에러 시 에러 메시지를 표시한다', async () => {
    mockGetUserLlmSettings.mockRejectedValue(new Error('Network error'))
    render(<UserLlmSettings />)
    await waitFor(() => {
      expect(screen.getByText(/불러오지 못했습니다/)).toBeInTheDocument()
    })
  })

  // AI 챗 모델 섹션 — 챗 카드에서 OpenAI 선택 후 base 입력, payload chat_* 키 동결
  it('AI 챗 모델 섹션을 표시하고 저장 payload 에 chat_* 를 담는다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    mockUpdateUserLlmSettings.mockResolvedValue(configuredResponse)
    render(<UserLlmSettings />)
    await screen.findByTestId('user-summary-card')

    const chatCard = screen.getByTestId('user-chat-card')
    // OpenAI 프리셋 선택
    fireEvent.click(within(chatCard).getByText('OpenAI'))

    // base URL 입력
    const chatBase = within(chatCard).getByLabelText('API Base URL')
    fireEvent.change(chatBase, { target: { value: 'http://localhost:11434/v1' } })

    fireEvent.click(screen.getAllByRole('button', { name: /저장/ })[0])
    await waitFor(() => {
      expect(mockUpdateUserLlmSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          llm_settings: expect.objectContaining({
            chat_provider: 'openai',
            chat_base_url: 'http://localhost:11434/v1',
          }),
        }),
      )
    })
  })

  // 신규: 요약 카드에 8프리셋 + 선택 안함 노출
  it('요약 카드에 8프리셋 + 선택 안함 노출', async () => {
    mockGetUserLlmSettings.mockResolvedValue(unconfiguredResponse)
    render(<UserLlmSettings />)
    const grid = await screen.findByTestId('user-summary-service-grid')
    expect(within(grid).getByText('선택 안함')).toBeInTheDocument()
    expect(within(grid).getByText('Claude Code')).toBeInTheDocument()
    expect(within(grid).getByText('Z.AI')).toBeInTheDocument()
    expect(within(grid).getByText('Ollama')).toBeInTheDocument()
  })

  // 신규: CLI(Claude Code) 선택 시 키 필드 숨김 + 저장 payload provider=claude_cli
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

  // 신규: zai 선택 시 저장 payload provider=anthropic + z.ai base_url
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

  // 신규: 로드 — 저장된 anthropic+z.ai base는 Z.AI 카드 선택으로 복원
  it('로드: 저장된 anthropic+z.ai base는 Z.AI 카드 선택으로 복원', async () => {
    mockGetUserLlmSettings.mockResolvedValue({
      ...configuredResponse,
      llm_settings: { ...configuredResponse.llm_settings, provider: 'anthropic', base_url: 'https://api.z.ai/api/anthropic', model: 'glm-5.2' },
    })
    render(<UserLlmSettings />)
    const grid = await screen.findByTestId('user-summary-service-grid')
    await waitFor(() => expect(within(grid).getByText('Z.AI').closest('button')!.getAttribute('aria-pressed')).toBe('true'))
  })

  // 신규: 챗 카드 — 요약과 동일이 기본 선택
  it('챗 카드: 요약과 동일이 기본 선택', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    render(<UserLlmSettings />)
    const chatGrid = await screen.findByTestId('user-chat-service-grid')
    expect(within(chatGrid).getByText('요약과 동일').closest('button')!.getAttribute('aria-pressed')).toBe('true')
  })

  // #1: 저장된 provider와 일치하면 마스크를 넘긴다 (Anthropic 기본 로드 == 저장값)
  it('선택 provider가 저장값과 같으면 요약 카드에 마스크("현재:")를 표시한다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    render(<UserLlmSettings />)
    const summaryCard = await screen.findByTestId('user-summary-card')
    await waitFor(() => {
      expect(within(summaryCard).getByText('Anthropic').closest('button')!.getAttribute('aria-pressed')).toBe('true')
    })
    // 저장값(anthropic)과 선택값이 일치하므로 마스크가 노출된다
    expect(within(summaryCard).getByText(/현재:/)).toBeInTheDocument()
    expect(within(summaryCard).getByText(/sk-a\*+5678/)).toBeInTheDocument()
  })

  // #1: 저장값과 다른 provider로 전환하면 stale 마스크를 넘기지 않는다
  it('다른 provider로 전환하면 요약 카드에 마스크("현재:")를 표시하지 않는다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    render(<UserLlmSettings />)
    const summaryCard = await screen.findByTestId('user-summary-card')
    // 저장값은 anthropic. 키가 필요한 다른 provider(OpenAI)로 전환 — 키 필드는 그대로 렌더되어 마스크 로직을 실제로 검증
    fireEvent.click(within(summaryCard).getByText('OpenAI'))
    await waitFor(() => {
      expect(within(summaryCard).getByText('OpenAI').closest('button')!.getAttribute('aria-pressed')).toBe('true')
    })
    // 키 필드는 여전히 존재하지만 stale 마스크는 노출되지 않아야 한다
    expect(within(summaryCard).getByLabelText('API Key')).toBeInTheDocument()
    expect(within(summaryCard).queryByText(/현재:/)).toBeNull()
  })

  // #2: 설정 초기화 payload 는 reset_all:true 를 포함한다 (전체 초기화)
  it('설정 초기화 payload 에 reset_all:true 를 담는다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    mockUpdateUserLlmSettings.mockResolvedValue(unconfiguredResponse)
    render(<UserLlmSettings />)
    await screen.findByTestId('user-summary-card')

    fireEvent.click(screen.getByText('설정 초기화'))
    await waitFor(() => {
      expect(mockUpdateUserLlmSettings).toHaveBeenCalledWith({
        llm_settings: { provider: '', reset_all: true },
      })
    })
  })

  // #2: 요약='선택 안함' 저장 payload 는 reset_all 을 포함하지 않는다 (챗 보존)
  it('요약=선택 안함 저장 payload 는 reset_all 을 담지 않는다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    mockUpdateUserLlmSettings.mockResolvedValue(unconfiguredResponse)
    render(<UserLlmSettings />)
    const summaryGrid = await screen.findByTestId('user-summary-service-grid')

    // 요약 카드에서 '선택 안함' 선택 → 빈 provider 저장 경로
    fireEvent.click(within(summaryGrid).getByText('선택 안함').closest('button')!)
    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => {
      expect(mockUpdateUserLlmSettings).toHaveBeenCalledWith({
        llm_settings: { provider: '' },
      })
    })
  })
})
