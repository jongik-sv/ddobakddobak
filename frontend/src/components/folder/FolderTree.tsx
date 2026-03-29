import { useEffect, useState, useRef } from 'react'
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
  List,
  Inbox,
} from 'lucide-react'
import { useFolderStore } from '../../stores/folderStore'
import { useMeetingStore } from '../../stores/meetingStore'
import type { FolderNode } from '../../api/folders'
import type { SelectedFolder } from '../../stores/folderStore'
import CreateFolderDialog from './CreateFolderDialog'

interface FolderTreeItemProps {
  folder: FolderNode
  depth: number
  defaultTeamId: number | null
}

function FolderTreeItem({ folder, depth, defaultTeamId }: FolderTreeItemProps) {
  const { selectedFolderId, expandedFolderIds, setSelectedFolder, toggleExpanded, renameFolder, removeFolder, createFolder } =
    useFolderStore()
  const { setFolderId, fetchMeetings } = useMeetingStore()
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
    setSelectedFolder(folder.id)
    setFolderId(folder.id)
    fetchMeetings(1)
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
    if (!defaultTeamId) return
    await createFolder(name, defaultTeamId, folder.id)
    setShowSubfolderDialog(false)
    if (!isExpanded) toggleExpanded(folder.id)
  }

  return (
    <>
      <div
        className={`group flex items-center gap-1 px-2 py-1 rounded-md text-sm cursor-pointer transition-colors ${
          isSelected
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
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
        <div className="relative" ref={menuRef}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(!showMenu)
            }}
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-black/5 transition-opacity"
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
          <FolderTreeItem key={child.id} folder={child} depth={depth + 1} defaultTeamId={defaultTeamId} />
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

interface FolderTreeProps {
  defaultTeamId: number | null
}

export default function FolderTree({ defaultTeamId }: FolderTreeProps) {
  const { folders, selectedFolderId, setSelectedFolder, fetchFolders, createFolder } = useFolderStore()
  const { setFolderId, fetchMeetings } = useMeetingStore()
  const [showCreateDialog, setShowCreateDialog] = useState(false)

  useEffect(() => {
    fetchFolders()
  }, [fetchFolders])

  const handleSelect = (id: SelectedFolder) => {
    setSelectedFolder(id)
    setFolderId(id)
    fetchMeetings(1)
  }

  const handleCreate = async (name: string) => {
    if (!defaultTeamId) return
    await createFolder(name, defaultTeamId)
    setShowCreateDialog(false)
  }

  const itemClass = (active: boolean) =>
    `flex items-center gap-2 px-2 py-1 rounded-md text-sm cursor-pointer transition-colors ${
      active
        ? 'bg-primary/10 text-primary font-medium'
        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
    }`

  return (
    <div className="mt-1 space-y-0.5">
      <div className={itemClass(selectedFolderId === 'all')} onClick={() => handleSelect('all')}>
        <List className="w-4 h-4 shrink-0" />
        <span className="truncate">전체 회의</span>
      </div>
      <div className={itemClass(selectedFolderId === null)} onClick={() => handleSelect(null)}>
        <Inbox className="w-4 h-4 shrink-0" />
        <span className="truncate">미분류</span>
      </div>

      {folders.map((folder) => (
        <FolderTreeItem key={folder.id} folder={folder} depth={0} defaultTeamId={defaultTeamId} />
      ))}

      <button
        onClick={() => setShowCreateDialog(true)}
        disabled={!defaultTeamId}
        className="flex items-center gap-2 px-2 py-1 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors w-full disabled:opacity-50"
      >
        <Plus className="w-4 h-4" />
        <span>새 폴더</span>
      </button>

      {showCreateDialog && (
        <CreateFolderDialog onConfirm={handleCreate} onClose={() => setShowCreateDialog(false)} />
      )}
    </div>
  )
}
