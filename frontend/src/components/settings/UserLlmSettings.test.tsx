import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import UserLlmSettings from './UserLlmSettings'
import type { UserLlmSettingsResponse, UserLlmTestResult } from '../../api/userLlmSettings'
import type { LlmProfile } from '../../api/llmProfiles'

// API 모듈 모킹
vi.mock('../../api/userLlmSettings', () => ({
  getUserLlmSettings: vi.fn(),
  updateUserLlmSettings: vi.fn(),
  testUserLlmConnection: vi.fn(),
  toggleUserLlm: vi.fn(),
  fetchUserLlmModels: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../api/llmProfiles', () => ({
  listLlmProfiles: vi.fn(),
  createLlmProfile: vi.fn(),
  updateLlmProfile: vi.fn(),
  deleteLlmProfile: vi.fn(),
}))

// LlmProfilesModal(＋내부 LlmProfileForm)이 마운트 시 로컬/외부 링크 관련 모듈을 임포트한다.
// 실제 네트워크로 새지 않도록 함께 목킹(LlmProfilesModal.test.tsx와 동일 패턴).
vi.mock('../../api/settings', () => ({
  fetchOllamaModels: vi.fn().mockResolvedValue([]),
  fetchLmStudioModels: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../lib/openExternal', () => ({ openExternal: vi.fn() }))
vi.mock('../../lib/confirmDialog', () => ({ confirmDialog: vi.fn().mockResolvedValue(true) }))

// CLI 프리셋은 local 모드에서만 노출된다. 이 스위트는 CLI 노출(기존 동작)을 전제로
// 하므로 getMode를 항상 'local'로 고정한다(의도 보존).
vi.mock('../../config', async (orig) => ({ ...(await orig() as object), getMode: vi.fn(() => 'local') }))

import { getUserLlmSettings, updateUserLlmSettings, testUserLlmConnection } from '../../api/userLlmSettings'
import { listLlmProfiles, deleteLlmProfile } from '../../api/llmProfiles'

const mockGetUserLlmSettings = vi.mocked(getUserLlmSettings)
const mockUpdateUserLlmSettings = vi.mocked(updateUserLlmSettings)
const mockTestUserLlmConnection = vi.mocked(testUserLlmConnection)
const mockListLlmProfiles = vi.mocked(listLlmProfiles)
const mockDeleteLlmProfile = vi.mocked(deleteLlmProfile)

// 개인 풀의 프로필 1개 — 요약/챗 셀렉터 드롭다운의 '내 프로필' 그룹에 노출된다.
const profile1: LlmProfile = {
  id: 1,
  name: 'Gemini · 무료키',
  preset_id: 'gemini',
  provider: 'openai',
  base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
  model: 'gemini-3.5-flash',
  max_input_tokens: null,
  max_output_tokens: null,
  has_token: true,
  auth_token_masked: 'AIza...z8kQ',
}

function makeResponse(overrides: Partial<UserLlmSettingsResponse['llm_settings']> = {}): UserLlmSettingsResponse {
  return {
    llm_settings: {
      provider: null,
      api_key_masked: null,
      model: null,
      base_url: null,
      configured: false,
      enabled: true,
      has_settings: false,
      ...overrides,
    },
    server_default: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      has_key: true,
    },
  }
}

// 미설정 — 요약/챗 모두 특수옵션(선택 안함/요약과 동일)으로 떨어진다.
const unconfiguredResponse = makeResponse()

// 프로필 참조로 설정됨 — 백엔드가 provider/model을 프로필 값으로 해석해 응답에 실어준다(Task 3).
const profileConfiguredResponse = makeResponse({
  configured: true,
  has_settings: true,
  provider: 'openai',
  model: 'gemini-3.5-flash',
  llm_profile_id: 1,
})

describe('UserLlmSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListLlmProfiles.mockResolvedValue([profile1])
  })

  // 로딩 상태
  it('로딩 중일 때 로딩 텍스트를 표시한다', async () => {
    // getUserLlmSettings가 pending 상태를 유지하도록 resolve하지 않음
    mockGetUserLlmSettings.mockReturnValue(new Promise(() => {}))
    render(<UserLlmSettings />)
    expect(screen.getByText('불러오는 중...')).toBeInTheDocument()
  })

  // 미설정 상태
  it('LLM 미설정 시 "서버 기본값 사용 중" 배너를 표시한다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(unconfiguredResponse)
    render(<UserLlmSettings />)
    await waitFor(() => {
      expect(screen.getByText(/서버 기본값 사용 중/)).toBeInTheDocument()
    })
  })

  // API 에러 처리
  it('API 에러 시 에러 메시지를 표시한다', async () => {
    mockGetUserLlmSettings.mockRejectedValue(new Error('Network error'))
    render(<UserLlmSettings />)
    await waitFor(() => {
      expect(screen.getByText(/불러오지 못했습니다/)).toBeInTheDocument()
    })
  })

  // 로드: llm_profile_id 응답 → 요약 셀렉터가 profile:1 선택 상태
  it('로드: llm_profile_id 응답 → 요약 셀렉터가 profile:1 선택 상태', async () => {
    mockGetUserLlmSettings.mockResolvedValue(profileConfiguredResponse)
    render(<UserLlmSettings />)
    const summarySel = await screen.findByTestId('user-summary-selector')
    await waitFor(() => {
      expect((within(summarySel).getByLabelText('요약 모델 프로필') as HTMLSelectElement).value).toBe('profile:1')
    })
    // 배너에도 프로필 해석 결과(provider/model)가 반영된다
    expect(screen.getByText(/내 LLM 사용 중 — openai \/ gemini-3.5-flash/)).toBeInTheDocument()
  })

  // 저장(프로필): 드롭다운에서 프로필 선택 후 저장 → payload llm_profile_id
  it('요약 드롭다운에서 프로필 선택 후 저장하면 payload에 llm_profile_id를 담는다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(unconfiguredResponse)
    mockUpdateUserLlmSettings.mockResolvedValue(profileConfiguredResponse)
    render(<UserLlmSettings />)
    const summarySel = await screen.findByTestId('user-summary-selector')

    fireEvent.change(within(summarySel).getByLabelText('요약 모델 프로필'), { target: { value: 'profile:1' } })
    fireEvent.click(screen.getAllByRole('button', { name: /저장/ })[0])

    await waitFor(() => expect(mockUpdateUserLlmSettings).toHaveBeenCalled())
    const payload = mockUpdateUserLlmSettings.mock.calls[0][0].llm_settings
    expect(payload.llm_profile_id).toBe(1)
  })

  // 저장(선택 안함): payload { provider: '', llm_profile_id: null }
  it("요약 '선택 안함' 저장 시 payload에 provider:''·llm_profile_id:null을 담는다", async () => {
    mockGetUserLlmSettings.mockResolvedValue(profileConfiguredResponse)
    mockUpdateUserLlmSettings.mockResolvedValue(unconfiguredResponse)
    render(<UserLlmSettings />)
    const summarySel = await screen.findByTestId('user-summary-selector')

    fireEvent.click(within(summarySel).getByText('선택 안함'))
    fireEvent.click(screen.getByText('저장'))

    await waitFor(() => expect(mockUpdateUserLlmSettings).toHaveBeenCalled())
    const payload = mockUpdateUserLlmSettings.mock.calls[0][0].llm_settings
    expect(payload).toMatchObject({ provider: '', llm_profile_id: null })
  })

  // 저장(CLI): cli:claude_cli(모델 기본값 sonnet) → payload { provider: 'claude_cli', model: 'sonnet' }
  it('요약 드롭다운에서 CLI 선택 후 저장하면 payload에 provider/model을 담는다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(unconfiguredResponse)
    mockUpdateUserLlmSettings.mockResolvedValue(unconfiguredResponse)
    render(<UserLlmSettings />)
    const summarySel = await screen.findByTestId('user-summary-selector')

    fireEvent.change(within(summarySel).getByLabelText('요약 모델 프로필'), { target: { value: 'cli:claude_cli' } })
    fireEvent.click(screen.getAllByRole('button', { name: /저장/ })[0])

    await waitFor(() => expect(mockUpdateUserLlmSettings).toHaveBeenCalled())
    const payload = mockUpdateUserLlmSettings.mock.calls[0][0].llm_settings
    expect(payload).toMatchObject({ provider: 'claude_cli', model: 'sonnet' })
  })

  // 챗: 'server'(선택 안함=서버 모델 강제) 선택 → payload chat_provider='server'만, 다른 chat_* 키 생략
  it("챗 '선택 안함'(server) 선택 후 저장하면 chat_provider:'server'만 보낸다", async () => {
    mockGetUserLlmSettings.mockResolvedValue(unconfiguredResponse)
    mockUpdateUserLlmSettings.mockResolvedValue(unconfiguredResponse)
    render(<UserLlmSettings />)
    const chatSel = await screen.findByTestId('user-chat-selector')

    fireEvent.click(within(chatSel).getByText('선택 안함'))
    fireEvent.click(screen.getAllByRole('button', { name: /저장/ })[0])

    await waitFor(() => expect(mockUpdateUserLlmSettings).toHaveBeenCalled())
    const payload = mockUpdateUserLlmSettings.mock.calls[0][0].llm_settings
    expect(payload.chat_provider).toBe('server')
    expect(payload).not.toHaveProperty('chat_llm_profile_id')
    expect(payload).not.toHaveProperty('chat_model')
  })

  // 챗: ''(요약과 동일) — 레거시 챗 모델 오버라이드 입력 노출 + 저장 payload
  it("챗 '요약과 동일'(기본)일 때 레거시 챗 모델 입력이 노출되고, 값을 채워 저장하면 payload에 chat_model을 담는다", async () => {
    mockGetUserLlmSettings.mockResolvedValue(unconfiguredResponse)
    mockUpdateUserLlmSettings.mockResolvedValue(unconfiguredResponse)
    render(<UserLlmSettings />)
    await screen.findByTestId('user-chat-selector')

    const legacyInput = screen.getByLabelText(/챗 모델 \(AI 챗에만 적용\)/i)
    fireEvent.change(legacyInput, { target: { value: 'claude-sonnet-4-6' } })
    fireEvent.click(screen.getAllByRole('button', { name: /저장/ })[0])

    await waitFor(() => expect(mockUpdateUserLlmSettings).toHaveBeenCalled())
    const payload = mockUpdateUserLlmSettings.mock.calls[0][0].llm_settings
    expect(payload).toMatchObject({ chat_provider: null, chat_llm_profile_id: null, chat_model: 'claude-sonnet-4-6' })
  })

  // '프로필 관리' 버튼 → 모달 열림
  it("'프로필 관리' 클릭 시 프로필 모달이 열린다", async () => {
    mockGetUserLlmSettings.mockResolvedValue(unconfiguredResponse)
    render(<UserLlmSettings />)
    const summarySel = await screen.findByTestId('user-summary-selector')

    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(within(summarySel).getByText('프로필 관리'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  // 저장 성공 메시지
  it('저장 버튼 클릭 시 API를 호출하고 성공 메시지를 표시한다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(unconfiguredResponse)
    mockUpdateUserLlmSettings.mockResolvedValue(unconfiguredResponse)
    render(<UserLlmSettings />)
    await screen.findByTestId('user-summary-selector')

    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => {
      expect(screen.getByText(/저장되었습니다/)).toBeInTheDocument()
    })
    expect(mockUpdateUserLlmSettings).toHaveBeenCalled()
  })

  // 연결 테스트 성공 — 요약이 프로필일 때 base_url을 동봉한다(사용자 지시 보정)
  it('연결 테스트 성공 시 초록색 메시지를 표시하고, 프로필 base_url을 동봉한다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(profileConfiguredResponse)
    const successResult: UserLlmTestResult = { success: true, response_time_ms: 500 }
    mockTestUserLlmConnection.mockResolvedValue(successResult)
    render(<UserLlmSettings />)
    await screen.findByTestId('user-summary-selector')

    fireEvent.click(screen.getByText('연결 테스트'))
    await waitFor(() => {
      expect(screen.getByText(/연결 성공/)).toBeInTheDocument()
    })
    expect(mockTestUserLlmConnection).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gemini-3.5-flash',
      base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
      profile_id: 1,
    })
  })

  // 연결 테스트 실패
  it('연결 테스트 실패 시 빨간색 에러 메시지를 표시한다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(profileConfiguredResponse)
    const failResult: UserLlmTestResult = { success: false, error: 'Invalid API key' }
    mockTestUserLlmConnection.mockResolvedValue(failResult)
    render(<UserLlmSettings />)
    await screen.findByTestId('user-summary-selector')

    fireEvent.click(screen.getByText('연결 테스트'))
    await waitFor(() => {
      expect(screen.getByText(/연결 실패/)).toBeInTheDocument()
    })
  })

  // 설정 초기화 — payload reset_all:true, 이후 "서버 기본값 사용 중" 배너로 되돌아간다
  it('설정 초기화 시 reset_all:true를 보내고 "서버 기본값 사용 중"을 표시한다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(profileConfiguredResponse)
    mockUpdateUserLlmSettings.mockResolvedValue(unconfiguredResponse)
    render(<UserLlmSettings />)
    await screen.findByTestId('user-summary-selector')

    fireEvent.click(screen.getByText('설정 초기화'))
    await waitFor(() => {
      expect(screen.getByText(/서버 기본값 사용 중/)).toBeInTheDocument()
    })
    expect(mockUpdateUserLlmSettings).toHaveBeenCalledWith({
      llm_settings: { provider: '', reset_all: true },
    })
  })

  // I-2: 모달에서 선택된 프로필 삭제 시 부모 카드 선택이 stale(profile:1) 되어 재저장 시
  //   dangling id로 422가 났다. onChanged 폴백으로 '선택 안함'(none)으로 조정돼야 한다.
  it('모달에서 선택된 프로필 삭제 시 요약 선택이 폴백돼 재저장이 dangling id를 보내지 않는다', async () => {
    mockGetUserLlmSettings.mockResolvedValue(profileConfiguredResponse)
    mockUpdateUserLlmSettings.mockResolvedValue(unconfiguredResponse)
    mockDeleteLlmProfile.mockResolvedValue(undefined as never)
    mockListLlmProfiles
      .mockResolvedValueOnce([profile1]) // 카드 마운트
      .mockResolvedValueOnce([profile1]) // 모달 open reload
      .mockResolvedValue([]) // 삭제 후 reload(이후 빈 목록)

    render(<UserLlmSettings />)
    const summarySel = await screen.findByTestId('user-summary-selector')
    await waitFor(() => {
      expect((within(summarySel).getByLabelText('요약 모델 프로필') as HTMLSelectElement).value).toBe('profile:1')
    })

    fireEvent.click(within(summarySel).getByText('프로필 관리'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    fireEvent.click(await screen.findByLabelText('Gemini · 무료키 삭제'))
    await waitFor(() => expect(mockDeleteLlmProfile).toHaveBeenCalledWith(1))
    await waitFor(() => expect(mockListLlmProfiles.mock.calls.length).toBeGreaterThanOrEqual(3))

    fireEvent.click(screen.getAllByRole('button', { name: /저장/ })[0])
    await waitFor(() => expect(mockUpdateUserLlmSettings).toHaveBeenCalled())
    const payload = mockUpdateUserLlmSettings.mock.calls[0][0].llm_settings
    expect(payload).toMatchObject({ provider: '', llm_profile_id: null }) // profile:1 잔존이면 llm_profile_id 미포함/1이라 실패(RED)
  })
})
