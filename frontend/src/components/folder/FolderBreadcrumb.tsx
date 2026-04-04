import { useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import { useFolderStore } from '../../stores/folderStore'
import { useMeetingStore } from '../../stores/meetingStore'
import type { FolderNode } from '../../api/folders'

function findFolder(folders: FolderNode[], id: number): FolderNode | null {
  for (const f of folders) {
    if (f.id === id) return f
    const found = findFolder(f.children, id)
    if (found) return found
  }
  return null
}

function buildPath(folders: FolderNode[], id: number): { id: number; name: string }[] {
  // 부모 경로를 재귀적으로 구성
  for (const f of folders) {
    if (f.id === id) return [{ id: f.id, name: f.name }]
    const childPath = buildPath(f.children, id)
    if (childPath.length > 0) {
      return [{ id: f.id, name: f.name }, ...childPath]
    }
  }
  return []
}

export default function FolderBreadcrumb() {
  const { folders, selectedFolderId, setSelectedFolder } = useFolderStore()
  const { setFolderId, fetchMeetings } = useMeetingStore()

  const path = useMemo(() => {
    if (selectedFolderId === 'all' || selectedFolderId === null) return []
    return buildPath(folders, selectedFolderId)
  }, [folders, selectedFolderId])

  const handleNavigate = (id: number | null | 'all') => {
    setSelectedFolder(id)
    setFolderId(id)
    fetchMeetings(1)
  }

  if (selectedFolderId === 'all') return null

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground mb-3">
      <button
        onClick={() => handleNavigate('all')}
        className="hover:text-foreground transition-colors min-h-[44px] inline-flex items-center"
      >
        전체 회의
      </button>
      {selectedFolderId === null && (
        <>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground font-medium">미분류</span>
        </>
      )}
      {path.map((segment, i) => (
        <span key={segment.id} className="flex items-center gap-1">
          <ChevronRight className="w-3 h-3" />
          {i === path.length - 1 ? (
            <span className="text-foreground font-medium">{segment.name}</span>
          ) : (
            <button
              onClick={() => handleNavigate(segment.id)}
              className="hover:text-foreground transition-colors min-h-[44px] inline-flex items-center"
            >
              {segment.name}
            </button>
          )}
        </span>
      ))}
    </nav>
  )
}
