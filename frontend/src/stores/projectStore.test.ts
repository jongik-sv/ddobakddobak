import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useProjectStore } from './projectStore'
import type { Project } from '../api/projects'

const { mockGetProjects, mockToggleProjectFavorite } = vi.hoisted(() => ({
  mockGetProjects: vi.fn(),
  mockToggleProjectFavorite: vi.fn(),
}))
vi.mock('../api/projects', () => ({
  getProjects: mockGetProjects,
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  toggleProjectFavorite: mockToggleProjectFavorite,
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
    owner: null,
    favorite: false,
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

  it('비멤버(role=null) 비개인 프로젝트보다 멤버인 비개인을 우선 선택', async () => {
    mockGetProjects.mockResolvedValue([
      makeProject({ id: 1, personal: false, role: null }),   // 레거시 더미(비멤버)
      makeProject({ id: 6, personal: false, role: 'admin' }), // 「기본」(멤버)
    ])
    await useProjectStore.getState().fetchProjects()
    expect(useProjectStore.getState().currentProjectId).toBe(6)
  })
})

describe('projectStore.toggleFavorite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.getState().reset()
  })

  it('낙관적으로 해당 프로젝트의 favorite를 즉시 갱신하고 API를 호출한다', async () => {
    mockToggleProjectFavorite.mockResolvedValue(true)
    useProjectStore.setState({ projects: [makeProject({ id: 5, favorite: false })] })

    await useProjectStore.getState().toggleFavorite(5, true)

    expect(mockToggleProjectFavorite).toHaveBeenCalledWith(5, true)
    expect(useProjectStore.getState().projects[0].favorite).toBe(true)
  })

  it('다른 프로젝트의 favorite는 건드리지 않는다', async () => {
    mockToggleProjectFavorite.mockResolvedValue(true)
    useProjectStore.setState({
      projects: [makeProject({ id: 5, favorite: false }), makeProject({ id: 6, favorite: false })],
    })

    await useProjectStore.getState().toggleFavorite(5, true)

    expect(useProjectStore.getState().projects.find((p) => p.id === 6)?.favorite).toBe(false)
  })

  it('API 실패 시 이전 projects 배열로 롤백한다', async () => {
    mockToggleProjectFavorite.mockRejectedValue(new Error('boom'))
    useProjectStore.setState({ projects: [makeProject({ id: 5, favorite: false })] })

    await useProjectStore.getState().toggleFavorite(5, true)

    expect(useProjectStore.getState().projects[0].favorite).toBe(false)
  })

  it('A 토글이 인플라이트 중 B를 토글하면, A 실패 롤백이 B의 변경을 덮어쓰지 않는다', async () => {
    useProjectStore.setState({
      projects: [makeProject({ id: 5, favorite: false }), makeProject({ id: 6, favorite: false })],
    })

    let rejectA!: (err: Error) => void
    mockToggleProjectFavorite.mockImplementationOnce(
      () => new Promise((_resolve, reject) => { rejectA = reject }),
    )
    const toggleA = useProjectStore.getState().toggleFavorite(5, true)
    // A가 아직 인플라이트인 상태에서 B를 토글(즉시 성공) — A 이전 스냅샷에는 B가 false로 남아 있음.
    mockToggleProjectFavorite.mockResolvedValueOnce(true)
    await useProjectStore.getState().toggleFavorite(6, true)

    rejectA(new Error('boom'))
    await toggleA // 내부에서 catch하므로 reject되지 않고 정상 resolve됨

    expect(useProjectStore.getState().projects.find((p) => p.id === 5)?.favorite).toBe(false) // A 롤백
    expect(useProjectStore.getState().projects.find((p) => p.id === 6)?.favorite).toBe(true) // B 변경 보존
  })
})
