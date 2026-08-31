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
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
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

  it('다운로드 성공 후 설치 프롬프트 안내 박스가 표시된다 — 복사 및 닫기 가능', async () => {
    vi.mocked(listApiTokens).mockResolvedValue([])
    vi.mocked(downloadSkillPackage).mockResolvedValue(undefined)

    render(<ApiTokensPanel />)
    await screen.findByText('발급된 토큰이 없습니다.')

    expect(screen.queryByText('프롬프트 복사')).toBeNull()

    fireEvent.click(screen.getByText('LLM 스킬 다운로드'))
    await waitFor(() => expect(downloadSkillPackage).toHaveBeenCalled())

    expect(
      await screen.findByText(/받은 zip을 직접 풀 필요 없이, 아래 프롬프트를 Claude Code 같은 에이전트에/),
    ).toBeInTheDocument()
    expect(screen.getByText(/방금 다운로드한 또박또박 회의 스킬\(ddobak-skill\.zip\)을 설치해줘\./)).toBeInTheDocument()

    fireEvent.click(screen.getByText('프롬프트 복사'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    const copiedText = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0]
    expect(copiedText).toContain('방금 다운로드한 또박또박 회의 스킬(ddobak-skill.zip)을 설치해줘.')
    expect(copiedText).toContain('1. 다운로드 폴더의 ddobak-skill.zip을 스킬 폴더에 풀어줘')
    expect(copiedText).toContain('2. 이미 설치되어 있으면 설정 파일(.env.ddobak 또는 env.ddobak)은 보존하고')
    expect(copiedText).toContain('3. 설치 후 스킬 폴더에서 `python3 scripts/ddobak_api.py me`를 실행해 연결을 확인해줘')
    expect(copiedText).toContain('설정 파일이 없다고 나오면')
    expect(await screen.findByText('복사됨')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('설치 안내 닫기'))
    await waitFor(() => expect(screen.queryByText('프롬프트 복사')).toBeNull())
  })

  it('다운로드 실패 시 설치 프롬프트 안내 박스를 표시하지 않는다', async () => {
    vi.mocked(listApiTokens).mockResolvedValue([])
    vi.mocked(downloadSkillPackage).mockRejectedValue(new Error('network error'))

    render(<ApiTokensPanel />)
    await screen.findByText('발급된 토큰이 없습니다.')
    fireEvent.click(screen.getByText('LLM 스킬 다운로드'))

    await screen.findByText('LLM 스킬 패키지를 내려받지 못했습니다.')
    expect(screen.queryByText('프롬프트 복사')).toBeNull()
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
