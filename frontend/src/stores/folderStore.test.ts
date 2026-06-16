import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useFolderStore } from './folderStore'
import type { FolderNode } from '../api/folders'

const { mockUpdateFolder, mockGetFolderTree } = vi.hoisted(() => ({
  mockUpdateFolder: vi.fn(),
  mockGetFolderTree: vi.fn(),
}))

vi.mock('../api/folders', () => ({
  getFolderTree: mockGetFolderTree,
  createFolder: vi.fn(),
  updateFolder: mockUpdateFolder,
  deleteFolder: vi.fn(),
}))

vi.mock('./projectStore', () => ({
  useProjectStore: { getState: () => ({ currentProjectId: 1 }) },
}))

function makeFolder(overrides: Partial<FolderNode> = {}): FolderNode {
  return {
    id: 1,
    name: '폴더',
    parent_id: null,
    position: 0,
    shared: true,
    important: false,
    meeting_count: 0,
    tags: [],
    children: [],
    ...overrides,
  }
}

describe('folderStore.setFolderImportant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useFolderStore.getState().reset()
  })

  it('낙관적으로 트리의 important를 즉시 갱신하고 updateFolder를 호출한다', async () => {
    mockUpdateFolder.mockResolvedValue(makeFolder({ important: true }))
    useFolderStore.setState({ folders: [makeFolder({ id: 5, important: false })] })

    await useFolderStore.getState().setFolderImportant(5, true)

    expect(mockUpdateFolder).toHaveBeenCalledWith(5, { important: true })
    expect(useFolderStore.getState().folders[0].important).toBe(true)
  })

  it('중첩된 하위 폴더의 important도 갱신한다', async () => {
    mockUpdateFolder.mockResolvedValue(makeFolder())
    useFolderStore.setState({
      folders: [makeFolder({ id: 1, children: [makeFolder({ id: 2, important: false })] })],
    })

    await useFolderStore.getState().setFolderImportant(2, true)

    expect(useFolderStore.getState().folders[0].children[0].important).toBe(true)
  })

  it('API 실패 시 fetchFolders로 서버 상태를 복원한다 (낙관적 갱신 롤백)', async () => {
    mockUpdateFolder.mockRejectedValue(new Error('boom'))
    // 서버는 여전히 important=false → fetchFolders로 낙관적 true가 롤백돼야 한다.
    mockGetFolderTree.mockResolvedValue([makeFolder({ id: 5, important: false })])
    useFolderStore.setState({ folders: [makeFolder({ id: 5, important: false })] })

    await useFolderStore.getState().setFolderImportant(5, true)

    expect(mockGetFolderTree).toHaveBeenCalled()
    // 서버 값으로 복원 — 낙관적 true가 false로 되돌아온다.
    expect(useFolderStore.getState().folders[0].important).toBe(false)
  })
})
