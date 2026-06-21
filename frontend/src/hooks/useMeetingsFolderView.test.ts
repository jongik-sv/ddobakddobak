import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { NavigateFunction } from 'react-router-dom'
import { useMeetingsFolderView } from './useMeetingsFolderView'
import { folderPath } from '../lib/folderNav'
import type { FolderNode } from '../api/folders'
import type { SelectedFolder } from '../stores/folderStore'

// --- fixture helpers ---

function makeFolder(id: number, name: string, children: FolderNode[] = []): FolderNode {
  return {
    id,
    name,
    parent_id: null,
    position: 0,
    shared: true,
    important: false,
    meeting_count: 0,
    tags: [],
    children,
  }
}

// 2-level tree:
//   1 "기획"   children: [11 "1분기", 12 "2분기"]
//   2 "개발"   children: []  (자식 없는 폴더)
const grandchild = makeFolder(111, '1월')
const child11 = makeFolder(11, '1분기', [grandchild])
const child12 = makeFolder(12, '2분기')
const planning = makeFolder(1, '기획', [child11, child12])
const dev = makeFolder(2, '개발')
const folders: FolderNode[] = [planning, dev]

function setup(selectedFolderId: SelectedFolder, navigate: NavigateFunction = vi.fn()) {
  return renderHook(() => useMeetingsFolderView({ folders, selectedFolderId, navigate }))
}

// --- tests ---

describe('useMeetingsFolderView', () => {
  describe('pageTitle', () => {
    it("'all'이면 '전체 회의'", () => {
      const { result } = setup('all')
      expect(result.current.pageTitle).toBe('전체 회의')
    })

    it("null이면 '폴더'", () => {
      const { result } = setup(null)
      expect(result.current.pageTitle).toBe('폴더')
    })

    it('실제 폴더 id면 해당 폴더 이름', () => {
      const { result } = setup(1)
      expect(result.current.pageTitle).toBe('기획')
    })

    it('중첩 폴더 id도 트리 전체에서 이름을 찾는다', () => {
      const { result } = setup(11)
      expect(result.current.pageTitle).toBe('1분기')
    })

    it("존재하지 않는 id면 '회의 목록'", () => {
      const { result } = setup(99999)
      expect(result.current.pageTitle).toBe('회의 목록')
    })
  })

  describe('childFolders', () => {
    it("null이면 루트 폴더 전체", () => {
      const { result } = setup(null)
      expect(result.current.childFolders).toBe(folders)
    })

    it("'all'이면 루트 폴더 전체", () => {
      const { result } = setup('all')
      expect(result.current.childFolders).toBe(folders)
    })

    it('자식이 있는 중첩 폴더 id면 그 폴더의 children', () => {
      const { result } = setup(1)
      expect(result.current.childFolders).toEqual([child11, child12])
    })

    it('2단계 깊이의 폴더 id도 재귀로 찾아 children 반환', () => {
      const { result } = setup(11)
      expect(result.current.childFolders).toEqual([grandchild])
    })

    it('존재하지 않는 id면 빈 배열', () => {
      const { result } = setup(99999)
      expect(result.current.childFolders).toEqual([])
    })
  })

  describe('handleFolderSelect', () => {
    it('navigate를 folderPath(id)로 호출한다', () => {
      const navigate = vi.fn()
      const { result } = setup('all', navigate)
      result.current.handleFolderSelect(12)
      expect(navigate).toHaveBeenCalledTimes(1)
      expect(navigate).toHaveBeenCalledWith(folderPath(12))
    })
  })

  describe('handleMeetingOpen', () => {
    it('navigate를 /meetings/:id로 호출한다', () => {
      const navigate = vi.fn()
      const { result } = setup('all', navigate)
      result.current.handleMeetingOpen(42)
      expect(navigate).toHaveBeenCalledTimes(1)
      expect(navigate).toHaveBeenCalledWith('/meetings/42')
    })
  })
})
