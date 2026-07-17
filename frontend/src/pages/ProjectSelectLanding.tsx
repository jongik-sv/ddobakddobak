import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Plus, Star } from 'lucide-react'
import { useProjectStore } from '../stores/projectStore'
import { useFolderStore } from '../stores/folderStore'
import { useMeetingStore } from '../stores/meetingStore'
import type { Project } from '../api/projects'
import { projectDisplayName } from '../api/projects'
import ProjectIcon from '../components/project/ProjectIcon'
import ProjectDialog from '../components/project/ProjectDialog'
import { useAuthStore, canCreateProject } from '../stores/authStore'
import { getMode } from '../config'

const CURRENT_KEY = 'current_project_id'

/**
 * 로그인 후 첫 화면 = 프로젝트 선택 랜딩(Skywork식: 좌측 리스트 + 우측 카드 그리드).
 * 게이트: 선택 이력(localStorage)이 있으면 건너뛰고 마지막 프로젝트로 /meetings 진입.
 * AppLayout(사이드바 쉘) 밖에서 전체화면 렌더한다(쉘 사이드바와 좌측 리스트 이중화 회피).
 */
export default function ProjectSelectLanding() {
  const navigate = useNavigate()
  const projects = useProjectStore((s) => s.projects)
  const isLoading = useProjectStore((s) => s.isLoading)
  const error = useProjectStore((s) => s.error)
  const fetchProjects = useProjectStore((s) => s.fetchProjects)
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject)
  const [dialogOpen, setDialogOpen] = useState(false)
  // 프로젝트 생성(admin·manager, 로컬 모드는 예외적으로 허용).
  const canCreate = canCreateProject(useAuthStore((s) => s.user?.role)) || getMode() === 'local'

  // 게이트(최초/미선택시만): mount 시 1회 동기 계산 → 렌더 단계 리다이렉트(깜빡임 없음).
  const [hasStored] = useState(() => localStorage.getItem(CURRENT_KEY) != null)

  useEffect(() => {
    if (!hasStored) fetchProjects()
  }, [hasStored, fetchProjects])

  if (hasStored) return <Navigate to="/meetings" replace />

  // 내가 멤버인(role≠null) 프로젝트만 — admin은 index가 전체를 주지만, 작업 컨텍스트 선택엔 본인 멤버 것만 노출.
  const myProjects = projects.filter((p) => p.role != null)
  // 디폴트 강조 = 멤버인 비개인(「기본」) 우선, 없으면 첫 번째. 자동진입 아님 — 시각 제안만.
  const highlightId = (myProjects.find((p) => !p.personal) ?? myProjects[0])?.id ?? null

  const enter = (p: Project) => {
    setCurrentProject(p.id)
    // 선택 프로젝트 스코프로 폴더/회의 초기화 후 재로드 (ProjectSwitcher와 동일 동작).
    useFolderStore.getState().setSelectedFolder('all')
    useFolderStore.getState().fetchFolders()
    useMeetingStore.getState().setFolderId('all')
    useMeetingStore.getState().fetchMeetings(1)
    navigate('/meetings')
  }

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900 p-4 md:flex">
        <h2 className="mb-4 px-2 text-sm font-semibold text-zinc-400">프로젝트</h2>
        <nav className="flex-1 space-y-1 overflow-y-auto">
          {myProjects.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-current={p.id === highlightId ? 'true' : undefined}
              onClick={() => enter(p)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-zinc-800 ${
                p.id === highlightId ? 'bg-zinc-800 ring-1 ring-indigo-500' : ''
              }`}
            >
              <ProjectIcon project={p} size={22} />
              <span className="min-w-0 flex-1 truncate">{projectDisplayName(p)}</span>
              {p.id === highlightId && <Star className="h-3.5 w-3.5 shrink-0 text-indigo-400" />}
            </button>
          ))}
        </nav>
        {canCreate && (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="mt-2 flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-indigo-400 transition-colors hover:bg-zinc-800"
          >
            <Plus className="h-4 w-4" /> 새 프로젝트
          </button>
        )}
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        <div>
          <h1 className="mb-1 text-2xl font-bold text-zinc-100">프로젝트 선택</h1>
          <p className="mb-6 text-sm text-zinc-400">작업할 프로젝트를 선택하세요.</p>

          {error && (
            <div role="alert" className="mb-4 rounded-md bg-red-950 px-4 py-2 text-sm text-red-300">
              {error}
              <button onClick={() => fetchProjects()} className="ml-2 underline">다시 시도</button>
            </div>
          )}

          {isLoading && myProjects.length === 0 ? (
            <p className="text-sm text-zinc-500">불러오는 중…</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {myProjects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-current={p.id === highlightId ? 'true' : undefined}
                  onClick={() => enter(p)}
                  className={`flex h-[160px] flex-col items-start rounded-xl border bg-zinc-900 p-4 text-left transition-colors hover:border-indigo-500 md:h-[250px] ${
                    p.id === highlightId ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-zinc-800'
                  }`}
                >
                  <div className="flex w-full items-start gap-3">
                    <ProjectIcon project={p} size={56} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-zinc-100">{projectDisplayName(p)}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">멤버 {p.member_count} · 회의 {p.meeting_count}</p>
                    </div>
                    {p.id === highlightId && <Star className="h-4 w-4 shrink-0 text-indigo-400" />}
                  </div>
                  {p.description && <p className="mt-3 line-clamp-2 text-xs text-zinc-500">{p.description}</p>}
                </button>
              ))}

              {canCreate && (
                <button
                  type="button"
                  onClick={() => setDialogOpen(true)}
                  className="flex h-[160px] items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-700 p-4 text-sm font-medium text-zinc-400 transition-colors hover:border-indigo-500 hover:text-indigo-400 md:h-[250px]"
                >
                  <Plus className="h-5 w-5" /> 새 프로젝트
                </button>
              )}
            </div>
          )}
        </div>
      </main>

      {dialogOpen && (
        <ProjectDialog
          onClose={() => setDialogOpen(false)}
          onSaved={() => navigate('/meetings')}
        />
      )}
    </div>
  )
}
