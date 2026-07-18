import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { LlmSettingsPanel } from './LlmSettingsPanel'
import type { LlmSettings } from '../../api/settings'
import type { LlmProfile } from '../../api/llmProfiles'
import { useAuthStore } from '../../stores/authStore'

// API 모듈 모킹
vi.mock('../../api/settings', () => ({
  getLlmSettings: vi.fn(),
  updateLlmSettings: vi.fn(),
  testLlmConnection: vi.fn(),
  fetchOllamaModels: vi.fn().mockResolvedValue([]),
  fetchLmStudioModels: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../api/llmProfiles', () => ({
  listLlmProfiles: vi.fn(),
  createLlmProfile: vi.fn(),
  updateLlmProfile: vi.fn(),
  deleteLlmProfile: vi.fn(),
}))

// LlmProfilesModal(＋내부 LlmProfileForm)이 마운트 시 로컬/외부 링크 관련 모듈을 임포트한다.
// 실제 네트워크로 새지 않도록 함께 목킹(LlmProfilesModal.test.tsx·Task 9 테스트와 동일 세트).
vi.mock('../../api/userLlmSettings', () => ({
  testUserLlmConnection: vi.fn(),
  fetchUserLlmModels: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../lib/openExternal', () => ({ openExternal: vi.fn() }))
vi.mock('../../lib/confirmDialog', () => ({ confirmDialog: vi.fn().mockResolvedValue(true) }))

import { getLlmSettings, updateLlmSettings, testLlmConnection } from '../../api/settings'
import { listLlmProfiles, deleteLlmProfile } from '../../api/llmProfiles'

const mockGetLlmSettings = vi.mocked(getLlmSettings)
const mockUpdateLlmSettings = vi.mocked(updateLlmSettings)
const mockTestLlmConnection = vi.mocked(testLlmConnection)
const mockListLlmProfiles = vi.mocked(listLlmProfiles)
const mockDeleteLlmProfile = vi.mocked(deleteLlmProfile)

// 서버 풀의 프로필 1개 — 요약/챗 셀렉터 드롭다운의 '내 프로필' 그룹에 노출된다.
const serverProfile5: LlmProfile = {
  id: 5,
  name: 'Z.AI · 서버키',
  preset_id: 'zai',
  provider: 'anthropic',
  base_url: 'https://api.z.ai/api/anthropic',
  model: 'glm-5.2',
  max_input_tokens: 200000,
  max_output_tokens: 10000,
  has_token: true,
  auth_token_masked: 'sk-a****abcd',
}

function makeSettings(overrides: Partial<LlmSettings> = {}): LlmSettings {
  return {
    active_preset: 'anthropic',
    chat_model: null,
    chat: null,
    presets: {},
    active_profile_id: null,
    chat_profile_id: null,
    ...overrides,
  }
}

// 프로필 참조로 설정됨 — 요약이 서버 풀 프로필(id 5)을 가리킨다.
const profileConfiguredSettings = makeSettings({ active_profile_id: 5 })

// 레거시 — active_profile_id 없음 + active_preset이 API 프리셋(프로필 미참조). 이관 전·yaml 수동 편집 등.
const legacyUnreferencedSettings = makeSettings({
  active_preset: 'anthropic',
  presets: { anthropic: { provider: 'anthropic', auth_token_masked: 'sk-a****9999', model: 'claude-sonnet-4-6' } },
})

const setAdmin = () => useAuthStore.setState({ user: { id: 1, email: 'admin@x.com', name: 'Admin', role: 'admin' } } as never)
const setMember = () => useAuthStore.setState({ user: { id: 2, email: 'member@x.com', name: 'Member', role: 'member' } } as never)

describe('LlmSettingsPanel - 서버 선택 카드', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListLlmProfiles.mockResolvedValue([serverProfile5])
    setAdmin() // 기본은 admin(CLI 그룹 노출) — 케이스⑤에서만 비admin으로 전환해 검증
  })

  const summarySel = () => screen.getByTestId('summary-selector')
  const chatSel = () => screen.getByTestId('chat-selector')

  // ① 로드 — active_profile_id: 5 응답 → 요약 셀렉터 profile:5
  it('로드: active_profile_id 응답 → 요약 셀렉터가 profile:5 선택 상태', async () => {
    mockGetLlmSettings.mockResolvedValue(profileConfiguredSettings)
    render(<LlmSettingsPanel />)
    await waitFor(() => {
      expect((within(summarySel()).getByLabelText('요약 모델 프로필') as HTMLSelectElement).value).toBe('profile:5')
    })
    expect(mockListLlmProfiles).toHaveBeenCalledWith('server')
  })

  // ② 저장(프로필) → updateLlmSettings({ active_profile_id: 5, ... })
  it('저장: 요약이 프로필(5) 선택 상태면 payload에 active_profile_id를 담는다', async () => {
    mockGetLlmSettings.mockResolvedValue(profileConfiguredSettings)
    mockUpdateLlmSettings.mockResolvedValue(profileConfiguredSettings)
    render(<LlmSettingsPanel />)
    await waitFor(() => {
      expect((within(summarySel()).getByLabelText('요약 모델 프로필') as HTMLSelectElement).value).toBe('profile:5')
    })

    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => expect(mockUpdateLlmSettings).toHaveBeenCalled())
    expect(mockUpdateLlmSettings).toHaveBeenCalledWith(
      expect.objectContaining({ active_profile_id: 5 }),
    )
    // 프로필 참조 저장은 preset 키를 함께 보내지 않는다(데이터손실 방어) — objectContaining은
    // 잉여 키를 무시하므로 부재는 .not.toHaveProperty로만 잡힌다(T10-3 회귀 가드).
    const payload = mockUpdateLlmSettings.mock.calls[0][0]
    expect(payload).not.toHaveProperty('active_preset')
    expect(payload).not.toHaveProperty('preset_id')
    expect(payload).not.toHaveProperty('preset_data')
  })

  // ③ 저장(CLI claude_cli/sonnet) → { active_preset, preset_id, preset_data: { provider, model }, active_profile_id: null }
  it('저장: 요약을 CLI(claude_cli)로 전환 후 저장하면 provider==preset_id 스키마로 전송', async () => {
    mockGetLlmSettings.mockResolvedValue(profileConfiguredSettings)
    mockUpdateLlmSettings.mockResolvedValue(profileConfiguredSettings)
    render(<LlmSettingsPanel />)
    await waitFor(() => {
      expect((within(summarySel()).getByLabelText('요약 모델 프로필') as HTMLSelectElement).value).toBe('profile:5')
    })

    fireEvent.change(within(summarySel()).getByLabelText('요약 모델 프로필'), { target: { value: 'cli:claude_cli' } })
    await waitFor(() => {
      expect((within(summarySel()).getByLabelText('요약 모델 CLI 모델') as HTMLSelectElement).value).toBe('sonnet')
    })

    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => expect(mockUpdateLlmSettings).toHaveBeenCalled())
    expect(mockUpdateLlmSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        active_preset: 'claude_cli',
        preset_id: 'claude_cli',
        preset_data: { provider: 'claude_cli', model: 'sonnet' },
        active_profile_id: null,
      }),
    )
  })

  // ④ 챗 '요약과 동일' → payload에 chat:{ provider: '' } 포함
  it("저장: 챗이 '요약과 동일'(기본)이면 payload에 chat.provider=''를 담는다", async () => {
    mockGetLlmSettings.mockResolvedValue(profileConfiguredSettings)
    mockUpdateLlmSettings.mockResolvedValue(profileConfiguredSettings)
    render(<LlmSettingsPanel />)
    await waitFor(() => {
      expect((within(summarySel()).getByLabelText('요약 모델 프로필') as HTMLSelectElement).value).toBe('profile:5')
    })

    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => expect(mockUpdateLlmSettings).toHaveBeenCalled())
    expect(mockUpdateLlmSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        chat: expect.objectContaining({ provider: '' }),
        chat_profile_id: null,
      }),
    )
  })

  // 저장(챗 프로필): 챗 드롭다운에서 프로필(5) 선택 후 저장 → payload chat_profile_id
  it('저장: 챗을 프로필(5)로 전환 후 저장하면 payload에 chat_profile_id를 담는다', async () => {
    mockGetLlmSettings.mockResolvedValue(profileConfiguredSettings)
    mockUpdateLlmSettings.mockResolvedValue(profileConfiguredSettings)
    render(<LlmSettingsPanel />)
    await waitFor(() => {
      expect((within(summarySel()).getByLabelText('요약 모델 프로필') as HTMLSelectElement).value).toBe('profile:5')
    })

    fireEvent.change(within(chatSel()).getByLabelText('AI 챗 모델 프로필'), { target: { value: 'profile:5' } })
    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => expect(mockUpdateLlmSettings).toHaveBeenCalled())
    expect(mockUpdateLlmSettings).toHaveBeenCalledWith(
      expect.objectContaining({ chat_profile_id: 5 }),
    )
  })

  // 저장(챗 CLI): 챗 드롭다운에서 CLI(claude_cli) 선택 후 저장 → payload chat:{ preset_id, provider, model }, chat_profile_id:null
  it('저장: 챗을 CLI(claude_cli)로 전환 후 저장하면 payload에 chat.preset_id/provider/model을 담는다', async () => {
    mockGetLlmSettings.mockResolvedValue(profileConfiguredSettings)
    mockUpdateLlmSettings.mockResolvedValue(profileConfiguredSettings)
    render(<LlmSettingsPanel />)
    await waitFor(() => {
      expect((within(summarySel()).getByLabelText('요약 모델 프로필') as HTMLSelectElement).value).toBe('profile:5')
    })

    fireEvent.change(within(chatSel()).getByLabelText('AI 챗 모델 프로필'), { target: { value: 'cli:claude_cli' } })
    await waitFor(() => {
      expect((within(chatSel()).getByLabelText('AI 챗 모델 CLI 모델') as HTMLSelectElement).value).toBe('sonnet')
    })

    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => expect(mockUpdateLlmSettings).toHaveBeenCalled())
    expect(mockUpdateLlmSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        chat: { preset_id: 'claude_cli', provider: 'claude_cli', model: 'sonnet' },
        chat_profile_id: null,
      }),
    )
  })

  // ⑤ 비admin+server 모드(getMode='server', jsdom 기본값) → 시스템 CLI 그룹 숨김, admin이면 노출
  it('비admin+server 모드에서는 시스템 CLI 그룹이 숨겨지고, admin이면 노출된다', async () => {
    setMember()
    mockGetLlmSettings.mockResolvedValue(profileConfiguredSettings)
    const { unmount } = render(<LlmSettingsPanel />)
    await waitFor(() => {
      expect((within(summarySel()).getByLabelText('요약 모델 프로필') as HTMLSelectElement).value).toBe('profile:5')
    })
    // optgroup label은 속성이라 텍스트 노드가 아니므로, 그룹 내부 option(예: 'Claude Code')의 존재로 판별한다.
    expect(within(summarySel()).queryByText('Claude Code')).toBeNull()
    unmount()

    setAdmin()
    render(<LlmSettingsPanel />)
    await waitFor(() => {
      expect((within(summarySel()).getByLabelText('요약 모델 프로필') as HTMLSelectElement).value).toBe('profile:5')
    })
    expect(within(summarySel()).getByText('Claude Code')).toBeInTheDocument()
  })

  // ⑥ '프로필 관리' → dialog + listLlmProfiles가 'server'로 호출
  it("'프로필 관리' 클릭 시 프로필 모달이 열리고 listLlmProfiles가 'server'로 호출된다", async () => {
    mockGetLlmSettings.mockResolvedValue(profileConfiguredSettings)
    render(<LlmSettingsPanel />)
    await waitFor(() => {
      expect((within(summarySel()).getByLabelText('요약 모델 프로필') as HTMLSelectElement).value).toBe('profile:5')
    })

    expect(screen.queryByRole('dialog')).toBeNull()
    // 마운트 시 이미 listLlmProfiles('server')가 1회 호출되어 있으므로, 모달이 열며
    // 자체 reload를 한 번 더 호출하는지(=scope='server'로 전달됐는지)를 호출 횟수로 검증한다.
    const callsBeforeOpen = mockListLlmProfiles.mock.calls.length
    fireEvent.click(within(summarySel()).getByText('프로필 관리'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await waitFor(() => expect(mockListLlmProfiles.mock.calls.length).toBeGreaterThan(callsBeforeOpen))
    expect(mockListLlmProfiles.mock.calls.every(([scope]) => scope === 'server')).toBe(true)
  })

  // ⑦ 레거시 폴백 — active_profile_id 없음 + active_preset이 API 프리셋(프로필 미참조) → cli:claude_cli/sonnet 폴백
  it('레거시 폴백: active_profile_id 없이 프로필 미참조 API 프리셋이면 cli:claude_cli/sonnet으로 폴백 표시(크래시 없음)', async () => {
    mockGetLlmSettings.mockResolvedValue(legacyUnreferencedSettings)
    render(<LlmSettingsPanel />)
    await waitFor(() => {
      expect((within(summarySel()).getByLabelText('요약 모델 프로필') as HTMLSelectElement).value).toBe('cli:claude_cli')
    })
    expect((within(summarySel()).getByLabelText('요약 모델 CLI 모델') as HTMLSelectElement).value).toBe('sonnet')
    // 빈 화면·크래시 없이 챗 카드까지 정상 렌더
    expect(chatSel()).toBeInTheDocument()
  })

  // handleLlmTest: 프로필 분기에 base_url·profile_id 동봉
  it('연결 테스트: 요약이 프로필이면 base_url·profile_id를 동봉해 testLlmConnection을 호출한다', async () => {
    mockGetLlmSettings.mockResolvedValue(profileConfiguredSettings)
    mockTestLlmConnection.mockResolvedValue({ success: true })
    render(<LlmSettingsPanel />)
    await waitFor(() => {
      expect((within(summarySel()).getByLabelText('요약 모델 프로필') as HTMLSelectElement).value).toBe('profile:5')
    })

    fireEvent.click(screen.getByText('연결 테스트'))
    await waitFor(() => expect(mockTestLlmConnection).toHaveBeenCalled())
    expect(mockTestLlmConnection).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: 'glm-5.2',
      base_url: 'https://api.z.ai/api/anthropic',
      profile_id: 5,
    })
    await waitFor(() => expect(screen.getByText('연결 성공')).toBeInTheDocument())
  })

  // max tokens 필드 제거 확인 (서버 프로필 폼으로 이동 완료 — Task 8)
  it('max_input/output_tokens 필드가 패널에서 제거되었다', async () => {
    mockGetLlmSettings.mockResolvedValue(profileConfiguredSettings)
    render(<LlmSettingsPanel />)
    await waitFor(() => {
      expect((within(summarySel()).getByLabelText('요약 모델 프로필') as HTMLSelectElement).value).toBe('profile:5')
    })
    expect(screen.queryByLabelText(/최대 입력 토큰/)).toBeNull()
    expect(screen.queryByLabelText(/최대 출력 토큰/)).toBeNull()
  })

  // I-2: 모달에서 현재 선택된 프로필을 삭제하면 부모 카드 선택이 stale(profile:5) 되어
  //   재저장 시 dangling id로 422가 났다. onChanged 폴백으로 선택이 조정돼야 한다.
  it('모달에서 선택된 프로필 삭제 시 요약 선택이 폴백돼 재저장이 dangling id를 보내지 않는다', async () => {
    mockGetLlmSettings.mockResolvedValue(profileConfiguredSettings)
    mockUpdateLlmSettings.mockResolvedValue(makeSettings({ active_profile_id: null, active_preset: 'claude_cli' }))
    mockDeleteLlmProfile.mockResolvedValue(undefined as never)
    mockListLlmProfiles
      .mockResolvedValueOnce([serverProfile5]) // 패널 마운트
      .mockResolvedValueOnce([serverProfile5]) // 모달 open reload
      .mockResolvedValue([]) // 삭제 후 reload(이후 빈 목록)

    render(<LlmSettingsPanel />)
    await waitFor(() => {
      expect((within(summarySel()).getByLabelText('요약 모델 프로필') as HTMLSelectElement).value).toBe('profile:5')
    })

    fireEvent.click(within(summarySel()).getByText('프로필 관리'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    fireEvent.click(await screen.findByLabelText('Z.AI · 서버키 삭제'))
    await waitFor(() => expect(mockDeleteLlmProfile).toHaveBeenCalledWith(5))
    await waitFor(() => expect(mockListLlmProfiles.mock.calls.length).toBeGreaterThanOrEqual(3))

    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => expect(mockUpdateLlmSettings).toHaveBeenCalled())
    const payload = mockUpdateLlmSettings.mock.calls[0][0]
    expect(payload.active_profile_id).toBeNull() // profile:5 잔존이면 5가 담겨 실패(RED)
  })
})
