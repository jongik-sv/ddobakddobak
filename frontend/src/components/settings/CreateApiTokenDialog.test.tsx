import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CreateApiTokenDialog } from './CreateApiTokenDialog'

vi.mock('../../api/apiTokens', async () => {
  const actual = await vi.importActual<typeof import('../../api/apiTokens')>('../../api/apiTokens')
  return { ...actual, createApiToken: vi.fn() }
})
vi.mock('../../lib/confirmDialog', () => ({ confirmDialog: vi.fn().mockResolvedValue(true) }))

import { createApiToken } from '../../api/apiTokens'
import { confirmDialog } from '../../lib/confirmDialog'

describe('CreateApiTokenDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
  })

  it('기본 스코프는 읽기 4종 on · 쓰기 off, 만료일은 오늘로부터 90일 후로 채워진다', () => {
    render(<CreateApiTokenDialog onClose={() => {}} onCreated={() => {}} />)

    expect((screen.getByLabelText(/회의 조회/) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText(/전사 조회/) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText(/요약 조회/) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText(/^검색/) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText(/회의 쓰기/) as HTMLInputElement).checked).toBe(false)

    const expected = new Date()
    expected.setDate(expected.getDate() + 90)
    expect((screen.getByLabelText('만료일') as HTMLInputElement).value).toBe(expected.toISOString().slice(0, 10))
  })

  it('이름이 비어 있으면 발급 버튼이 비활성화된다', () => {
    render(<CreateApiTokenDialog onClose={() => {}} onCreated={() => {}} />)
    expect(screen.getByText('발급')).toBeDisabled()
  })

  it('모든 스코프를 해제하면 발급 버튼이 비활성화된다', () => {
    render(<CreateApiTokenDialog onClose={() => {}} onCreated={() => {}} />)
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '테스트 토큰' } })
    for (const label of [/회의 조회/, /전사 조회/, /요약 조회/, /^검색/]) {
      fireEvent.click(screen.getByLabelText(label))
    }
    expect(screen.getByText('발급')).toBeDisabled()
  })

  it('발급 성공 시 평문 토큰을 1회 표시하고 onCreated를 호출한다', async () => {
    const onCreated = vi.fn()
    vi.mocked(createApiToken).mockResolvedValue({
      token: {
        id: 1, name: '테스트 토큰', token_prefix: 'ddbk_ab12',
        scopes: ['meetings:read'], project_ids: null, folder_ids: null,
        expires_at: '2026-11-30T00:00:00Z', revoked_at: null, last_used_at: null,
        created_at: '2026-08-01T00:00:00Z',
      },
      plaintext: 'ddbk_secretplaintextvalue',
    })

    render(<CreateApiTokenDialog onClose={() => {}} onCreated={onCreated} />)
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '테스트 토큰' } })
    fireEvent.click(screen.getByText('발급'))

    expect(await screen.findByText('토큰이 발급되었습니다')).toBeInTheDocument()
    expect(screen.getByText('ddbk_secretplaintextvalue')).toBeInTheDocument()
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 1, name: '테스트 토큰' }))
  })

  it('평문 화면에서 복사 버튼 클릭 시 클립보드에 기록하고 "복사됨"으로 바뀐다', async () => {
    vi.mocked(createApiToken).mockResolvedValue({
      token: {
        id: 1, name: 'T', token_prefix: 'ddbk_ab12', scopes: ['meetings:read'],
        project_ids: null, folder_ids: null, expires_at: null, revoked_at: null,
        last_used_at: null, created_at: '2026-08-01T00:00:00Z',
      },
      plaintext: 'ddbk_secretplaintextvalue',
    })

    render(<CreateApiTokenDialog onClose={() => {}} onCreated={() => {}} />)
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: 'T' } })
    fireEvent.click(screen.getByText('발급'))
    await screen.findByText('토큰이 발급되었습니다')

    fireEvent.click(screen.getByText('복사'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ddbk_secretplaintextvalue'))
    expect(await screen.findByText('복사됨')).toBeInTheDocument()
  })

  it('평문 화면 닫기 → confirmDialog로 확인 후 onClose 호출', async () => {
    const onClose = vi.fn()
    vi.mocked(createApiToken).mockResolvedValue({
      token: {
        id: 1, name: 'T', token_prefix: 'ddbk_ab12', scopes: ['meetings:read'],
        project_ids: null, folder_ids: null, expires_at: null, revoked_at: null,
        last_used_at: null, created_at: '2026-08-01T00:00:00Z',
      },
      plaintext: 'ddbk_secretplaintextvalue',
    })

    render(<CreateApiTokenDialog onClose={onClose} onCreated={() => {}} />)
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: 'T' } })
    fireEvent.click(screen.getByText('발급'))
    await screen.findByText('토큰이 발급되었습니다')

    fireEvent.click(screen.getByText('닫기'))
    await waitFor(() => expect(confirmDialog).toHaveBeenCalled())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('발급 실패 시 에러 메시지를 표시하고 평문 화면으로 넘어가지 않는다', async () => {
    vi.mocked(createApiToken).mockRejectedValue(new Error('스코프가 올바르지 않습니다.'))

    render(<CreateApiTokenDialog onClose={() => {}} onCreated={() => {}} />)
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: 'T' } })
    fireEvent.click(screen.getByText('발급'))

    expect(await screen.findByText('스코프가 올바르지 않습니다.')).toBeInTheDocument()
    expect(screen.queryByText('토큰이 발급되었습니다')).toBeNull()
  })

  it('폼 단계 취소 버튼은 확인 없이 즉시 onClose 호출', () => {
    const onClose = vi.fn()
    render(<CreateApiTokenDialog onClose={onClose} onCreated={() => {}} />)
    fireEvent.click(screen.getByText('취소'))
    expect(onClose).toHaveBeenCalled()
    expect(confirmDialog).not.toHaveBeenCalled()
  })
})
