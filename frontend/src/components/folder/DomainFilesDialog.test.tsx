import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DomainFilesDialog from './DomainFilesDialog'

const selectedFiles = [{ id: 1, name: '설비 용어집', project_id: 5, updated_at: '2026-01-01T00:00:00Z', editable: true }]
const availableFiles = [
  { id: 1, name: '설비 용어집', project_id: 5, created_by_id: 1, content_chars: 10, updated_at: '2026-01-01T00:00:00Z' },
  { id: 2, name: '공정 용어집', project_id: 5, created_by_id: 1, content_chars: 20, updated_at: '2026-01-01T00:00:00Z' },
]

vi.mock('../../api/domainFiles', () => ({
  listDomainFiles: vi.fn(async () => ({ domain_files: availableFiles })),
  getFolderDomainFiles: vi.fn(async () => ({ domain_files: selectedFiles })),
  setFolderDomainFiles: vi.fn(async (_id: number, ids: number[]) => ({
    domain_files: availableFiles.filter((f) => ids.includes(f.id)).map((f) => ({
      id: f.id, name: f.name, project_id: f.project_id, updated_at: f.updated_at, editable: true,
    })),
  })),
}))

describe('DomainFilesDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('폴더 이름을 제목에 표시하고 링크된 도메인 파일을 보여준다', async () => {
    render(<DomainFilesDialog folderId={7} folderName="설비팀 폴더" projectId={5} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('도메인 파일 — 설비팀 폴더')).toBeInTheDocument())
    expect(screen.getByText('설비 용어집')).toBeInTheDocument()
  })

  it('파일 선택 후 확인하면 setFolderDomainFiles를 호출한다', async () => {
    const api = await import('../../api/domainFiles')
    render(<DomainFilesDialog folderId={7} folderName="설비팀 폴더" projectId={5} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('설비 용어집')).toBeInTheDocument())

    await userEvent.click(screen.getByText('파일 선택'))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '공정 용어집' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('checkbox', { name: '공정 용어집' }))
    await userEvent.click(screen.getByRole('button', { name: '확인' }))

    await waitFor(() => expect(api.setFolderDomainFiles).toHaveBeenCalledWith(7, expect.arrayContaining([1, 2])))
  })

  it('닫기 버튼으로 onClose를 호출한다', async () => {
    const onClose = vi.fn()
    render(<DomainFilesDialog folderId={7} folderName="설비팀 폴더" projectId={5} onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('설비 용어집')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(onClose).toHaveBeenCalled()
  })
})
