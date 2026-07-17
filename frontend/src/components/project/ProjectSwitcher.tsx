import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, FolderKanban, Plus } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { useFolderStore } from '../../stores/folderStore'
import { useMeetingStore } from '../../stores/meetingStore'
import ProjectIcon from './ProjectIcon'
import { projectDisplayName, isHiddenClutterProject } from '../../api/projects'
import { useAuthStore, canCreateProject } from '../../stores/authStore'
import { getMode } from '../../config'

/**
 * 사이드바 상단 프로젝트 스위처. 현재 프로젝트(아이콘+이름) + 드롭다운으로 전환.
 * 전환 시 폴더/회의 선택을 초기화하고 현재 프로젝트 스코프로 다시 로드한다.
 */
export default function ProjectSwitcher() {
  const navigate = useNavigate()
  const projects = useProjectStore((s) => s.projects)
  const currentProjectId = useProjectStore((s) => s.currentProjectId)
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject)
  const fetchProjects = useProjectStore((s) => s.fetchProjects)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // 프로젝트 생성(admin·manager, 로컬 모드는 예외적으로 허용).
  const canCreate = canCreateProject(useAuthStore((s) => s.user?.role)) || getMode() === 'local'

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const current = projects.find((p) => p.id === currentProjectId) ?? null
  const visibleProjects = projects.filter((p) => !isHiddenClutterProject(p))

  const handleSelect = (id: number) => {
    setOpen(false)
    if (id === currentProjectId) {
      navigate('/meetings')
      return
    }
    setCurrentProject(id)
    // 폴더/회의 선택 초기화 후 새 프로젝트 스코프로 재로드
    useFolderStore.getState().setSelectedFolder('all')
    useFolderStore.getState().fetchFolders()
    useMeetingStore.getState().setFolderId('all')
    useMeetingStore.getState().fetchMeetings(1)
    navigate('/meetings')
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
        title="프로젝트 전환"
      >
        {current ? (
          <ProjectIcon project={current} size={24} />
        ) : (
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-indigo-500 text-white">
            <FolderKanban className="h-3.5 w-3.5" />
          </span>
        )}
        <span className="flex-1 min-w-0 truncate text-sm font-semibold text-foreground">
          {current ? projectDisplayName(current) : '프로젝트 선택'}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-80 overflow-y-auto rounded-md border border-border bg-card py-1 text-foreground shadow-lg">
          {visibleProjects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleSelect(p.id)}
              className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent ${
                p.id === currentProjectId ? 'bg-accent font-medium' : ''
              }`}
            >
              <ProjectIcon project={p} size={22} />
              <span className="flex-1 min-w-0 truncate">{projectDisplayName(p)}</span>
            </button>
          ))}

          <div className="my-1 border-t border-border" />

          <button
            type="button"
            onClick={() => {
              setOpen(false)
              navigate('/projects')
            }}
            className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent"
          >
            <FolderKanban className="h-4 w-4 shrink-0" />
            전체 프로젝트
          </button>
          {canCreate && (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                navigate('/projects?new=1')
              }}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent"
            >
              <Plus className="h-4 w-4 shrink-0" />
              새 프로젝트
            </button>
          )}
        </div>
      )}
    </div>
  )
}
