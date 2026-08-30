import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import ApiTokensPanel from './ApiTokensPanel'
import type { ApiToken } from '../../api/apiTokens'

vi.mock('../../api/apiTokens', () => ({
  listApiTokens: vi.fn(),
  createApiToken: vi.fn(),
  deleteApiToken: vi.fn(),
  downloadSkillPackage: vi.fn(),
  API_TOKEN_SCOPES: ['meetings:read', 'transcripts:read', 'summaries:read', 'search:read', 'meetings:write'],
}))
vi.mock('../../lib/confirmDialog', () => ({ confirmDialog: vi.fn().mockResolvedValue(true) }))

import { listApiTokens, createApiToken, deleteApiToken, downloadSkillPackage } from '../../api/apiTokens'
import { confirmDialog } from '../../lib/confirmDialog'

function makeToken(o: Partial<ApiToken> = {}): ApiToken {
  return {
    id: 1,
    name: 'Claude Code 연동',
    token_prefix: 'ddbk_ab12',
    scopes: ['meetings:read', 'transcripts:read'],
    project_ids: null,
    folder_ids: null,
    expires_at: '2026-11-30T00:00:00Z',
    revoked_at: null,
    last_used_at: null,
    created_at: '2026-08-01T00:00:00Z',
    ...o,
  }
}

describe('ApiTokensPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('빈 목록이면 안내 문구를 표시한다', async () => {
    vi.mocked(listApiTokens).mockResolvedValue([])
    render(<ApiTokensPanel />)
    expect(await screen.findByText('발급된 토큰이 없습니다.')).toBeInTheDocument()
  })

  it('토큰 목록을 렌더한다 — 이름·마스킹된 prefix·스코프 뱃지·만료일·상태', async () => {
    vi.mocked(listApiTokens).mockResolvedValue([makeToken()])
    render(<ApiTokensPanel />)

    expect(await screen.findByText('Claude Code 연동')).toBeInTheDocument()
    expect(screen.getByText(/ddbk_ab12••••••••/)).toBeInTheDocument()
    expect(screen.getByText('회의 조회')).toBeInTheDocument()
    expect(screen.getByText('전사 조회')).toBeInTheDocument()
    expect(screen.getByText('활성')).toBeInTheDocument()
  })

  it('폐기된 토큰은 "폐기됨" 배지를 표시하고 폐기 버튼이 없다', async () => {
    vi.mocked(listApiTokens).mockResolvedValue([makeToken({ revoked_at: '2026-08-10T00:00:00Z' })])
    render(<ApiTokensPanel />)

    expect(await screen.findByText('폐기됨')).toBeInTheDocument()
    expect(screen.queryByLabelText(/폐기$/)).toBeNull()
  })

  it('폐기 버튼 → confirmDialog 후 deleteApiToken 호출 + 목록 갱신', async () => {
    const token = makeToken()
    vi.mocked(listApiTokens).mockResolvedValueOnce([token]).mockResolvedValueOnce([])
    vi.mocked(deleteApiToken).mockResolvedValue(undefined)

    render(<ApiTokensPanel />)
    fireEvent.click(await screen.findByLabelText('Claude Code 연동 폐기'))

    expect(vi.mocked(confirmDialog)).toHaveBeenCalled()
    await waitFor(() => expect(deleteApiToken).toHaveBeenCalledWith(token.id))
  })

  it('LLM 스킬 다운로드 버튼 → downloadSkillPackage 호출', async () => {
    vi.mocked(listApiTokens).mockResolvedValue([])
    vi.mocked(downloadSkillPackage).mockResolvedValue(undefined)

    render(<ApiTokensPanel />)
    await screen.findByText('발급된 토큰이 없습니다.')
    fireEvent.click(screen.getByText('LLM 스킬 다운로드'))

    await waitFor(() => expect(downloadSkillPackage).toHaveBeenCalled())
  })

  it('토큰 발급 버튼 → 발급 모달이 열린다', async () => {
    vi.mocked(listApiTokens).mockResolvedValue([])
    render(<ApiTokensPanel />)
    await screen.findByText('발급된 토큰이 없습니다.')

    fireEvent.click(screen.getByText('토큰 발급'))
    expect(await screen.findByText('API 토큰 발급')).toBeInTheDocument()
  })

  it('발급 완료 시 목록에 즉시 반영된다(재조회 없이)', async () => {
    vi.mocked(listApiTokens).mockResolvedValue([])
    render(<ApiTokensPanel />)
    await screen.findByText('발급된 토큰이 없습니다.')
    fireEvent.click(screen.getByText('토큰 발급'))

    const dialog = await screen.findByText('API 토큰 발급')
    const form = dialog.closest('form')
    if (!form) throw new Error('form not found')

    vi.mocked(createApiToken).mockResolvedValue({
      token: makeToken({ id: 99, name: '새 토큰' }),
      plaintext: 'ddbk_secretplaintext',
    })

    fireEvent.change(within(form).getByLabelText('이름'), { target: { value: '새 토큰' } })
    fireEvent.click(within(form).getByText('발급'))

    expect(await screen.findByText('새 토큰')).toBeInTheDocument()
  })
})
