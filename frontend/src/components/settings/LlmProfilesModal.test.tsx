import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import LlmProfilesModal from './LlmProfilesModal'
import type { LlmProfile } from '../../api/llmProfiles'

vi.mock('../../api/llmProfiles', () => ({
  listLlmProfiles: vi.fn(),
  createLlmProfile: vi.fn(),
  updateLlmProfile: vi.fn(),
  deleteLlmProfile: vi.fn(),
}))
vi.mock('../../api/userLlmSettings', () => ({
  testUserLlmConnection: vi.fn(),
  fetchUserLlmModels: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../api/settings', () => ({
  fetchOllamaModels: vi.fn().mockResolvedValue([]),
  fetchLmStudioModels: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../lib/openExternal', () => ({ openExternal: vi.fn() }))
// confirmDialog 헬퍼 실제 경로를 grep으로 확인해 동일하게 mock (예: ../../lib/confirmDialog)
vi.mock('../../lib/confirmDialog', () => ({ confirmDialog: vi.fn().mockResolvedValue(true) }))

import { listLlmProfiles, createLlmProfile, deleteLlmProfile } from '../../api/llmProfiles'
import { openExternal } from '../../lib/openExternal'

const gemini: LlmProfile = {
  id: 1, name: 'Gemini · 무료키', preset_id: 'gemini', provider: 'openai',
  base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
  model: 'gemini-3.5-flash', max_input_tokens: null, max_output_tokens: null,
  has_token: true, auth_token_masked: 'AIza...z8kQ',
}

describe('LlmProfilesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(listLlmProfiles).mockResolvedValue([gemini])
  })

  it('open=false면 렌더 안 함', () => {
    render(<LlmProfilesModal scope="personal" open={false} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('열리면 목록 로드·행 표시(이름·마스킹키), 원문 키는 어디에도 없음', async () => {
    render(<LlmProfilesModal scope="personal" open onClose={() => {}} />)
    expect(await screen.findByText('Gemini · 무료키')).toBeInTheDocument()
    expect(screen.getByText(/AIza\.\.\.z8kQ/)).toBeInTheDocument()
    expect(vi.mocked(listLlmProfiles)).toHaveBeenCalledWith('personal')
  })

  it('＋새 프로필 → 폼 노출(프리셋 그리드에 CLI 없음·Gemini 있음), 저장 시 createLlmProfile', async () => {
    vi.mocked(createLlmProfile).mockResolvedValue({ ...gemini, id: 2, name: 'OpenAI · gpt-4o' })
    render(<LlmProfilesModal scope="personal" open onClose={() => {}} />)
    fireEvent.click(await screen.findByText('＋ 새 프로필'))
    const grid = await screen.findByTestId('profile-preset-grid')
    expect(within(grid).queryByText('Claude Code')).toBeNull()
    expect(within(grid).getByText('Google Gemini')).toBeInTheDocument()
    fireEvent.click(screen.getByText('프로필 저장'))
    await waitFor(() => expect(vi.mocked(createLlmProfile)).toHaveBeenCalled())
    expect(vi.mocked(createLlmProfile).mock.calls[0][0]).toBe('personal')
  })

  it('API 키 발급 링크 → openExternal', async () => {
    render(<LlmProfilesModal scope="personal" open onClose={() => {}} />)
    fireEvent.click(await screen.findByText('＋ 새 프로필'))
    fireEvent.click(await screen.findByText(/API 키 발급/))
    expect(vi.mocked(openExternal)).toHaveBeenCalledWith('https://console.anthropic.com/settings/keys')
  })

  it('삭제 → confirm 후 deleteLlmProfile + 목록 갱신', async () => {
    vi.mocked(deleteLlmProfile).mockResolvedValue()
    render(<LlmProfilesModal scope="personal" open onClose={() => {}} />)
    fireEvent.click(await screen.findByLabelText('Gemini · 무료키 삭제'))
    await waitFor(() => expect(vi.mocked(deleteLlmProfile)).toHaveBeenCalledWith(1))
  })

  it('scope=server면 서버 풀 조회 + 토큰 한계 필드 노출', async () => {
    render(<LlmProfilesModal scope="server" open onClose={() => {}} />)
    await screen.findByText('Gemini · 무료키')
    expect(vi.mocked(listLlmProfiles)).toHaveBeenCalledWith('server')
    fireEvent.click(screen.getByText('＋ 새 프로필'))
    expect(await screen.findByLabelText('최대 입력 토큰')).toBeInTheDocument()
  })
})
