import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CreateApiTokenDialog } from './CreateApiTokenDialog'

vi.mock('../../api/apiTokens', async () => {
  const actual = await vi.importActual<typeof import('../../api/apiTokens')>('../../api/apiTokens')
  return { ...actual, createApiToken: vi.fn() }
})
vi.mock('../../lib/confirmDialog', () => ({ confirmDialog: vi.fn().mockResolvedValue(true) }))

const downloadText = vi.fn().mockResolvedValue(undefined)
vi.mock('../../lib/download', () => ({
  downloadText: (...a: unknown[]) => downloadText(...a),
}))

// Tauri 데스크톱 앱에서는 window.location.origin이 http://tauri.localhost로 고정되므로
// (실제 API 서버 주소가 아님) getApiOrigin()을 목킹해 그 값이 쓰이는지 검증한다.
const getApiOrigin = vi.fn().mockReturnValue('http://127.0.0.1:13323')
vi.mock('../../config', async () => {
  const actual = await vi.importActual<typeof import('../../config')>('../../config')
  return { ...actual, getApiOrigin: () => getApiOrigin() }
})

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

  it('평문 화면에 .env.ddobak 다운로드 버튼과 OS별 설치 경로 안내가 표시된다', async () => {
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

    expect(screen.getByText('설정 파일(.env.ddobak) 다운로드')).toBeInTheDocument()
    expect(screen.getByText('~/.claude/skills/ddobak-meetings/.env.ddobak')).toBeInTheDocument()
    expect(screen.getByText('%USERPROFILE%\\.claude\\skills\\ddobak-meetings\\.env.ddobak')).toBeInTheDocument()

    // 점 없는 파일명(env.ddobak)으로 저장돼도 그대로 동작한다는 안내 — <code>가 섞여
    // 텍스트 노드가 분리되므로 textContent 기반 커스텀 매처로 확인한다.
    expect(
      screen.getByText((_, element) => {
        if (element?.tagName.toLowerCase() !== 'p') return false
        const text = element.textContent ?? ''
        return text.includes('env.ddobak') && text.includes('점 없음') && text.includes('이름을 바꾸지 않아도 그대로 동작합니다')
      }),
    ).toBeInTheDocument()
  })

  it('.env.ddobak 다운로드 버튼 클릭 시 getApiOrigin()·토큰이 채워진 내용으로 downloadText를 호출한다(Tauri에서도 실제 서버 origin을 쓴다)', async () => {
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

    fireEvent.click(screen.getByText('설정 파일(.env.ddobak) 다운로드'))
    await waitFor(() => expect(downloadText).toHaveBeenCalledTimes(1))

    const [content, filename, mime] = downloadText.mock.calls[0]
    expect(filename).toBe('.env.ddobak')
    expect(mime).toBe('text/plain;charset=utf-8')
    // window.location.origin(테스트 환경의 jsdom 기본 origin)이 아니라
    // getApiOrigin()의 목킹된 반환값이 쓰였는지 확인 — Tauri에서 tauri.localhost가
    // 새어나가지 않는다는 회귀 방지.
    expect(content).toContain('DDOBAK_API_URL=http://127.0.0.1:13323')
    expect(content).not.toContain(window.location.origin)
    expect(content).toContain('DDOBAK_API_TOKEN=ddbk_secretplaintextvalue')
    expect(content).toContain('# DDOBAK_API_INSECURE=1')
  })

  it('getApiOrigin()이 빈 문자열이면(모바일 브릿지 포트 미준비) window.location.origin으로 폴백한다', async () => {
    getApiOrigin.mockReturnValueOnce('')
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

    fireEvent.click(screen.getByText('설정 파일(.env.ddobak) 다운로드'))
    await waitFor(() => expect(downloadText).toHaveBeenCalledTimes(1))

    const [content] = downloadText.mock.calls[0]
    expect(content).toContain(`DDOBAK_API_URL=${window.location.origin}`)
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
