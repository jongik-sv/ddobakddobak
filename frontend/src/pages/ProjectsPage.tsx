import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { HTTPError } from 'ky'
import { Plus, MoreVertical, Pencil, Users, Trash2 } from 'lucide-react'
import { useProjectStore } from '../stores/projectStore'
import { useFolderStore } from '../stores/folderStore'
import { useMeetingStore } from '../stores/meetingStore'
import type { Project } from '../api/projects'
import ProjectIcon from '../components/project/ProjectIcon'
import ProjectDialog from '../components/project/ProjectDialog'
import ProjectMembersPanel from '../components/project/ProjectMembersPanel'

export default function ProjectsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const projects = useProjectStore((s) => s.projects)
  const fetchProjects = useProjectStore((s) => s.fetchProjects)
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject)
  const removeProject = useProjectStore((s) => s.removeProject)

  const [dialogProject, setDialogProject] = useState<Project | null>(null)
  // ?new=1 → 생성 다이얼로그 자동 오픈. 초기값을 URL에서 1회 도출(렌더 중 setState 회피).
  const [dialogOpen, setDialogOpen] = useState(() => searchParams.get('new') === '1')
  const [membersProject, setMembersProject] = useState<Project | null>(null)
  const [menuId, setMenuId] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  // 자동 오픈에 쓴 ?new 파라미터는 정리한다(state 구동 없이 URL만 갱신).
  useEffect(() => {
    if (searchParams.get('new') != null) {
      searchParams.delete('new')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const openProject = (p: Project) => {
    setCurrentProject(p.id)
    useFolderStore.getState().setSelectedFolder('all')
    useFolderStore.getState().fetchFolders()
    useMeetingStore.getState().setFolderId('all')
    useMeetingStore.getState().fetchMeetings(1)
    navigate('/meetings')
  }

  const handleDelete = async (p: Project) => {
    setMenuId(null)
    if (!window.confirm(`'${p.name}' 프로젝트를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return
    setError('')
    try {
      await removeProject(p.id)
    } catch (err) {
      if (err instanceof HTTPError && err.response.status === 409) {
        setError('회의가 남아 있는 프로젝트는 삭제할 수 없습니다.')
      } else {
        setError('프로젝트 삭제에 실패했습니다.')
      }
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">프로젝트</h1>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => (
          <div
            key={p.id}
            className="group relative cursor-pointer rounded-xl border border-border bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:bg-zinc-900"
            onClick={() => openProject(p)}
          >
            <div className="flex items-start gap-3">
              <ProjectIcon project={p} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-foreground">{p.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  멤버 {p.member_count} · 회의 {p.meeting_count}
                </p>
              </div>
              <div className="relative" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setMenuId(menuId === p.id ? null : p.id)}
                  className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                  aria-label="프로젝트 메뉴"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
                {menuId === p.id && (
                  <div className="absolute right-0 z-50 mt-1 w-36 rounded-md border border-border bg-white py-1 shadow-lg dark:bg-zinc-900">
                    <button
                      onClick={() => {
                        setMenuId(null)
                        setDialogProject(p)
                        setDialogOpen(true)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <Pencil className="h-4 w-4" /> 편집
                    </button>
                    <button
                      onClick={() => {
                        setMenuId(null)
                        setMembersProject(p)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <Users className="h-4 w-4" /> 멤버 관리
                    </button>
                    {!p.personal && p.role === 'admin' && (
                      <button
                        onClick={() => handleDelete(p)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" /> 삭제
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            {p.description && (
              <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
            )}
          </div>
        ))}

        <button
          onClick={() => {
            setDialogProject(null)
            setDialogOpen(true)
          }}
          className="flex min-h-[88px] items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-4 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <Plus className="h-5 w-5" /> 새 프로젝트
        </button>
      </div>

      {dialogOpen && (
        <ProjectDialog
          project={dialogProject ?? undefined}
          onClose={() => setDialogOpen(false)}
          onSaved={() => fetchProjects()}
        />
      )}

      {membersProject && (
        <ProjectMembersPanel project={membersProject} onClose={() => setMembersProject(null)} />
      )}
    </div>
  )
}
