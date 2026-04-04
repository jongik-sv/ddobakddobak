import { useState, useMemo } from 'react'
import { FolderClosed, ChevronRight, ChevronDown, Inbox } from 'lucide-react'
import { useFolderStore } from '../../stores/folderStore'
import type { FolderNode } from '../../api/folders'

interface MoveMeetingDialogProps {
  meetingTitle: string
  currentFolderId: number | null
  onConfirm: (folderId: number | null) => void
  onClose: () => void
}

function FolderOption({
  folder,
  depth,
  selected,
  onSelect,
}: {
  folder: FolderNode
  depth: number
  selected: number | null
  onSelect: (id: number | null) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = folder.children.length > 0

  return (
    <>
      <div
        onClick={() => onSelect(folder.id)}
        className={`flex items-center gap-1.5 px-2 py-1.5 min-h-[44px] rounded-md text-sm cursor-pointer transition-colors ${
          selected === folder.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'
        }`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(!expanded)
            }}
            className="shrink-0"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        ) : (
          <span className="w-3" />
        )}
        <FolderClosed className="w-4 h-4 shrink-0" />
        <span className="truncate">{folder.name}</span>
      </div>
      {expanded &&
        folder.children.map((child) => (
          <FolderOption key={child.id} folder={child} depth={depth + 1} selected={selected} onSelect={onSelect} />
        ))}
    </>
  )
}

export default function MoveMeetingDialog({ meetingTitle, currentFolderId, onConfirm, onClose }: MoveMeetingDialogProps) {
  const { folders } = useFolderStore()
  const [selected, setSelected] = useState<number | null>(currentFolderId)

  const isChanged = useMemo(() => selected !== currentFolderId, [selected, currentFolderId])

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl border border-gray-100">
        <h2 className="text-lg font-semibold mb-1">폴더로 이동</h2>
        <p className="text-sm text-muted-foreground mb-4 truncate">{meetingTitle}</p>

        <div className="max-h-60 overflow-y-auto border rounded-md p-2 space-y-0.5 mb-4">
          <div
            onClick={() => setSelected(null)}
            className={`flex items-center gap-1.5 px-2 py-1.5 min-h-[44px] rounded-md text-sm cursor-pointer transition-colors ${
              selected === null ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'
            }`}
          >
            <span className="w-3" />
            <Inbox className="w-4 h-4 shrink-0" />
            <span>미분류</span>
          </div>
          {folders.map((folder) => (
            <FolderOption key={folder.id} folder={folder} depth={0} selected={selected} onSelect={setSelected} />
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            취소
          </button>
          <button
            onClick={() => onConfirm(selected)}
            disabled={!isChanged}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            이동
          </button>
        </div>
      </div>
    </div>
  )
}
