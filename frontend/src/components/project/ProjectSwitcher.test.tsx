import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { useProjectStore } from '../../stores/projectStore'
import { useAuthStore } from '../../stores/authStore'
import type { Project } from '../../api/projects'
import ProjectSwitcher from './ProjectSwitcher'

// fetchProjects는 네트워크 → api 목. 각 테스트가 mockResolvedValue로 목록 주입.
const { mockGetProjects } = vi.hoisted(() => ({ mockGetProjects: vi.fn() }))
vi.mock('../../api/projects', async () => {
  const actual = await vi.importActual<typeof import('../../api/projects')>('../../api/projects')
  return {
    ...actual,
    getProjects: mockGetProjects,
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
  }
})
// 전환 시 폴더/회의 store는 네트워크 호출 → 목으로 차단.
vi.mock('../../stores/folderStore', () => ({
  useFolderStore: { getState: () => ({ setSelectedFolder: vi.fn(), fetchFolders: vi.fn() }) },
}))
vi.mock('../../stores/meetingStore', () => ({
  useMeetingStore: { getState: () => ({ setFolderId: vi.fn(), fetchMeetings: vi.fn() }) },
}))

function makeProject(o: Partial<Project> = {}): Project {
  return {
    id: 1, name: 'P', description: null, icon_type: null, icon_value: null,
    color: null, personal: false, role: 'admin', member_count: 1, meeting_count: 0, owner: null, favorite: false, ...o,
  }
}

function renderSwitcher() {
  return render(
    <MemoryRouter initialEntries={['/meetings']}>
      <Routes>
        <Route path="/meetings" element={<ProjectSwitcher />} />
        <Route path="/projects" element={<div>PROJECTS_SENTINEL</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProjectSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // reset()이 storedCurrent()로 localStorage를 읽으므로 clear가 먼저여야
    // 이전 테스트의 currentProjectId가 새지 않는다.
    localStorage.clear()
    useProjectStore.getState().reset()
    useAuthStore.setState({ user: { id: 1, email: 'a@x.com', name: 'A', role: 'admin' } } as never)
  })

  it('favorite인 프로젝트만 드롭다운에 표시한다', async () => {
    useProjectStore.getState().setCurrentProject(1)
    mockGetProjects.mockResolvedValue([
      makeProject({ id: 1, name: '즐겨찾기A', favorite: true }),
      makeProject({ id: 2, name: '일반B', favorite: false }),
      makeProject({ id: 3, name: '즐겨찾기C', favorite: true }),
    ])
    renderSwitcher()
    await screen.findAllByText('즐겨찾기A')
    fireEvent.click(screen.getByTitle('프로젝트 전환'))

    expect(screen.getByText('즐겨찾기C')).toBeInTheDocument()
    expect(screen.queryByText('일반B')).not.toBeInTheDocument()
  })

  it('favorite가 0개면 전체 목록으로 폴백한다', async () => {
    useProjectStore.getState().setCurrentProject(1)
    mockGetProjects.mockResolvedValue([
      makeProject({ id: 1, name: '일반A', favorite: false }),
      makeProject({ id: 2, name: '일반B', favorite: false }),
    ])
    renderSwitcher()
    await screen.findAllByText('일반A')
    fireEvent.click(screen.getByTitle('프로젝트 전환'))

    expect(screen.getByText('일반B')).toBeInTheDocument()
  })

  it('현재 선택 프로젝트가 favorite 목록에 없으면 맨 위에 추가된다', async () => {
    useProjectStore.getState().setCurrentProject(2)
    mockGetProjects.mockResolvedValue([
      makeProject({ id: 1, name: '즐겨찾기A', favorite: true }),
      makeProject({ id: 2, name: '현재선택', favorite: false }),
    ])
    renderSwitcher()
    await screen.findAllByText('현재선택')
    fireEvent.click(screen.getByTitle('프로젝트 전환'))

    const options = screen.getAllByRole('button').filter((b) => b.textContent?.includes('즐겨찾기A') || b.textContent?.includes('현재선택'))
    expect(options[0].textContent).toContain('현재선택')
    expect(screen.getByText('즐겨찾기A')).toBeInTheDocument()
  })

  it('"전체 프로젝트…" 클릭 시 /projects로 이동한다', async () => {
    useProjectStore.getState().setCurrentProject(1)
    mockGetProjects.mockResolvedValue([makeProject({ id: 1, name: '즐겨찾기A', favorite: true })])
    renderSwitcher()
    await screen.findAllByText('즐겨찾기A')
    fireEvent.click(screen.getByTitle('프로젝트 전환'))
    fireEvent.click(screen.getByText('전체 프로젝트…'))

    expect(screen.getByText('PROJECTS_SENTINEL')).toBeInTheDocument()
  })
})
