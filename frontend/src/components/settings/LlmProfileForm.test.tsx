import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LlmProfileForm } from './LlmProfileForm'
import type { LlmProfile } from '../../api/llmProfiles'

vi.mock('../../api/llmProfiles', () => ({
  createLlmProfile: vi.fn(),
  updateLlmProfile: vi.fn(),
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

import { fetchUserLlmModels } from '../../api/userLlmSettings'

const initial: LlmProfile = {
  id: 42,
  name: 'A',
  preset_id: 'anthropic',
  provider: 'anthropic',
  base_url: null,
  model: 'claude-sonnet-5',
  max_input_tokens: 200000,
  max_output_tokens: 10000,
  has_token: true,
  auth_token_masked: 'sk-a****',
}

describe('LlmProfileForm 모델 새로고침', () => {
  beforeEach(() => {
    vi.mocked(fetchUserLlmModels).mockClear()
    vi.mocked(fetchUserLlmModels).mockResolvedValue([])
  })

  it('기존 프로필 + 빈 키 → profile_id 를 함께 보낸다', async () => {
    render(<LlmProfileForm scope="personal" initial={initial} onSaved={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '모델 새로고침' }))
    await waitFor(() => expect(fetchUserLlmModels).toHaveBeenCalled())
    expect(fetchUserLlmModels).toHaveBeenCalledWith(expect.objectContaining({ provider: 'anthropic', profile_id: 42 }))
  })

  it('새 키를 입력하면 그 키를 쓰고 profile_id 는 보내지 않는다', async () => {
    render(<LlmProfileForm scope="personal" initial={initial} onSaved={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('sk-a****'), { target: { value: 'sk-new' } })
    fireEvent.click(screen.getByRole('button', { name: '모델 새로고침' }))
    await waitFor(() => expect(fetchUserLlmModels).toHaveBeenCalled())
    const arg = vi.mocked(fetchUserLlmModels).mock.calls[0][0]
    expect(arg.api_key).toBe('sk-new')
    expect(arg).not.toHaveProperty('profile_id')
  })

  it('신규 프로필(initial null)은 profile_id 를 보내지 않는다', async () => {
    render(<LlmProfileForm scope="personal" initial={null} onSaved={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '모델 새로고침' }))
    await waitFor(() => expect(fetchUserLlmModels).toHaveBeenCalled())
    expect(vi.mocked(fetchUserLlmModels).mock.calls[0][0]).not.toHaveProperty('profile_id')
  })

  it('API 키 칸은 비밀번호 자동완성을 막고, 텍스트 칸은 autocomplete=off', () => {
    const { container } = render(<LlmProfileForm scope="personal" initial={initial} onSaved={vi.fn()} onCancel={vi.fn()} />)
    const key = container.querySelector('#profile-key')!
    expect(key.getAttribute('autocomplete')).toBe('new-password')
    expect(key.getAttribute('data-lpignore')).toBe('true')
    expect(key.hasAttribute('data-1p-ignore')).toBe(true)
    expect(container.querySelector('#profile-name')!.getAttribute('autocomplete')).toBe('off')
    expect(container.querySelector('#profile-base')!.getAttribute('autocomplete')).toBe('off')
  })
})
