import { create } from 'zustand'
import {
  getProjects,
  createProject as apiCreate,
  updateProject as apiUpdate,
  deleteProject as apiDelete,
  toggleProjectFavorite as apiToggleFavorite,
} from '../api/projects'
import type { Project, ProjectInput } from '../api/projects'

const CURRENT_KEY = 'current_project_id'

interface ProjectState {
  projects: Project[]
  currentProjectId: number | null
  isLoading: boolean
  error: string | null

  fetchProjects: () => Promise<void>
  setCurrentProject: (id: number) => void
  createProject: (data: ProjectInput) => Promise<Project>
  updateProject: (id: number, data: Partial<ProjectInput>) => Promise<void>
  removeProject: (id: number) => Promise<void>
  toggleFavorite: (id: number, favorite: boolean) => Promise<void>
  reset: () => void
}

function storedCurrent(): number | null {
  const raw = localStorage.getItem(CURRENT_KEY)
  return raw ? Number(raw) : null
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  projects: [],
  currentProjectId: storedCurrent(),
  isLoading: false,
  error: null,

  fetchProjects: async () => {
    set({ isLoading: true, error: null })
    try {
      const projects = await getProjects()
      let current = get().currentProjectId
      if (!current || !projects.some((p) => p.id === current)) {
        // 멤버인(role≠null) 비개인 프로젝트(예: 「기본」) 우선 → 멤버 아무거나 → 그래도 없으면 첫 항목.
        const mine = projects.filter((p) => p.role != null)
        current = ((mine.find((p) => !p.personal) ?? mine[0]) ?? projects[0])?.id ?? null
        if (current) localStorage.setItem(CURRENT_KEY, String(current))
      }
      set({ projects, currentProjectId: current, isLoading: false })
    } catch {
      set({ error: '프로젝트를 불러오지 못했습니다.', isLoading: false })
    }
  },

  setCurrentProject: (id) => {
    localStorage.setItem(CURRENT_KEY, String(id))
    set({ currentProjectId: id })
  },

  createProject: async (data) => {
    const project = await apiCreate(data)
    await get().fetchProjects()
    get().setCurrentProject(project.id)
    return project
  },

  updateProject: async (id, data) => {
    await apiUpdate(id, data)
    await get().fetchProjects()
  },

  removeProject: async (id) => {
    await apiDelete(id)
    if (get().currentProjectId === id) localStorage.removeItem(CURRENT_KEY)
    await get().fetchProjects()
  },

  toggleFavorite: async (id, favorite) => {
    // 낙관적 갱신: projects 배열의 해당 항목만 즉시 바꾸고, API 실패 시 그 항목만 되돌린다.
    // 배열 전체 스냅샷으로 롤백하면 인플라이트 중 다른 프로젝트를 토글한 변경까지 덮어쓰므로
    // 항상 최신 state를 기준으로 id 하나만 patch한다.
    const prevFavorite = get().projects.find((p) => p.id === id)?.favorite
    set((state) => ({
      projects: state.projects.map((p) => (p.id === id ? { ...p, favorite } : p)),
    }))
    try {
      await apiToggleFavorite(id, favorite)
    } catch {
      set((state) => ({
        projects: state.projects.map((p) => (p.id === id ? { ...p, favorite: prevFavorite ?? p.favorite } : p)),
      }))
    }
  },

  reset: () =>
    set({ projects: [], currentProjectId: storedCurrent(), isLoading: false, error: null }),
}))
