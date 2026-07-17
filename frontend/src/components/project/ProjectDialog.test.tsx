import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import ProjectDialog from './ProjectDialog'
import type { Project } from '../../api/projects'

vi.mock('../../api/domainFiles', () => ({
  listDomainFiles: vi.fn(async () => ({ domain_files: [] })),
  getProjectDomainFiles: vi.fn(async () => ({ domain_files: [] })),
  setProjectDomainFiles: vi.fn(async () => ({ domain_files: [] })),
}))

vi.mock('../../stores/projectStore', () => ({
  useProjectStore: (selector: (s: { createProject: () => void; updateProject: () => void }) => unknown) =>
    selector({ createProject: vi.fn(), updateProject: vi.fn() }),
}))

const project: Project = {
  id: 10,
  name: '반도체 프로젝트',
  description: null,
  icon_type: null,
  icon_value: null,
  color: null,
  personal: false,
  role: 'admin',
  member_count: 3,
  meeting_count: 5,
  owner: null,
}

describe('ProjectDialog — 도메인 파일 섹션', () => {
  beforeEach(() => vi.clearAllMocks())

  it('기존 프로젝트 편집 시 도메인 파일 섹션을 표시한다', async () => {
    render(<ProjectDialog project={project} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('도메인 파일')).toBeInTheDocument())
    expect(screen.getByText('파일 선택')).toBeInTheDocument()
  })

  it('신규 프로젝트 생성 시에는 도메인 파일 섹션이 없다(아직 project id가 없음)', () => {
    render(<ProjectDialog onClose={vi.fn()} />)
    expect(screen.queryByText('도메인 파일')).not.toBeInTheDocument()
  })
})
