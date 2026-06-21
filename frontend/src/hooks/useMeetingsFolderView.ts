import { useMemo, useCallback } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import { folderName } from '../lib/meetingFormat'
import { folderPath } from '../lib/folderNav'
import type { FolderNode } from '../api/folders'
import type { SelectedFolder } from '../stores/folderStore'

interface UseMeetingsFolderViewArgs {
  folders: FolderNode[]
  selectedFolderId: SelectedFolder
  navigate: NavigateFunction
}

/**
 * MeetingsPage의 폴더·네비게이션 파생 뷰 값(페이지 제목·하위 폴더 목록·폴더/회의 진입 핸들러)을
 * 한 군데로 모은 훅. 동작 변경 없이 MeetingsPage에서 그대로 옮겨온 것.
 */
export function useMeetingsFolderView({ folders, selectedFolderId, navigate }: UseMeetingsFolderViewArgs) {
  // 동적 페이지 제목
  const pageTitle = useMemo(() => {
    if (selectedFolderId === 'all') return '전체 회의'
    if (selectedFolderId === null) return '폴더'
    return folderName(folders, selectedFolderId) ?? '회의 목록'
  }, [folders, selectedFolderId])

  // 하위 폴더 목록: '전체'/'폴더(null)'면 루트 폴더, 특정 폴더면 하위 폴더
  const childFolders = useMemo(() => {
    if (selectedFolderId === null) return folders
    if (selectedFolderId === 'all') return folders
    const find = (nodes: FolderNode[]): FolderNode[] => {
      for (const f of nodes) {
        if (f.id === selectedFolderId) return f.children
        const found = find(f.children)
        if (found.length > 0) return found
      }
      return []
    }
    return find(folders)
  }, [folders, selectedFolderId])

  // 폴더 카드 진입도 URL(?folder=) push — 뒤로가기 동작·단일 소스 유지
  const handleFolderSelect = useCallback((id: number) => {
    navigate(folderPath(id))
  }, [navigate])

  const handleMeetingOpen = useCallback((id: number) => {
    navigate(`/meetings/${id}`)
  }, [navigate])

  return { pageTitle, childFolders, handleFolderSelect, handleMeetingOpen }
}
