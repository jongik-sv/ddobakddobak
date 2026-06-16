import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useProjectStore } from './projectStore'
import type { Project } from '../api/projects'

const { mockGetProjects } = vi.hoisted(() => ({ mockGetProjects: vi.fn() }))
vi.mock('../api/projects', () => ({
  getProjects: mockGetProjects,
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
}))

function makeProject(o: Partial<Project> = {}): Project {
  return {
    id: 1,
    name: 'P',
    description: null,
    icon_type: null,
    icon_value: null,
    color: null,
    personal: false,
    role: 'admin',
    member_count: 1,
    meeting_count: 0,
    ...o,
  }
}

describe('projectStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.getState().reset()
    localStorage.clear()
  })

  it('fetch 후 비개인(「기본」) 우선으로 currentProjectId 설정(저장값 없을 때)', async () => {
    mockGetProjects.mockResolvedValue([
      makeProject({ id: 3, personal: true }),
      makeProject({ id: 9, personal: false }),
    ])
    await useProjectStore.getState().fetchProjects()
    expect(useProjectStore.getState().currentProjectId).toBe(9)
  })

  it('비개인 프로젝트가 없으면 첫 번째 선택', async () => {
    mockGetProjects.mockResolvedValue([makeProject({ id: 3, personal: true })])
    await useProjectStore.getState().fetchProjects()
    expect(useProjectStore.getState().currentProjectId).toBe(3)
  })

  it('setCurrentProject는 localStorage에 저장', () => {
    useProjectStore.getState().setCurrentProject(7)
    expect(useProjectStore.getState().currentProjectId).toBe(7)
    expect(localStorage.getItem('current_project_id')).toBe('7')
  })
})
