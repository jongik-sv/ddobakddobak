import { useEffect, useState, useRef, useCallback } from 'react'
import {
  FolderOpen,
  FolderClosed,
  ChevronRight,
  ChevronDown,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  FolderPlus,
} from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useFolderStore } from '../../stores/folderStore'
import { useMeetingStore } from '../../stores/meetingStore'
import { useUiStore } from '../../stores/uiStore'
import type { FolderNode } from '../../api/folders'
import type { SelectedFolder } from '../../stores/folderStore'
import CreateFolderDialog from './CreateFolderDialog'
import { initDrag } from '../../utils/dragState'

function countAllFolders(nodes: FolderNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countAllFolders(n.children), 0)
}

interface FolderTreeItemProps {
  folder: FolderNode
  depth: number
  isRecordingActive: boolean
  onSelectFolder: (id: SelectedFolder) => void
}

function FolderTreeItem({ folder, depth, isRecordingActive, onSelectFolder }: FolderTreeItemProps) {
  const selectedFolderId = useFolderStore((s) => s.selectedFolderId)
  const expandedFolderIds = useFolderStore((s) => s.expandedFolderIds)
  const toggleExpanded = useFolderStore((s) => s.toggleExpanded)
  const renameFolder = useFolderStore((s) => s.renameFolder)
  const removeFolder = useFolderStore((s) => s.removeFolder)
  const createFolder = useFolderStore((s) => s.createFolder)
  const [showMenu, setShowMenu] = useState(false)
  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [showSubfolderDialog, setShowSubfolderDialog] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const isExpanded = expandedFolderIds.has(folder.id)
  const isSelected = selectedFolderId === folder.id
  const hasChildren = folder.children.length > 0

  useEffect(() => {
    if (!showMenu) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMenu])

  const handleSelect = () => {
    if (isRecordingActive) return
    onSelectFolder(folder.id)
    if (hasChildren && !isExpanded) {
      toggleExpanded(folder.id)
    }
  }

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    toggleExpanded(folder.id)
  }

  const handleRename = async (name: string) => {
    await renameFolder(folder.id, name)
    setShowRenameDialog(false)
  }

  const handleDelete = async () => {
    setShowMenu(false)
    await removeFolder(folder.id)
  }

  const handleCreateSubfolder = async (name: string) => {
    await createFolder(name, folder.id)
    setShowSubfolderDialog(false)
    if (!isExpanded) toggleExpanded(folder.id)
  }

  return (
    <>
      <div
        data-drop-folder-id={folder.id}
        onPointerDown={(e) => initDrag('folder', folder.id, folder.name, e)}
        className={`group flex items-center gap-1 px-2 py-1 rounded-md text-sm transition-colors ${
          isRecordingActive
            ? 'opacity-50 cursor-not-allowed'
            : isSelected
              ? 'bg-primary/10 text-primary font-medium cursor-pointer'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleSelect}
      >
        {hasChildren ? (
          <button onClick={handleToggle} className="shrink-0 p-0.5 hover:bg-black/5 rounded">
            {isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>
        ) : (
          <span className="w-4" />
        )}
        {isExpanded && hasChildren ? (
          <FolderOpen className="w-4 h-4 shrink-0" />
        ) : (
          <FolderClosed className="w-4 h-4 shrink-0" />
        )}
        <span className="truncate flex-1">{folder.name}</span>
        <span className="text-xs text-muted-foreground tabular-nums group-hover:hidden ml-auto">
          {folder.meeting_count}
        </span>
        <div className="relative hidden group-hover:block ml-auto" ref={menuRef}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(!showMenu)
            }}
            className="p-0.5 rounded hover:bg-black/5"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-6 z-50 w-40 rounded-md border bg-white shadow-lg py-1">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMenu(false)
                  setShowRenameDialog(true)
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-muted transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" /> 이름 변경
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMenu(false)
                  setShowSubfolderDialog(true)
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-muted transition-colors"
              >
                <FolderPlus className="w-3.5 h-3.5" /> 하위 폴더
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete()
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> 삭제
              </button>
            </div>
          )}
        </div>
      </div>

      {isExpanded &&
        folder.children.map((child) => (
          <FolderTreeItem key={child.id} folder={child} depth={depth + 1} isRecordingActive={isRecordingActive} onSelectFolder={onSelectFolder} />
        ))}

      {showRenameDialog && (
        <CreateFolderDialog
          title="폴더 이름 변경"
          initialName={folder.name}
          onConfirm={handleRename}
          onClose={() => setShowRenameDialog(false)}
        />
      )}
      {showSubfolderDialog && (
        <CreateFolderDialog
          title="하위 폴더 만들기"
          onConfirm={handleCreateSubfolder}
          onClose={() => setShowSubfolderDialog(false)}
        />
      )}
    </>
  )
}

export default function FolderTree() {
  const folders = useFolderStore((s) => s.folders)
  const selectedFolderId = useFolderStore((s) => s.selectedFolderId)
  const setSelectedFolder = useFolderStore((s) => s.setSelectedFolder)
  const fetchFolders = useFolderStore((s) => s.fetchFolders)
  const createFolder = useFolderStore((s) => s.createFolder)
  const setFolderId = useMeetingStore((s) => s.setFolderId)
  const fetchMeetings = useMeetingStore((s) => s.fetchMeetings)
  const isRecordingActive = useUiStore((s) => s.isRecordingActive)
  const navigate = useNavigate()
  const location = useLocation()
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [rootExpanded, setRootExpanded] = useState(true)

  useEffect(() => {
    fetchFolders()
  }, [fetchFolders])

  const handleSelectFolder = useCallback((id: SelectedFolder) => {
    if (isRecordingActive) return
    setSelectedFolder(id)
    setFolderId(id)
    fetchMeetings(1)
    if (location.pathname !== '/meetings') {
      navigate('/meetings')
    }
  }, [isRecordingActive, setSelectedFolder, setFolderId, fetchMeetings, location.pathname, navigate])

  const handleSelectRoot = () => {
    if (isRecordingActive) return
    handleSelectFolder(null)
    if (!rootExpanded) setRootExpanded(true)
  }

  const handleCreate = async (name: string) => {
    await createFolder(name)
    setShowCreateDialog(false)
  }

  const totalFolders = countAllFolders(folders)

  const itemClass = (active: boolean) =>
    `flex items-center gap-2 px-2 py-1 rounded-md text-sm transition-colors ${
      isRecordingActive
        ? 'opacity-50 cursor-not-allowed'
        : active
          ? 'bg-primary/10 text-primary font-medium cursor-pointer'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer'
    }`

  return (
    <div className="mt-1 space-y-0.5">
      {/* 최상위 폴더 — 선택 시 미분류 회의 표시, 펼침/접힘으로 하위 폴더 표시 */}
      <div
        data-drop-folder-id="root"
        className={`${itemClass(selectedFolderId === null)} group`}
        onClick={handleSelectRoot}
      >
        <button
          onClick={(e) => {
            e.stopPropagation()
            setRootExpanded(!rootExpanded)
          }}
          className="shrink-0 p-0.5 hover:bg-black/5 rounded"
        >
          {rootExpanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </button>
        {rootExpanded ? (
          <FolderOpen className="w-4 h-4 shrink-0" />
        ) : (
          <FolderClosed className="w-4 h-4 shrink-0" />
        )}
        <span className="truncate flex-1">폴더</span>
        <span className="text-xs text-muted-foreground tabular-nums group-hover:hidden ml-auto">{totalFolders}</span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            setShowCreateDialog(true)
          }}
          className="hidden group-hover:block p-0.5 rounded hover:bg-black/5 text-muted-foreground hover:text-accent-foreground transition-colors ml-auto"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 폴더 트리 — 최상위 폴더 펼침 시 표시 */}
      {rootExpanded &&
        folders.map((folder) => (
          <FolderTreeItem key={folder.id} folder={folder} depth={1} isRecordingActive={isRecordingActive} onSelectFolder={handleSelectFolder} />
        ))}

      {showCreateDialog && (
        <CreateFolderDialog onConfirm={handleCreate} onClose={() => setShowCreateDialog(false)} />
      )}
    </div>
  )
}
