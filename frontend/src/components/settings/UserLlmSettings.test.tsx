import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import UserLlmSettings from './UserLlmSettings'
import type { UserLlmSettingsResponse, UserLlmTestResult } from '../../api/userLlmSettings'

// API 모듈 모킹
vi.mock('../../api/userLlmSettings', () => ({
  getUserLlmSettings: vi.fn(),
  updateUserLlmSettings: vi.fn(),
  testUserLlmConnection: vi.fn(),
}))

import { getUserLlmSettings, updateUserLlmSettings, testUserLlmConnection } from '../../api/userLlmSettings'

const mockGetUserLlmSettings = vi.mocked(getUserLlmSettings)
const mockUpdateUserLlmSettings = vi.mocked(updateUserLlmSettings)
const mockTestUserLlmConnection = vi.mocked(testUserLlmConnection)

// 테스트용 응답 데이터
const configuredResponse: UserLlmSettingsResponse = {
  llm_settings: {
    provider: 'anthropic',
    api_key_masked: 'sk-a****5678',
    model: 'claude-sonnet-4-6',
    base_url: null,
    configured: true,
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
