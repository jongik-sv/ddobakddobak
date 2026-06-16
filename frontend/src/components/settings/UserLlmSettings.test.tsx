import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import UserLlmSettings from './UserLlmSettings'
import type { UserLlmSettingsResponse, UserLlmTestResult } from '../../api/userLlmSettings'

// API 모듈 모킹
vi.mock('../../api/userLlmSettings', () => ({
  getUserLlmSettings: vi.fn(),
  updateUserLlmSettings: vi.fn(),
  testUserLlmConnection: vi.fn(),
  toggleUserLlm: vi.fn(),
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
    chat_llm_model: 'claude-haiku-4-5',
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

  // 6.2.3 설정된 상태
  it('LLM 설정 시 현재 provider와 model을 표시한다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    render(<UserLlmSettings />)
    await waitFor(() => {
      expect(screen.getByText('Anthropic')).toBeInTheDocument()
    })
  })

  // 6.2.4 Provider 선택
  it('Provider 카드를 클릭하면 해당 provider가 선택된다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    render(<UserLlmSettings />)
    await waitFor(() => screen.getByText('Anthropic'))

    fireEvent.click(screen.getByText('OpenAI'))
    // OpenAI 카드가 선택 상태(border-blue)인지 확인
    const openaiCard = screen.getByText('OpenAI').closest('button')
    expect(openaiCard?.className).toMatch(/border-blue/)
  })

  // 6.2.5 저장
  it('저장 버튼 클릭 시 API를 호출하고 성공 메시지를 표시한다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    mockUpdateUserLlmSettings.mockResolvedValue(configuredResponse)
    render(<UserLlmSettings />)
    await waitFor(() => screen.getByText('Anthropic'))

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
    await waitFor(() => screen.getByText('Anthropic'))

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
    await waitFor(() => screen.getByText('Anthropic'))

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
    await waitFor(() => screen.getByText('Anthropic'))

    fireEvent.click(screen.getByText('설정 초기화'))
    await waitFor(() => {
      expect(screen.getByText(/서버 기본값 사용 중/)).toBeInTheDocument()
    })
  })

  // AI 챗 모델명 표시
  it('설정 응답의 chat_llm_model로 "AI 챗 모델명" 필드를 채운다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    render(<UserLlmSettings />)
    await waitFor(() => screen.getByText('Anthropic'))

    const chatModelInput = screen.getByLabelText('AI 챗 모델명') as HTMLInputElement
    expect(chatModelInput.value).toBe('claude-haiku-4-5')
  })

  // AI 챗 모델명 저장
  it('저장 시 PUT payload에 chat_llm_model을 포함한다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    mockUpdateUserLlmSettings.mockResolvedValue(configuredResponse)
    render(<UserLlmSettings />)
    await waitFor(() => screen.getByText('Anthropic'))

    // 챗 모델은 이제 select: provider 제안 목록의 옵션을 선택
    const chatModelInput = screen.getByLabelText('AI 챗 모델명')
    fireEvent.change(chatModelInput, { target: { value: 'claude-sonnet-4-6' } })

    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => {
      expect(screen.getByText(/저장되었습니다/)).toBeInTheDocument()
    })
    expect(mockUpdateUserLlmSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        llm_settings: expect.objectContaining({ chat_llm_model: 'claude-sonnet-4-6' }),
      })
    )
  })

  // AI 챗 모델 select 렌더 (목록 있는 provider)
  it('모델 목록이 있는 provider(anthropic)에서 챗 모델 필드를 select(combobox)로 렌더한다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    render(<UserLlmSettings />)
    await waitFor(() => screen.getByText('Anthropic'))

    const chatSelect = screen.getByLabelText('AI 챗 모델명')
    expect(chatSelect.tagName).toBe('SELECT')

    const options = Array.from((chatSelect as HTMLSelectElement).options)
    expect(options[0].value).toBe('')
    expect(options[0].textContent).toBe('요약 모델과 동일')
    const optionValues = options.map((o) => o.value)
    expect(optionValues).toContain('claude-sonnet-4-6')
    expect(optionValues).toContain('claude-haiku-4-5')
  })

  // 빈 옵션 선택 시 null 저장
  it('빈 옵션(요약 모델과 동일) 선택 시 chat_llm_model을 null로 저장한다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    mockUpdateUserLlmSettings.mockResolvedValue(configuredResponse)
    render(<UserLlmSettings />)
    await waitFor(() => screen.getByText('Anthropic'))

    const chatSelect = screen.getByLabelText('AI 챗 모델명')
    fireEvent.change(chatSelect, { target: { value: '' } })

    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => {
      expect(screen.getByText(/저장되었습니다/)).toBeInTheDocument()
    })
    expect(mockUpdateUserLlmSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        llm_settings: expect.objectContaining({ chat_llm_model: null }),
      })
    )
  })

  // 값 보존: 목록에 없는 저장값도 선택된 옵션으로 표시
  it('저장된 챗 모델 값이 목록에 없어도 옵션으로 보존되어 선택된다', async () => {
    const customChatResponse: UserLlmSettingsResponse = {
      ...configuredResponse,
      llm_settings: {
        ...configuredResponse.llm_settings,
        chat_llm_model: 'gpt-4o-mini', // anthropic 제안 목록에 없음
      },
    }
    mockGetUserLlmSettings.mockResolvedValue(customChatResponse)
    render(<UserLlmSettings />)
    await waitFor(() => screen.getByText('Anthropic'))

    const chatSelect = screen.getByLabelText('AI 챗 모델명') as HTMLSelectElement
    expect(chatSelect.value).toBe('gpt-4o-mini')
    const optionValues = Array.from(chatSelect.options).map((o) => o.value)
    expect(optionValues).toContain('gpt-4o-mini')
    expect(optionValues.filter((v) => v === 'gpt-4o-mini')).toHaveLength(1)
  })

  // 폴백: 목록 없는 provider는 텍스트 입력
  it('모델 목록이 없는 provider(anthropic_custom)에서는 챗 모델 필드를 텍스트 입력으로 폴백한다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(configuredResponse)
    render(<UserLlmSettings />)
    await waitFor(() => screen.getByText('Anthropic'))

    fireEvent.click(screen.getByText('Anthropic 호환'))

    const chatField = screen.getByLabelText('AI 챗 모델명')
    expect(chatField.tagName).toBe('INPUT')
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
})
