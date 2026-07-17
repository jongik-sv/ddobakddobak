import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DomainFilesDialog from './DomainFilesDialog'

const selectedFiles = [{ id: 1, name: '설비 용어집', project_id: 5, updated_at: '2026-01-01T00:00:00Z', editable: true }]
const inheritedFiles = [
  { id: 3, name: '전사 공통 용어집', project_id: null, updated_at: '2026-01-01T00:00:00Z', editable: false, source: 'project' as const, owner_name: '반도체 프로젝트' },
]
const availableFiles = [
  { id: 1, name: '설비 용어집', project_id: 5, created_by_id: 1, content_chars: 10, updated_at: '2026-01-01T00:00:00Z', editable: true },
  { id: 2, name: '공정 용어집', project_id: 5, created_by_id: 1, content_chars: 20, updated_at: '2026-01-01T00:00:00Z', editable: true },
  { id: 3, name: '전사 공통 용어집', project_id: null, created_by_id: 2, content_chars: 5, updated_at: '2026-01-01T00:00:00Z', editable: false },
]

vi.mock('../../api/domainFiles', () => ({
  listDomainFiles: vi.fn(async () => ({ domain_files: availableFiles })),
  getFolderDomainFiles: vi.fn(async () => ({ domain_files: selectedFiles, inherited: inheritedFiles })),
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

  // 증분 C: 상위(프로젝트/조상 폴더)에서 상속된 파일은 폴더 선택 모달에서도 체크 불가
  it('상위에서 상속된 파일은 선택 모달에서 체크박스가 비활성화된다', async () => {
    render(<DomainFilesDialog folderId={7} folderName="설비팀 폴더" projectId={5} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('설비 용어집')).toBeInTheDocument())

    await userEvent.click(screen.getByText('파일 선택'))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '전사 공통 용어집' })).toBeInTheDocument())

    const checkbox = screen.getByRole('checkbox', { name: '전사 공통 용어집' }) as HTMLInputElement
    expect(checkbox).toBeDisabled()
    expect(checkbox.checked).toBe(true)
    expect(screen.getByText('프로젝트/폴더에서 이미 적용됨')).toBeInTheDocument()
  })

  it('닫기 버튼으로 onClose를 호출한다', async () => {
    const onClose = vi.fn()
    render(<DomainFilesDialog folderId={7} folderName="설비팀 폴더" projectId={5} onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('설비 용어집')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(onClose).toHaveBeenCalled()
  })
})
