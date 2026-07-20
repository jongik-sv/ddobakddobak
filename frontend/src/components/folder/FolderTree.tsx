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
  FolderInput,
  Globe,
  Lock,
  SpellCheck,
  FileText,
  Star,
  PackageOpen,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useFolderStore } from '../../stores/folderStore'
import { useMeetingStore } from '../../stores/meetingStore'

import type { FolderNode } from '../../api/folders'
import type { SelectedFolder } from '../../stores/folderStore'
import CreateFolderDialog from './CreateFolderDialog'
import GlossaryDialog from './GlossaryDialog'
import DomainFilesDialog from './DomainFilesDialog'
import ExportFolderDialog from './ExportFolderDialog'
import MoveToProjectModal from '../project/MoveToProjectModal'
import { useProjectStore } from '../../stores/projectStore'
import { initDrag } from '../../utils/dragState'
import { confirmDialog } from '../../lib/confirmDialog'
import { folderPath } from '../../lib/folderNav'

function countAllFolders(nodes: FolderNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countAllFolders(n.children), 0)
}

interface FolderTreeItemProps {
  folder: FolderNode
  depth: number
  onSelectFolder: (id: SelectedFolder) => void
}

function FolderTreeItem({ folder, depth, onSelectFolder }: FolderTreeItemProps) {
  const selectedFolderId = useFolderStore((s) => s.selectedFolderId)
  const expandedFolderIds = useFolderStore((s) => s.expandedFolderIds)
  const toggleExpanded = useFolderStore((s) => s.toggleExpanded)
  const renameFolder = useFolderStore((s) => s.renameFolder)
  const removeFolder = useFolderStore((s) => s.removeFolder)
  const setFolderShared = useFolderStore((s) => s.setFolderShared)
  const setFolderImportant = useFolderStore((s) => s.setFolderImportant)
  const createFolder = useFolderStore((s) => s.createFolder)
  const [showMenu, setShowMenu] = useState(false)
  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [showSubfolderDialog, setShowSubfolderDialog] = useState(false)
  const [showGlossaryDialog, setShowGlossaryDialog] = useState(false)
  const [showDomainFilesDialog, setShowDomainFilesDialog] = useState(false)
  const [showMoveProject, setShowMoveProject] = useState(false)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const currentProjectId = useProjectStore((s) => s.currentProjectId)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null)

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
    const onDismiss = () => setShowMenu(false)
    const onScroll = (e: Event) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return
      setShowMenu(false)
    }
    document.addEventListener('mousedown', handler)
    window.addEventListener('resize', onDismiss)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', handler)
      window.removeEventListener('resize', onDismiss)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [showMenu])

  const handleSelect = () => {
    onSelectFolder(folder.id)
    if (hasChildren) {
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
    if (!(await confirmDialog(`'${folder.name}' 폴더를 휴지통으로 이동합니다. 폴더 안의 회의·하위폴더도 함께 이동합니다. 계속할까요?`, { title: '휴지통으로 이동', kind: 'warning' }))) return
    await removeFolder(folder.id)
  }

  const handleCreateSubfolder = async (name: string) => {
    await createFolder(name, folder.id)
    setShowSubfolderDialog(false)
    if (!isExpanded) toggleExpanded(folder.id)
  }

  const handleToggleShared = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    await setFolderShared(folder.id, !folder.shared)
  }

  const handleToggleImportant = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    await setFolderImportant(folder.id, !folder.important)
  }

  return (
    <>
      <div
        data-drop-folder-id={folder.id}
        onPointerDown={(e) => initDrag('folder', folder.id, e)}
        className={`group flex items-center gap-1 px-2 py-2 min-h-[44px] rounded-md text-sm transition-colors ${
          isSelected
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
        {folder.important && (
          <Star className="w-3 h-3 shrink-0 text-amber-500 fill-amber-500" aria-label="중요 폴더" />
        )}
        {!folder.shared && (
          <Lock className="w-3 h-3 shrink-0 text-muted-foreground" aria-label="비공개 폴더" />
        )}
        <span className="text-xs text-muted-foreground tabular-nums hover-hide-parent ml-auto">
          {folder.meeting_count}
        </span>
        <div className="relative hidden hover-show-block-parent ml-auto" ref={menuRef}>
          <button
            ref={triggerRef}
            onClick={(e) => {
              e.stopPropagation()
              if (!showMenu && triggerRef.current) {
                const rect = triggerRef.current.getBoundingClientRect()
                const MENU_H = 410
                const right = Math.max(8, window.innerWidth - rect.right)
                setPos(
                  rect.bottom + MENU_H > window.innerHeight
                    ? { bottom: window.innerHeight - rect.top + 4, right }
                    : { top: rect.bottom + 4, right },
                )
              }
              setShowMenu(!showMenu)
            }}
            className="p-2 rounded hover:bg-black/5"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
          {showMenu && pos && (
            <div
              style={pos.top != null ? { top: pos.top, right: pos.right } : { bottom: pos.bottom, right: pos.right }}
              className="fixed z-50 w-40 max-h-[80vh] overflow-y-auto rounded-md border bg-card shadow-lg py-1"
            >
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMenu(false)
                  setShowRenameDialog(true)
                }}
                className="flex items-center gap-2 w-full px-3 py-2.5 min-h-[44px] text-sm hover:bg-muted transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" /> 이름 변경
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMenu(false)
                  setShowSubfolderDialog(true)
                }}
                className="flex items-center gap-2 w-full px-3 py-2.5 min-h-[44px] text-sm hover:bg-muted transition-colors"
              >
                <FolderPlus className="w-3.5 h-3.5" /> 하위 폴더
              </button>
              <button
                onClick={handleToggleShared}
                className="flex items-center gap-2 w-full px-3 py-2.5 min-h-[44px] text-sm hover:bg-muted transition-colors"
              >
                {folder.shared ? (
                  <><Lock className="w-3.5 h-3.5" /> 비공개로 전환</>
                ) : (
                  <><Globe className="w-3.5 h-3.5" /> 모든 사용자에게 공유</>
                )}
              </button>
              <button
                onClick={handleToggleImportant}
                className="flex items-center gap-2 w-full px-3 py-2.5 min-h-[44px] text-sm hover:bg-muted transition-colors"
              >
                {folder.important ? (
                  <><Star className="w-3.5 h-3.5" /> 중요 해제</>
                ) : (
                  <><Star className="w-3.5 h-3.5 text-amber-500" /> 중요 표시</>
                )}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMenu(false)
                  setShowGlossaryDialog(true)
                }}
                className="flex items-center gap-2 w-full px-3 py-2.5 min-h-[44px] text-sm hover:bg-muted transition-colors"
              >
                <SpellCheck className="w-3.5 h-3.5" /> 오타 사전
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMenu(false)
                  setShowDomainFilesDialog(true)
                }}
                className="flex items-center gap-2 w-full px-3 py-2.5 min-h-[44px] text-sm hover:bg-muted transition-colors"
              >
                <FileText className="w-3.5 h-3.5" /> 도메인 파일
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMenu(false)
                  setShowMoveProject(true)
                }}
                className="flex items-center gap-2 w-full px-3 py-2.5 min-h-[44px] text-sm hover:bg-muted transition-colors"
              >
                <FolderInput className="w-3.5 h-3.5" /> 프로젝트 이동
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMenu(false)
                  setShowExportDialog(true)
                }}
                className="flex items-center gap-2 w-full px-3 py-2.5 min-h-[44px] text-sm hover:bg-muted transition-colors"
              >
                <PackageOpen className="w-3.5 h-3.5" /> 내보내기(.tgz)
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete()
                }}
                className="flex items-center gap-2 w-full px-3 py-2.5 min-h-[44px] text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> 휴지통
              </button>
            </div>
          )}
        </div>
      </div>

      {isExpanded &&
        folder.children.map((child) => (
          <FolderTreeItem key={child.id} folder={child} depth={depth + 1} onSelectFolder={onSelectFolder} />
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
      {showGlossaryDialog && (
        <GlossaryDialog folderId={folder.id} folderName={folder.name} onClose={() => setShowGlossaryDialog(false)} />
      )}
      {showDomainFilesDialog && (
        <DomainFilesDialog
          folderId={folder.id}
          folderName={folder.name}
          projectId={currentProjectId}
          onClose={() => setShowDomainFilesDialog(false)}
        />
      )}
      {showExportDialog && (
        <ExportFolderDialog folderId={folder.id} folderName={folder.name} onClose={() => setShowExportDialog(false)} />
      )}
      {showMoveProject && currentProjectId != null && (
        <MoveToProjectModal
          mode="folder"
          folderId={folder.id}
          sourceProjectId={currentProjectId}
          title={folder.name}
          onClose={() => setShowMoveProject(false)}
          onMoved={() => {
            useFolderStore.getState().fetchFolders()
            useMeetingStore.getState().fetchMeetings()
          }}
        />
      )}
    </>
  )
}

export default function FolderTree() {
  const folders = useFolderStore((s) => s.folders)
  const selectedFolderId = useFolderStore((s) => s.selectedFolderId)
  const fetchFolders = useFolderStore((s) => s.fetchFolders)
  const createFolder = useFolderStore((s) => s.createFolder)
  const navigate = useNavigate()
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [rootExpanded, setRootExpanded] = useState(true)

  useEffect(() => {
    fetchFolders()
  }, [fetchFolders])

  // 폴더 선택은 URL(?folder=)로 push → 뒤로가기가 부모 폴더로 동작. 상태 반영·fetch는 MeetingsPage가 담당.
  const handleSelectFolder = useCallback((id: SelectedFolder) => {
    navigate(folderPath(id))
  }, [navigate])

  const handleSelectRoot = () => {
    handleSelectFolder(null)
    setRootExpanded((v) => !v)
  }

  const handleCreate = async (name: string) => {
    await createFolder(name)
    setShowCreateDialog(false)
  }

  const totalFolders = countAllFolders(folders)

  const itemClass = (active: boolean) =>
    `flex items-center gap-2 px-2 py-2 min-h-[44px] rounded-md text-sm transition-colors ${
      active
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
        <span className="text-xs text-muted-foreground tabular-nums hover-hide-parent ml-auto">{totalFolders}</span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            setShowCreateDialog(true)
          }}
          className="hidden hover-show-block-parent p-2 rounded hover:bg-black/5 text-muted-foreground hover:text-accent-foreground transition-colors ml-auto"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 폴더 트리 — 최상위 폴더 펼침 시 표시 */}
      {rootExpanded &&
        folders.map((folder) => (
          <FolderTreeItem key={folder.id} folder={folder} depth={1} onSelectFolder={handleSelectFolder} />
        ))}

      {showCreateDialog && (
        <CreateFolderDialog onConfirm={handleCreate} onClose={() => setShowCreateDialog(false)} />
      )}
    </div>
  )
}
