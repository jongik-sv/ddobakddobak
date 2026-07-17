import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

describe('ProjectsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.getState().reset()
    localStorage.clear()
    mockGetProjects.mockResolvedValue([])
  })

  it('시스템 member는 "새 프로젝트" 버튼 미노출', async () => {
    useAuthStore.setState({ user: { id: 1, email: 'm@x.com', name: 'M', role: 'member' } } as never)
    renderPage()
    await screen.findByText('프로젝트')
    expect(screen.queryByText('새 프로젝트')).not.toBeInTheDocument()
  })

  it('manager는 "새 프로젝트" 버튼 노출', async () => {
    useAuthStore.setState({ user: { id: 1, email: 'mg@x.com', name: 'Mg', role: 'manager' } } as never)
    renderPage()
    await screen.findByText('프로젝트')
    expect(screen.getByText('새 프로젝트')).toBeInTheDocument()
  })

  it('admin은 "새 프로젝트" 버튼 노출', async () => {
    useAuthStore.setState({ user: { id: 1, email: 'a@x.com', name: 'A', role: 'admin' } } as never)
    renderPage()
    await screen.findByText('프로젝트')
    expect(screen.getByText('새 프로젝트')).toBeInTheDocument()
  })

  it('시스템 member는 프로젝트 관리자여도 휴지통(삭제) 버튼 미노출', async () => {
    useAuthStore.setState({ user: { id: 1, email: 'm@x.com', name: 'M', role: 'member' } } as never)
    mockGetProjects.mockResolvedValue([makeProject({ role: 'admin' })])
    renderPage()
    await screen.findByText('Proj1')
    fireEvent.click(screen.getByLabelText('프로젝트 메뉴'))
    expect(screen.queryByText('휴지통')).not.toBeInTheDocument()
  })

  it('manager + 프로젝트 관리자면 휴지통(삭제) 버튼 노출', async () => {
    useAuthStore.setState({ user: { id: 1, email: 'mg@x.com', name: 'Mg', role: 'manager' } } as never)
    mockGetProjects.mockResolvedValue([makeProject({ role: 'admin' })])
    renderPage()
    await screen.findByText('Proj1')
    fireEvent.click(screen.getByLabelText('프로젝트 메뉴'))
    expect(screen.getByText('휴지통')).toBeInTheDocument()
  })
})
