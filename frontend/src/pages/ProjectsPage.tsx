import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { HTTPError } from 'ky'
import { Plus, MoreVertical, Pencil, Users, Trash2, Download } from 'lucide-react'
import { useProjectStore } from '../stores/projectStore'
import { useAuthStore, canCreateProject } from '../stores/authStore'
import { useMediaQuery, BREAKPOINTS } from '../hooks/useMediaQuery'
import { useFolderStore } from '../stores/folderStore'
import { useMeetingStore } from '../stores/meetingStore'
import type { Project } from '../api/projects'
import { projectDisplayName, isHiddenClutterProject } from '../api/projects'
import ProjectIcon from '../components/project/ProjectIcon'
import ProjectDialog from '../components/project/ProjectDialog'
import ProjectMembersPanel from '../components/project/ProjectMembersPanel'
import ExportProjectDialog from '../components/project/ExportProjectDialog'
import { confirmDialog } from '../lib/confirmDialog'
import ImportProjectButton from '../components/project/ImportProjectButton'
import { getMode } from '../config'

export default function ProjectsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const projects = useProjectStore((s) => s.projects)
  const visibleProjects = projects.filter((p) => !isHiddenClutterProject(p))
  const fetchProjects = useProjectStore((s) => s.fetchProjects)
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject)
  const removeProject = useProjectStore((s) => s.removeProject)
  const systemRole = useAuthStore((s) => s.user?.role)
  // 시스템 admin은 비멤버(role=null) 프로젝트도 삭제 권한이 있음(백엔드 override).
  const isSystemAdmin = systemRole === 'admin'
  // 프로젝트 가져오기(admin 전용). 로컬 모드(맥 데스크톱 단독)는 loopback=desktop@local admin이라
  // user 객체가 없어도 admin 등가 — Sidebar canManageUsers 등과 동일 관례.
  const canImportProject = isSystemAdmin || getMode() === 'local'
  // 프로젝트 생성(admin·manager, 로컬 모드는 예외적으로 허용).
  const canCreate = canCreateProject(systemRole) || getMode() === 'local'

  const [dialogProject, setDialogProject] = useState<Project | null>(null)
  // ?new=1 → 생성 다이얼로그 자동 오픈. 초기값을 URL에서 1회 도출(렌더 중 setState 회피).
  const [dialogOpen, setDialogOpen] = useState(() => searchParams.get('new') === '1')
  const [membersProject, setMembersProject] = useState<Project | null>(null)
  const [exportTarget, setExportTarget] = useState<Project | null>(null)
  const [menuId, setMenuId] = useState<number | null>(null)
  const [error, setError] = useState('')
  // 아이콘을 카드 높이의 약 1/2로(카드 md:250px → 120, 모바일 160px → 80). 좌측 큰 아이콘.
  const isMd = useMediaQuery(BREAKPOINTS.md)
  const iconSize = isMd ? 120 : 80

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

  // 가져오기 성공: 목록을 새로고침한 뒤 새 프로젝트로 진입한다.
  const handleImported = async (projectId: number) => {
    setError('')
    await fetchProjects()
    setCurrentProject(projectId)
    useFolderStore.getState().setSelectedFolder('all')
    useFolderStore.getState().fetchFolders()
    useMeetingStore.getState().setFolderId('all')
    useMeetingStore.getState().fetchMeetings(1)
    navigate('/meetings')
  }

  const handleDelete = async (p: Project) => {
    setMenuId(null)
    if (!(await confirmDialog(`'${p.name}' 프로젝트를 휴지통으로 이동합니다. 계속할까요?`, { title: '휴지통으로 이동', kind: 'warning' }))) return
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
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">프로젝트</h1>
        {canImportProject && <ImportProjectButton onImported={handleImported} />}
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visibleProjects.map((p) => (
          <div
            key={p.id}
            className="group relative h-[160px] cursor-pointer rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md md:h-[250px]"
            onClick={() => openProject(p)}
          >
            <div className="flex items-start gap-3">
              <ProjectIcon project={p} size={56} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-foreground">{projectDisplayName(p)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  멤버 {p.member_count} · 회의 {p.meeting_count}
                </p>
              </div>
              <div className="relative" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setMenuId(menuId === p.id ? null : p.id)}
                  className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                  aria-label="프로젝트 메뉴"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
                {menuId === p.id && (
                  <div className="absolute right-0 z-50 mt-1 w-36 rounded-md border border-border bg-card py-1 text-foreground shadow-lg">
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
                    {isSystemAdmin && (
                      <button
                        onClick={() => {
                          setMenuId(null)
                          setExportTarget(p)
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                      >
                        <Download className="h-4 w-4" /> 내보내기
                      </button>
                    )}
                    {!p.personal && (p.role === 'admin' || isSystemAdmin) && systemRole !== 'member' && (
                      <button
                        onClick={() => handleDelete(p)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" /> 휴지통
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <ProjectIcon project={p} size={iconSize} />
              <div className="min-w-0">
                <p className="text-xs text-zinc-500">멤버 {p.member_count}</p>
                <p className="text-xs text-zinc-500">회의 {p.meeting_count}</p>
              </div>
            </div>
            {p.description && (
              <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
            )}
          </div>
        ))}

        {canCreate && (
          <button
            onClick={() => {
              setDialogProject(null)
              setDialogOpen(true)
            }}
            className="flex h-[160px] items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-4 text-sm font-medium text-muted-foreground transition-colors hover:border-indigo-600 hover:text-indigo-600 md:h-[250px]"
          >
            <Plus className="h-5 w-5" /> 새 프로젝트
          </button>
        )}
      </div>

      {dialogOpen && (
        <ProjectDialog
          project={dialogProject ?? undefined}
          onClose={() => setDialogOpen(false)}
          onSaved={() => fetchProjects()}
        />
      )}

      {membersProject && (
        <ProjectMembersPanel project={membersProject} onClose={() => { setMembersProject(null); void fetchProjects() }} />
      )}

      {exportTarget && (
        <ExportProjectDialog project={exportTarget} onClose={() => setExportTarget(null)} />
      )}
    </div>
  )
}
