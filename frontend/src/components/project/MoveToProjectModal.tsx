import { useState } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useAuthStore } from '../../stores/authStore'
import { projectDisplayName, isHiddenClutterProject } from '../../api/projects'
import { moveMeetingsToProject } from '../../api/meetings'
import { moveFolderToProject } from '../../api/folders'
import ProjectIcon from './ProjectIcon'

interface Props {
  mode: 'meetings' | 'folder'
  meetingIds?: number[]
  folderId?: number
  sourceProjectId: number
  title: string
  onClose: () => void
  onMoved: () => void
}

export default function MoveToProjectModal({ mode, meetingIds, folderId, sourceProjectId, title, onClose, onMoved }: Props) {
  const projects = useProjectStore((s) => s.projects)
  const isSystemAdmin = useAuthStore((s) => s.user?.role === 'admin')
  const [targetId, setTargetId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // 후보 = 원본·클러터 제외 + (내가 멤버 OR 시스템admin). 백엔드 override와 합치.
  const candidates = projects.filter(
    (p) => p.id !== sourceProjectId && !isHiddenClutterProject(p) && (p.role != null || isSystemAdmin),
  )

  const onSubmit = async () => {
    if (targetId == null) return
    setBusy(true)
    setError('')
    try {
      if (mode === 'meetings') await moveMeetingsToProject(meetingIds ?? [], targetId)
      else await moveFolderToProject(folderId!, targetId)
      onMoved()
      onClose()
    } catch {
      setError('이동에 실패했습니다. 권한 또는 연결을 확인하세요.')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-80 rounded-lg bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-base font-semibold text-foreground">프로젝트 이동</h2>
        <p className="mb-3 truncate text-xs text-muted-foreground">{title}</p>
        {candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">이동할 다른 프로젝트가 없습니다.</p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {candidates.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => setTargetId(p.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
                    targetId === p.id ? 'bg-indigo-50 ring-1 ring-indigo-400' : 'hover:bg-accent'
                  }`}
                >
                  <ProjectIcon project={p} size={24} />
                  <span className="truncate text-foreground">{projectDisplayName(p)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">
            취소
          </button>
          <button
            onClick={onSubmit}
            disabled={targetId == null || busy}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            이동
          </button>
        </div>
      </div>
    </div>
  )
}
