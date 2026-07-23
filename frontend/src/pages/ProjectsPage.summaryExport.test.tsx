import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useProjectStore } from '../stores/projectStore'
import { useAuthStore } from '../stores/authStore'
import type { Project } from '../api/projects'
import ProjectsPage from './ProjectsPage'

// fetchProjects는 네트워크 → api 목. projectDisplayName/isHiddenClutterProject는 순수 함수라 실제 구현 사용.
const { mockGetProjects } = vi.hoisted(() => ({ mockGetProjects: vi.fn() }))
vi.mock('../api/projects', async () => {
  const actual = await vi.importActual<typeof import('../api/projects')>('../api/projects')
  return {
    ...actual,
    getProjects: mockGetProjects,
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
  }
})

const exportProjectSummaries = vi.fn()
vi.mock('../api/transfers', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/transfers')>()
  return {
    ...mod,
    exportProjectSummaries: (...a: unknown[]) => exportProjectSummaries(...a),
  }
})

function makeProject(o: Partial<Project> = {}): Project {
  return {
    id: 1, name: 'Proj1', description: null, icon_type: null, icon_value: null,
    color: null, personal: false, role: 'admin', member_count: 1, meeting_count: 0, owner: null, ...o,
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/projects']}>
      <ProjectsPage />
    </MemoryRouter>,
  )
}

describe('ProjectsPage 요약 내보내기', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.getState().reset()
    localStorage.clear()
    mockGetProjects.mockResolvedValue([makeProject()])
    useAuthStore.setState({ user: { id: 1, email: 'm@x.com', name: 'M', role: 'member' } } as never)
  })

  it('비admin 멤버 카드 메뉴에 요약 내보내기(zip) 항목이 보이고 클릭 시 API 호출', async () => {
    exportProjectSummaries.mockResolvedValue(undefined)
    renderPage()
    await screen.findByText('Proj1')
    fireEvent.click(screen.getByLabelText('프로젝트 메뉴'))

    expect(screen.queryByText('내보내기')).not.toBeInTheDocument()
    expect(screen.getByText('요약 내보내기(zip)')).toBeInTheDocument()

    fireEvent.click(screen.getByText('요약 내보내기(zip)'))
    await waitFor(() => expect(exportProjectSummaries).toHaveBeenCalledWith(1))
  })

  it('422 실패 시 "내보낼 요약이 없습니다" 표시', async () => {
    exportProjectSummaries.mockRejectedValue({ response: { status: 422 } })
    renderPage()
    await screen.findByText('Proj1')
    fireEvent.click(screen.getByLabelText('프로젝트 메뉴'))
    fireEvent.click(screen.getByText('요약 내보내기(zip)'))

    expect(await screen.findByText('내보낼 요약이 없습니다')).toBeInTheDocument()
  })
})
