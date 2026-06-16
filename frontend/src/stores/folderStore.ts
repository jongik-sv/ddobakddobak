import { create } from 'zustand'
import {
  getFolderTree,
  createFolder as apiCreateFolder,
  updateFolder as apiUpdateFolder,
  deleteFolder as apiDeleteFolder,
} from '../api/folders'
import type { FolderNode } from '../api/folders'

export type SelectedFolder = number | null | 'all'
// number = 특정 폴더, null = 미분류(폴더 없는 회의), 'all' = 전체

interface FolderState {
  folders: FolderNode[]
  selectedFolderId: SelectedFolder
  expandedFolderIds: Set<number>
  isLoading: boolean
  error: string | null

  fetchFolders: () => Promise<void>
  setSelectedFolder: (id: SelectedFolder) => void
  toggleExpanded: (id: number) => void
  createFolder: (name: string, parentId?: number | null) => Promise<void>
  renameFolder: (id: number, name: string) => Promise<void>
  setFolderShared: (id: number, shared: boolean) => Promise<void>
  setFolderImportant: (id: number, important: boolean) => Promise<void>
  moveFolder: (id: number, newParentId: number | null) => Promise<void>
  removeFolder: (id: number) => Promise<void>
  reset: () => void
}

export const useFolderStore = create<FolderState>()((set, get) => ({
  folders: [],
  selectedFolderId: 'all',
  expandedFolderIds: new Set<number>(),
  isLoading: false,
  error: null,

  fetchFolders: async () => {
    set({ isLoading: true, error: null })
    try {
      const folders = await getFolderTree()
      set({ folders, isLoading: false })
    } catch {
      set({ error: '폴더 목록을 불러오지 못했습니다.', isLoading: false })
    }
  },

  setSelectedFolder: (id) => set({ selectedFolderId: id }),

  toggleExpanded: (id) =>
    set((state) => {
      const next = new Set(state.expandedFolderIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { expandedFolderIds: next }
    }),

  createFolder: async (name, parentId) => {
    try {
      await apiCreateFolder({ name, parent_id: parentId })
      await get().fetchFolders()
    } catch {
      set({ error: '폴더 생성에 실패했습니다.' })
    }
  },

  renameFolder: async (id, name) => {
    try {
      await apiUpdateFolder(id, { name })
      await get().fetchFolders()
    } catch {
      set({ error: '폴더 이름 변경에 실패했습니다.' })
    }
  },

  setFolderShared: async (id, shared) => {
    try {
      await apiUpdateFolder(id, { shared })
      await get().fetchFolders()
    } catch {
      set({ error: '폴더 공유 설정 변경에 실패했습니다.' })
    }
  },

  setFolderImportant: async (id, important) => {
    // 낙관적 갱신: 트리에서 해당 폴더(중첩 포함)의 important만 즉시 바꾸고,
    // API 실패 시 fetchFolders로 서버 상태 복원.
    const patchTree = (nodes: FolderNode[]): FolderNode[] =>
      nodes.map((n) =>
        n.id === id
          ? { ...n, important }
          : { ...n, children: patchTree(n.children) },
      )
    set((state) => ({ folders: patchTree(state.folders) }))
    try {
      await apiUpdateFolder(id, { important })
    } catch {
      set({ error: '폴더 중요 설정 변경에 실패했습니다.' })
      await get().fetchFolders()
    }
  },

  moveFolder: async (id, newParentId) => {
    try {
      await apiUpdateFolder(id, { parent_id: newParentId })
      await get().fetchFolders()
    } catch {
      set({ error: '폴더 이동에 실패했습니다.' })
    }
  },

  removeFolder: async (id) => {
    try {
      await apiDeleteFolder(id)
      const { selectedFolderId } = get()
      if (selectedFolderId === id) set({ selectedFolderId: 'all' })
      await get().fetchFolders()
    } catch {
      set({ error: '폴더 삭제에 실패했습니다.' })
    }
  },

  reset: () =>
    set({
      folders: [],
      selectedFolderId: 'all',
      expandedFolderIds: new Set<number>(),
      isLoading: false,
      error: null,
    }),
}))
