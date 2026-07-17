import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DomainFileViewerModal from './DomainFileViewerModal'

const CONTENT = [
  '- **APM** [약어]: 자동 공정 모니터링',
  '- **라인A**: 1공장 조립라인',
  '자유 서술 라인은 그대로 보존',
].join('\n')

const confirmDialog = vi.fn(async () => true)
vi.mock('../../lib/confirmDialog', () => ({
  confirmDialog: (...args: unknown[]) => confirmDialog(...args),
}))

vi.mock('../../api/domainFiles', () => ({
  getDomainFile: vi.fn(async () => ({
    domain_file: { id: 1, name: '공정 용어집', project_id: null, created_by_id: 1, content_chars: CONTENT.length, updated_at: '2026-01-01T00:00:00Z', content: CONTENT },
  })),
  updateDomainFile: vi.fn(async (_id: number, data: { name?: string; content?: string }) => ({
    domain_file: { id: 1, name: data.name ?? '공정 용어집', project_id: null, created_by_id: 1, content_chars: (data.content ?? CONTENT).length, updated_at: '2026-01-02T00:00:00Z', content: data.content ?? CONTENT },
  })),
  deleteDomainFile: vi.fn(async () => {}),
}))

vi.mock('../../api/glossary', () => ({
  createMeetingGlossaryEntry: vi.fn(async () => ({ entry: { id: 1, from_text: 'APM', to_text: 'APM', match_type: 'literal', enabled: true, owner_type: 'Meeting', owner_id: 1 } })),
}))

describe('DomainFileViewerModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('용어 라인을 용어/분류/설명으로 파싱해 표시하고, 자유 텍스트는 원문 보존한다', async () => {
    render(<DomainFileViewerModal fileId={1} meetingId={1} canEdit={true} onClose={vi.fn()} onSaved={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('APM')).toBeInTheDocument())
    expect(screen.getByText('[약어]')).toBeInTheDocument()
    expect(screen.getByText('자동 공정 모니터링')).toBeInTheDocument()
    expect(screen.getByText('라인A')).toBeInTheDocument()
    expect(screen.getByText('자유 서술 라인은 그대로 보존')).toBeInTheDocument()
  })

  it('canEdit=false면 편집 버튼이 없다', async () => {
    render(<DomainFileViewerModal fileId={1} meetingId={1} canEdit={false} onClose={vi.fn()} onSaved={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('APM')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '편집' })).not.toBeInTheDocument()
  })

  it('편집 → 저장하면 updateDomainFile을 호출하고 성공 메시지를 보여준다', async () => {
    const api = await import('../../api/domainFiles')
    const onSaved = vi.fn()
    render(<DomainFileViewerModal fileId={1} meetingId={1} canEdit={true} onClose={vi.fn()} onSaved={onSaved} />)

    await waitFor(() => expect(screen.getByText('APM')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '편집' }))

    const nameInput = screen.getByDisplayValue('공정 용어집')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, '수정된 용어집')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(api.updateDomainFile).toHaveBeenCalledWith(1, expect.objectContaining({ name: '수정된 용어집' })))
    await waitFor(() => expect(screen.getByText('저장되었습니다')).toBeInTheDocument())
    expect(onSaved).toHaveBeenCalled()
  })

  it('editable=false면 canEdit=true여도 편집·삭제 버튼이 없다', async () => {
    render(<DomainFileViewerModal fileId={1} meetingId={1} canEdit={true} editable={false} onClose={vi.fn()} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('APM')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '편집' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '삭제' })).not.toBeInTheDocument()
  })

  it('onDeleted 미지정이면 editable해도 삭제 버튼이 없다', async () => {
    render(<DomainFileViewerModal fileId={1} meetingId={1} canEdit={true} editable={true} onClose={vi.fn()} onSaved={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('APM')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '삭제' })).not.toBeInTheDocument()
  })

  it('삭제 버튼 클릭 → 확인 후 deleteDomainFile을 호출하고 onDeleted를 호출한다', async () => {
    const api = await import('../../api/domainFiles')
    const onDeleted = vi.fn()
    render(<DomainFileViewerModal fileId={1} meetingId={1} canEdit={true} editable={true} onClose={vi.fn()} onSaved={vi.fn()} onDeleted={onDeleted} />)
    await waitFor(() => expect(screen.getByText('APM')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: '삭제' }))

    expect(confirmDialog).toHaveBeenCalled()
    await waitFor(() => expect(api.deleteDomainFile).toHaveBeenCalledWith(1))
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
  })

  it('삭제 확인을 취소하면 deleteDomainFile을 호출하지 않는다', async () => {
    const api = await import('../../api/domainFiles')
    confirmDialog.mockResolvedValueOnce(false)
    render(<DomainFileViewerModal fileId={1} meetingId={1} canEdit={true} editable={true} onClose={vi.fn()} onSaved={vi.fn()} onDeleted={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('APM')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: '삭제' }))

    expect(confirmDialog).toHaveBeenCalled()
    expect(api.deleteDomainFile).not.toHaveBeenCalled()
  })

  it('용어 행의 [교정 추가]로 오타사전 등록 다이얼로그를 연다', async () => {
    const glossaryApi = await import('../../api/glossary')
    render(<DomainFileViewerModal fileId={1} meetingId={5} canEdit={true} onClose={vi.fn()} onSaved={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('APM')).toBeInTheDocument())
    const rows = screen.getAllByRole('button', { name: '교정 추가' })
    await userEvent.click(rows[0])

    const input = screen.getByPlaceholderText('잘못 인식되는 표기')
    await userEvent.type(input, 'ㅔㅣㅔㅁ')
    await userEvent.click(screen.getByRole('button', { name: '등록' }))

    await waitFor(() => expect(glossaryApi.createMeetingGlossaryEntry).toHaveBeenCalledWith(5, { from_text: 'ㅔㅣㅔㅁ', to_text: 'APM' }))
  })
})
