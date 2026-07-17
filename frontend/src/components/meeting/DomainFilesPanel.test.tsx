import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DomainFilesPanel from './DomainFilesPanel'

const selectedFiles = [{ id: 1, name: '공정 용어집', project_id: null, updated_at: '2026-01-01T00:00:00Z', editable: true }]
const inheritedFiles = [
  { id: 9, name: '전사 공통 용어집', project_id: 5, updated_at: '2026-01-01T00:00:00Z', editable: false, source: 'project' as const, owner_name: '반도체 프로젝트' },
]
const excludedFiles: { id: number; name: string; project_id: number | null; updated_at: string; editable: boolean }[] = []
const availableFiles = [
  { id: 1, name: '공정 용어집', project_id: null, created_by_id: 1, content_chars: 10, updated_at: '2026-01-01T00:00:00Z', editable: true },
  { id: 2, name: '설비 용어집', project_id: 5, created_by_id: 1, content_chars: 20, updated_at: '2026-01-01T00:00:00Z', editable: true },
  { id: 9, name: '전사 공통 용어집', project_id: 5, created_by_id: 2, content_chars: 5, updated_at: '2026-01-01T00:00:00Z', editable: false },
]

const confirmDialog = vi.fn(async () => true)
vi.mock('../../lib/confirmDialog', () => ({
  confirmDialog: (...args: unknown[]) => confirmDialog(...args),
}))

vi.mock('../../api/domainFiles', () => ({
  getMeetingDomainFiles: vi.fn(async () => ({ selected: selectedFiles, inherited: inheritedFiles, excluded: excludedFiles })),
  listDomainFiles: vi.fn(async () => ({ domain_files: availableFiles })),
  setMeetingDomainFiles: vi.fn(async (_id: number, ids: number[], excludedIds?: number[]) => ({
    selected: [...selectedFiles, ...availableFiles.filter((f) => ids.includes(f.id) && f.id !== 1)].map((f) => ({
      id: f.id, name: f.name, project_id: f.project_id, updated_at: '2026-01-01T00:00:00Z', editable: true,
    })).filter((f) => ids.includes(f.id)),
    inherited: excludedIds ? inheritedFiles.filter((f) => !excludedIds.includes(f.id)) : inheritedFiles,
    excluded: excludedIds
      ? inheritedFiles
          .filter((f) => excludedIds.includes(f.id))
          .map((f) => ({ id: f.id, name: f.name, project_id: f.project_id, updated_at: f.updated_at, editable: f.editable }))
      : excludedFiles,
  })),
  getFolderDomainFiles: vi.fn(async () => ({ domain_files: [], inherited: [] })),
  setFolderDomainFiles: vi.fn(async (_id: number, ids: number[]) => ({
    domain_files: availableFiles.filter((f) => ids.includes(f.id)).map((f) => ({
      id: f.id, name: f.name, project_id: f.project_id, updated_at: f.updated_at, editable: true,
    })),
  })),
  getProjectDomainFiles: vi.fn(async () => ({ domain_files: [] })),
  setProjectDomainFiles: vi.fn(async (_id: number, ids: number[]) => ({
    domain_files: availableFiles.filter((f) => ids.includes(f.id)).map((f) => ({
      id: f.id, name: f.name, project_id: f.project_id, updated_at: f.updated_at, editable: true,
    })),
  })),
  createDomainFile: vi.fn(async () => ({ domain_file: { id: 3, name: '새 파일', project_id: null, created_by_id: 1, content_chars: 0, updated_at: '', content: '' } })),
  uploadDomainFile: vi.fn(async () => ({ domain_file: { id: 4, name: 'upload.md', project_id: null, created_by_id: 1, content_chars: 0, updated_at: '', content: '' } })),
  updateDomainFile: vi.fn(async () => ({ domain_file: { id: 1, name: '공정 용어집', project_id: null, created_by_id: 1, content_chars: 10, updated_at: '', content: '- **A** [공정명]: 설명' } })),
  deleteDomainFile: vi.fn(async () => {}),
  mergeDomainTerms: vi.fn(async () => ({ domain_file: { id: 1, name: '공정 용어집', project_id: null, created_by_id: 1, content_chars: 10, updated_at: '', content: '' }, added: 1, replaced: 0 })),
  getDomainFile: vi.fn(async () => ({ domain_file: { id: 1, name: '공정 용어집', project_id: null, created_by_id: 1, content_chars: 10, updated_at: '', content: '- **A** [공정명]: 설명' } })),
  extractDomainTerms: vi.fn(async () => ({ terms: [{ term: 'A', category: '공정명', definition: '설명' }] })),
}))

describe('DomainFilesPanel — meeting', () => {
  beforeEach(() => vi.clearAllMocks())

  it('선택된 도메인 파일 칩을 표시한다', async () => {
    render(<DomainFilesPanel ownerType="meeting" ownerId={1} projectId={null} canEdit={true} />)
    await waitFor(() => expect(screen.getByText('공정 용어집')).toBeInTheDocument())
  })

  it('상속된(폴더/프로젝트) 도메인 파일을 읽기전용 뱃지로 표시한다', async () => {
    render(<DomainFilesPanel ownerType="meeting" ownerId={1} projectId={null} canEdit={true} />)
    await waitFor(() => expect(screen.getByText('전사 공통 용어집')).toBeInTheDocument())
    expect(screen.getByText('프로젝트: 반도체 프로젝트')).toBeInTheDocument()
  })

  it('canEdit=false면 편집 액션 버튼이 없다', async () => {
    render(<DomainFilesPanel ownerType="meeting" ownerId={1} projectId={null} canEdit={false} />)
    await waitFor(() => expect(screen.getByText('공정 용어집')).toBeInTheDocument())
    expect(screen.queryByText('파일 선택')).not.toBeInTheDocument()
    expect(screen.queryByText('새 파일 작성')).not.toBeInTheDocument()
    expect(screen.queryByText('요약에서 용어 추출')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('공정 용어집 삭제')).not.toBeInTheDocument()
  })

  it('파일 선택 모달에서 체크 변경 후 확인하면 setMeetingDomainFiles를 호출한다', async () => {
    const api = await import('../../api/domainFiles')
    render(<DomainFilesPanel ownerType="meeting" ownerId={1} projectId={null} canEdit={true} />)
    await waitFor(() => expect(screen.getByText('공정 용어집')).toBeInTheDocument())

    await userEvent.click(screen.getByText('파일 선택'))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '설비 용어집' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('checkbox', { name: '설비 용어집' }))
    await userEvent.click(screen.getByRole('button', { name: '확인' }))

    await waitFor(() => expect(api.setMeetingDomainFiles).toHaveBeenCalledWith(1, expect.arrayContaining([1, 2])))
  })

  it('editable인 선택 파일의 삭제 버튼을 누르면 확인 후 deleteDomainFile을 호출한다', async () => {
    const api = await import('../../api/domainFiles')
    render(<DomainFilesPanel ownerType="meeting" ownerId={1} projectId={null} canEdit={true} />)
    await waitFor(() => expect(screen.getByText('공정 용어집')).toBeInTheDocument())

    await userEvent.click(screen.getByLabelText('공정 용어집 삭제'))

    expect(confirmDialog).toHaveBeenCalled()
    await waitFor(() => expect(api.deleteDomainFile).toHaveBeenCalledWith(1))
  })

  it('요약에서 용어 추출 성공 시 ExtractTermsModal을 연다', async () => {
    render(<DomainFilesPanel ownerType="meeting" ownerId={1} projectId={null} canEdit={true} />)
    await waitFor(() => expect(screen.getByText('공정 용어집')).toBeInTheDocument())

    await userEvent.click(screen.getByText('요약에서 용어 추출'))
    await waitFor(() => expect(screen.getByText('추출된 도메인 용어')).toBeInTheDocument())
  })

  it('용어 추출 실패 시 에러 메시지를 표시한다', async () => {
    const api = await import('../../api/domainFiles')
    vi.mocked(api.extractDomainTerms).mockRejectedValueOnce(new Error('추출 실패했습니다'))
    render(<DomainFilesPanel ownerType="meeting" ownerId={1} projectId={null} canEdit={true} />)
    await waitFor(() => expect(screen.getByText('공정 용어집')).toBeInTheDocument())

    await userEvent.click(screen.getByText('요약에서 용어 추출'))
    await waitFor(() => expect(screen.getByText('추출 실패했습니다')).toBeInTheDocument())
  })

  // 증분 A: 파일 선택 모달에서 editable 파일 삭제
  it('선택 모달에서 editable 파일의 삭제 버튼을 누르면 확인 후 deleteDomainFile을 호출한다', async () => {
    const api = await import('../../api/domainFiles')
    render(<DomainFilesPanel ownerType="meeting" ownerId={1} projectId={null} canEdit={true} />)
    await waitFor(() => expect(screen.getByText('공정 용어집')).toBeInTheDocument())

    await userEvent.click(screen.getByText('파일 선택'))
    await waitFor(() => expect(screen.getByLabelText('설비 용어집 파일 삭제')).toBeInTheDocument())
    await userEvent.click(screen.getByLabelText('설비 용어집 파일 삭제'))

    expect(confirmDialog).toHaveBeenCalled()
    await waitFor(() => expect(api.deleteDomainFile).toHaveBeenCalledWith(2))
  })

  it('선택 모달에서 editable=false 파일에는 삭제 버튼이 없다', async () => {
    render(<DomainFilesPanel ownerType="meeting" ownerId={1} projectId={null} canEdit={true} />)
    await waitFor(() => expect(screen.getByText('공정 용어집')).toBeInTheDocument())

    await userEvent.click(screen.getByText('파일 선택'))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '전사 공통 용어집' })).toBeInTheDocument())
    expect(screen.queryByLabelText('전사 공통 용어집 파일 삭제')).not.toBeInTheDocument()
  })

  // 증분 C: 이미 상속(비제외) 적용된 파일은 선택 모달에서 체크 불가
  it('선택 모달에서 상속(비제외)된 파일은 체크박스가 비활성화되고 안내 라벨이 표시된다', async () => {
    render(<DomainFilesPanel ownerType="meeting" ownerId={1} projectId={null} canEdit={true} />)
    await waitFor(() => expect(screen.getByText('공정 용어집')).toBeInTheDocument())

    await userEvent.click(screen.getByText('파일 선택'))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '전사 공통 용어집' })).toBeInTheDocument())

    const checkbox = screen.getByRole('checkbox', { name: '전사 공통 용어집' }) as HTMLInputElement
    expect(checkbox).toBeDisabled()
    expect(checkbox.checked).toBe(true)
    expect(screen.getByText('프로젝트/폴더에서 이미 적용됨')).toBeInTheDocument()
  })

  // 증분 B: 회의별 상속 제외 / 복원
  it('상속 칩의 제외 액션을 누르면 excluded_domain_file_ids를 포함해 저장하고, 복원하면 다시 뺀다', async () => {
    const api = await import('../../api/domainFiles')
    render(<DomainFilesPanel ownerType="meeting" ownerId={1} projectId={null} canEdit={true} />)
    await waitFor(() => expect(screen.getByText('전사 공통 용어집')).toBeInTheDocument())

    await userEvent.click(screen.getByLabelText('전사 공통 용어집 이 회의에서 제외'))

    await waitFor(() => expect(api.setMeetingDomainFiles).toHaveBeenCalledWith(1, [1], [9]))
    await waitFor(() => expect(screen.getByText('제외됨')).toBeInTheDocument())
    expect(screen.queryByText('상속된 도메인 파일 (읽기전용)')).not.toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('전사 공통 용어집 복원'))

    await waitFor(() => expect(api.setMeetingDomainFiles).toHaveBeenCalledWith(1, [1], []))
    await waitFor(() => expect(screen.getByText('프로젝트: 반도체 프로젝트')).toBeInTheDocument())
    expect(screen.queryByText('제외됨')).not.toBeInTheDocument()
  })
})

describe('DomainFilesPanel — folder/project 재사용', () => {
  beforeEach(() => vi.clearAllMocks())

  it('folder owner에서는 요약에서 용어 추출 버튼과 상속 섹션이 없다', async () => {
    render(<DomainFilesPanel ownerType="folder" ownerId={7} projectId={5} canEdit={true} collapsible={false} />)
    await waitFor(() => expect(screen.getByText('파일 선택')).toBeInTheDocument())
    expect(screen.queryByText('요약에서 용어 추출')).not.toBeInTheDocument()
    expect(screen.queryByText('상속된 도메인 파일 (읽기전용)')).not.toBeInTheDocument()
  })

  it('folder owner에서 파일 선택 후 확인하면 setFolderDomainFiles를 호출한다', async () => {
    const api = await import('../../api/domainFiles')
    render(<DomainFilesPanel ownerType="folder" ownerId={7} projectId={5} canEdit={true} collapsible={false} />)
    await waitFor(() => expect(screen.getByText('파일 선택')).toBeInTheDocument())

    await userEvent.click(screen.getByText('파일 선택'))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '설비 용어집' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('checkbox', { name: '설비 용어집' }))
    await userEvent.click(screen.getByRole('button', { name: '확인' }))

    await waitFor(() => expect(api.setFolderDomainFiles).toHaveBeenCalledWith(7, [2]))
  })
})
