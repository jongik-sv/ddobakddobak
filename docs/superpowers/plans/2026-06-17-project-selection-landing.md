# 프로젝트 선택 랜딩 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로그인 후 첫 화면을 Skywork식 프로젝트 선택 랜딩(`/`)으로 만들되, 선택 이력이 있으면 건너뛰고 마지막 프로젝트로 바로 `/meetings` 진입한다.

**Architecture:** `/` 라우트를 `<AppLayout>`(사이드바 쉘) 밖 전체화면 `ProjectSelectLanding`으로 교체. 컴포넌트가 게이트(localStorage `current_project_id` 유무)를 판정해 리다이렉트하거나 좌측 리스트+우측 카드 그리드를 렌더한다. 백엔드 무변경 — 기존 `projectStore`/`/api/v1/projects` 재사용.

**Tech Stack:** React 18 + TypeScript, react-router-dom, Zustand(projectStore), Vitest + React Testing Library(jsdom), Tailwind v4(명시색).

**Spec:** `docs/superpowers/specs/2026-06-17-project-selection-landing-design.md`

---

## File Structure

| 파일 | 책임 | 변경 |
|------|------|------|
| `frontend/src/stores/projectStore.ts` | 프로젝트 상태·current 선택 | fallback 1줄(personal→비개인) |
| `frontend/src/stores/projectStore.test.ts` | store 단위 테스트 | 기존 fallback 테스트 갱신 + 케이스 추가 |
| `frontend/src/pages/ProjectSelectLanding.tsx` | 게이트 + Skywork 선택 UI | **신규** |
| `frontend/src/pages/ProjectSelectLanding.test.tsx` | 랜딩 단위 테스트 | **신규** |
| `frontend/src/App.tsx` | 라우팅 | `/` element 교체 + `load` 맵 등록 |
| `frontend/src/App.test.tsx` | 라우팅 smoke | `/` 새 동작 반영 |

**재사용(무변경):** `components/project/ProjectIcon`, `components/project/ProjectDialog`(store.createProject가 자동 setCurrentProject), `stores/folderStore`·`stores/meetingStore`(진입 시 스코프 재로드).

---

## Task 1: projectStore fallback — personal 우선 → 비개인(「기본」) 우선

**Files:**
- Modify: `frontend/src/stores/projectStore.ts:43`
- Test: `frontend/src/stores/projectStore.test.ts:36-43` (갱신) + 신규 케이스

**배경:** 저장된 current가 없을 때의 fallback이 현재 `personal` 프로젝트(개인=비어있음)를 고른다. 기존 회의 63건이 든 공용 「기본」 프로젝트(비개인)를 우선 선택하도록 바꾼다. last-used(localStorage) 동작은 그대로(line 33 init + line 42 guard).

- [ ] **Step 1: 기존 테스트를 새 기대값으로 교체(실패 유도)**

`frontend/src/stores/projectStore.test.ts`에서 line 36–43 `it('fetch 후 personal 우선...')` 블록을 아래 두 테스트로 교체:

```ts
  it('fetch 후 비개인(「기본」) 우선으로 currentProjectId 설정(저장값 없을 때)', async () => {
    mockGetProjects.mockResolvedValue([
      makeProject({ id: 3, personal: true }),
      makeProject({ id: 9, personal: false }),
    ])
    await useProjectStore.getState().fetchProjects()
    expect(useProjectStore.getState().currentProjectId).toBe(9)
  })

  it('비개인 프로젝트가 없으면 첫 번째 선택', async () => {
    mockGetProjects.mockResolvedValue([makeProject({ id: 3, personal: true })])
    await useProjectStore.getState().fetchProjects()
    expect(useProjectStore.getState().currentProjectId).toBe(3)
  })
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/stores/projectStore.test.ts`
Expected: FAIL — 첫 테스트가 `expected 9, received 3`(현 코드가 personal id3 선택).

- [ ] **Step 3: store fallback 변경**

`frontend/src/stores/projectStore.ts` line 43:

```ts
        current = (projects.find((p) => !p.personal) ?? projects[0])?.id ?? null
```

(`p.personal` → `!p.personal` 한 글자 차이. 나머지 줄 무변경.)

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/stores/projectStore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/stores/projectStore.ts frontend/src/stores/projectStore.test.ts
git commit -m "fix(project): 프로젝트 fallback을 비개인(「기본」) 우선으로 — 개인 빈 프로젝트 자동선택 회피"
```

---

## Task 2: ProjectSelectLanding 컴포넌트 + 단위 테스트

**Files:**
- Create: `frontend/src/pages/ProjectSelectLanding.tsx`
- Test: `frontend/src/pages/ProjectSelectLanding.test.tsx`

**책임:** 게이트(localStorage 유무) 판정 → 리다이렉트 또는 Skywork 선택 UI. 선택/생성 시 `/meetings` 진입.

- [ ] **Step 1: 실패 테스트 작성**

`frontend/src/pages/ProjectSelectLanding.test.tsx` 신규:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { useProjectStore } from '../stores/projectStore'
import type { Project } from '../api/projects'
import ProjectSelectLanding from './ProjectSelectLanding'

// fetchProjects는 네트워크 → api 목. 각 테스트가 mockResolvedValue로 목록 주입.
const { mockGetProjects } = vi.hoisted(() => ({ mockGetProjects: vi.fn() }))
vi.mock('../api/projects', () => ({
  getProjects: mockGetProjects,
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
}))
// 진입 시 폴더/회의 store는 네트워크 호출 → 목으로 차단.
vi.mock('../stores/folderStore', () => ({
  useFolderStore: { getState: () => ({ setSelectedFolder: vi.fn(), fetchFolders: vi.fn() }) },
}))
vi.mock('../stores/meetingStore', () => ({
  useMeetingStore: { getState: () => ({ setFolderId: vi.fn(), fetchMeetings: vi.fn() }) },
}))
// ProjectDialog 내부(IconPicker 등) 분리 — onSaved 트리거만 검증.
vi.mock('../components/project/ProjectDialog', () => ({
  default: ({ onSaved }: { onSaved?: (p: unknown) => void }) => (
    <button onClick={() => onSaved?.({ id: 99 })}>DIALOG_SAVE</button>
  ),
}))

function makeProject(o: Partial<Project> = {}): Project {
  return {
    id: 1, name: 'P', description: null, icon_type: null, icon_value: null,
    color: null, personal: false, role: 'admin', member_count: 1, meeting_count: 0, ...o,
  }
}

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<ProjectSelectLanding />} />
        <Route path="/meetings" element={<div>MEETINGS_SENTINEL</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProjectSelectLanding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.getState().reset()
    localStorage.clear()
  })

  it('선택 이력(localStorage) 있으면 /meetings로 리다이렉트', () => {
    localStorage.setItem('current_project_id', '5')
    renderLanding()
    expect(screen.getByText('MEETINGS_SENTINEL')).toBeInTheDocument()
  })

  it('이력 없으면 프로젝트 목록 렌더(리다이렉트 안 함)', async () => {
    mockGetProjects.mockResolvedValue([
      makeProject({ id: 9, name: '기본', personal: false }),
      makeProject({ id: 3, name: '개인', personal: true }),
    ])
    renderLanding()
    expect(await screen.findAllByText('기본')).not.toHaveLength(0)
    expect(screen.queryByText('MEETINGS_SENTINEL')).not.toBeInTheDocument()
  })

  it('비개인 프로젝트가 디폴트 강조(aria-current)', async () => {
    mockGetProjects.mockResolvedValue([
      makeProject({ id: 3, name: '개인', personal: true }),
      makeProject({ id: 9, name: '기본', personal: false }),
    ])
    renderLanding()
    await screen.findAllByText('기본')
    const highlighted = document.querySelector('[aria-current="true"]')
    expect(highlighted?.textContent).toContain('기본')
  })

  it('프로젝트 클릭 시 setCurrentProject + /meetings 이동', async () => {
    mockGetProjects.mockResolvedValue([makeProject({ id: 9, name: '기본', personal: false })])
    renderLanding()
    const items = await screen.findAllByText('기본')
    fireEvent.click(items[0])
    expect(useProjectStore.getState().currentProjectId).toBe(9)
    expect(screen.getByText('MEETINGS_SENTINEL')).toBeInTheDocument()
  })

  it('새 프로젝트 생성 후 /meetings 진입', async () => {
    mockGetProjects.mockResolvedValue([])
    renderLanding()
    const addBtns = await screen.findAllByText(/새 프로젝트/)
    fireEvent.click(addBtns[0])
    fireEvent.click(screen.getByText('DIALOG_SAVE'))
    expect(screen.getByText('MEETINGS_SENTINEL')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/pages/ProjectSelectLanding.test.tsx`
Expected: FAIL — `Failed to resolve import './ProjectSelectLanding'`(컴포넌트 미생성).

- [ ] **Step 3: 컴포넌트 구현**

`frontend/src/pages/ProjectSelectLanding.tsx` 신규:

```tsx
import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Plus, Star } from 'lucide-react'
import { useProjectStore } from '../stores/projectStore'
import { useFolderStore } from '../stores/folderStore'
import { useMeetingStore } from '../stores/meetingStore'
import type { Project } from '../api/projects'
import ProjectIcon from '../components/project/ProjectIcon'
import ProjectDialog from '../components/project/ProjectDialog'

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

  // 게이트(최초/미선택시만): mount 시 1회 동기 계산 → 렌더 단계 리다이렉트(깜빡임 없음).
  const [hasStored] = useState(() => localStorage.getItem(CURRENT_KEY) != null)

  useEffect(() => {
    if (!hasStored) fetchProjects()
  }, [hasStored, fetchProjects])

  if (hasStored) return <Navigate to="/meetings" replace />

  // 디폴트 강조 = 비개인(「기본」) 우선, 없으면 첫 번째. 자동진입 아님 — 시각 제안만.
  const highlightId = (projects.find((p) => !p.personal) ?? projects[0])?.id ?? null

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
      <aside className="hidden w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900 p-4 md:flex">
        <h2 className="mb-4 px-2 text-sm font-semibold text-zinc-400">프로젝트</h2>
        <nav className="flex-1 space-y-1 overflow-y-auto">
          {projects.map((p) => (
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
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.id === highlightId && <Star className="h-3.5 w-3.5 shrink-0 text-indigo-400" />}
            </button>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="mt-2 flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-indigo-400 transition-colors hover:bg-zinc-800"
        >
          <Plus className="h-4 w-4" /> 새 프로젝트
        </button>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-5xl">
          <h1 className="mb-1 text-2xl font-bold text-zinc-100">프로젝트 선택</h1>
          <p className="mb-6 text-sm text-zinc-400">작업할 프로젝트를 선택하세요.</p>

          {error && (
            <div role="alert" className="mb-4 rounded-md bg-red-950 px-4 py-2 text-sm text-red-300">
              {error}
              <button onClick={() => fetchProjects()} className="ml-2 underline">다시 시도</button>
            </div>
          )}

          {isLoading && projects.length === 0 ? (
            <p className="text-sm text-zinc-500">불러오는 중…</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-current={p.id === highlightId ? 'true' : undefined}
                  onClick={() => enter(p)}
                  className={`flex flex-col items-start rounded-xl border bg-zinc-900 p-4 text-left transition-colors hover:border-indigo-500 ${
                    p.id === highlightId ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-zinc-800'
                  }`}
                >
                  <div className="flex w-full items-start gap-3">
                    <ProjectIcon project={p} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-zinc-100">{p.name}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">멤버 {p.member_count} · 회의 {p.meeting_count}</p>
                    </div>
                    {p.id === highlightId && <Star className="h-4 w-4 shrink-0 text-indigo-400" />}
                  </div>
                  {p.description && <p className="mt-3 line-clamp-2 text-xs text-zinc-500">{p.description}</p>}
                </button>
              ))}

              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                className="flex min-h-[88px] items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-700 p-4 text-sm font-medium text-zinc-400 transition-colors hover:border-indigo-500 hover:text-indigo-400"
              >
                <Plus className="h-5 w-5" /> 새 프로젝트
              </button>
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
```

> 주: 생성 흐름 — `ProjectDialog`가 `store.createProject`를 호출하고, 이 액션이 자동으로 `setCurrentProject(새 id)` + localStorage 기록(projectStore.ts:60)을 수행한다. 따라서 `onSaved`에서 `navigate('/meetings')`만 하면 새 프로젝트 스코프로 진입한다.

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/pages/ProjectSelectLanding.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/pages/ProjectSelectLanding.tsx frontend/src/pages/ProjectSelectLanding.test.tsx
git commit -m "feat(project): 프로젝트 선택 랜딩 컴포넌트(Skywork식 게이트+그리드)"
```

---

## Task 3: 라우트 배선 + App.test 갱신

**Files:**
- Modify: `frontend/src/App.tsx` (`load` 맵, lazy 선언, `/` Route)
- Test: `frontend/src/App.test.tsx`

- [ ] **Step 1: App.test에 새 동작 테스트 추가(실패 유도)**

`frontend/src/App.test.tsx`의 기존 `describe('App 라우팅', ...)` 블록을 아래로 교체. 상단 import에 `screen`을 추가(`import { render, screen } from '@testing-library/react'`)하고, App import 직전에 ProjectSelectLanding 목을 추가한다:

```tsx
vi.mock('./pages/ProjectSelectLanding', () => ({
  default: () => <div>LANDING_SENTINEL</div>,
}))

import App from './App'

describe('App 라우팅', () => {
  it('/ 경로에서 프로젝트 선택 랜딩을 렌더', async () => {
    localStorage.clear()
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    )
    expect(await screen.findByText('LANDING_SENTINEL')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/App.test.tsx`
Expected: FAIL — `LANDING_SENTINEL`을 못 찾음(현재 `/`는 `Navigate to /meetings`).

- [ ] **Step 3: App.tsx 라우트 배선**

`frontend/src/App.tsx` 세 곳 수정:

(a) `load` 맵(line 27 `InviteRedeemPage` 다음 줄)에 추가:
```ts
  ProjectSelectLanding: () => import('./pages/ProjectSelectLanding'),
```

(b) lazy 선언(line 39 `InviteRedeemPage` 다음 줄)에 추가:
```ts
const ProjectSelectLanding = lazy(load.ProjectSelectLanding)
```

(c) `GatedApp`의 `/` 라우트(line 146)를 교체:
```tsx
      <Route path="/" element={<Suspended><ProjectSelectLanding /></Suspended>} />
```

> `Navigate` import는 line 56·204에서 계속 쓰이므로 유지한다. `<AppLayout>`은 의도적으로 미적용(전체화면 게이트).

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/App.test.tsx`
Expected: PASS.

- [ ] **Step 5: 전체 단위 테스트 + 빌드 회귀 확인**

Run: `cd frontend && npx vitest run src/stores/projectStore.test.ts src/pages/ProjectSelectLanding.test.tsx src/App.test.tsx`
Expected: PASS (전 케이스).
Run: `cd frontend && npx vite build`
Expected: 성공(본 작업 신규/수정 파일에서 tsc 에러 0. 무관 기존 14개 에러는 spec §2.4·메모리 기록대로 본 작업 범위 밖).

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx
git commit -m "feat(project): / 인덱스를 프로젝트 선택 랜딩으로 배선(로그인 후 첫 화면)"
```

---

## Task 4: 웹 E2E 수동 검증 (배포·기기검증)

자동 테스트 범위 밖. 웹(https://localhost:13443, loopback=자동 admin)에서 실행하고 결과를 기록한다.

- [ ] **Step 1: dev 서버 기동 확인** — `/up` 200, 프론트 dev 접속.
- [ ] **Step 2: 최초 진입** — 브라우저 콘솔에서 `localStorage.removeItem('current_project_id')` 후 `/` 진입 → Skywork 선택화면 표시, 좌측 리스트 + 우측 그리드, 「기본」이 ★ 강조. 콘솔 에러 0.
- [ ] **Step 3: 선택 진입** — 「기본」 카드 클릭 → `/meetings`로 이동, 회의 63건(기존 데이터) 노출. ProjectSwitcher에 「기본」 표시.
- [ ] **Step 4: 재진입 게이트** — `/` 다시 진입 → 선택화면 **미표시**, 즉시 `/meetings`(마지막 프로젝트). 
- [ ] **Step 5: 생성 흐름** — 선택화면에서 「+ 새 프로젝트」 → 생성 → 새 프로젝트로 `/meetings` 진입.
- [ ] **Step 6: 반응형** — 좁은 폭(<768px)에서 좌측 리스트 숨김, 그리드만으로 선택 가능.
- [ ] **Step 7: 결과 기록** — 메모리 `project_project_management_feature.md`에 선택 랜딩 완료/잔여를 갱신.

---

## Self-Review (작성자 체크)

**1. Spec coverage:**
- Q1 게이트(최초/미선택시만) → Task 2 `hasStored` 게이트 + Task 2 테스트 1·App 테스트. ✓
- Q2 디폴트(마지막 사용 + 비개인 fallback) → Task 1 store fallback + Task 2 `highlightId`. ✓
- Q3 Skywork 다크 레이아웃(명시색) → Task 2 컴포넌트(aside 리스트 + 카드 그리드, zinc/indigo). ✓
- Q4 `/` 인덱스 전체화면 → Task 3 라우트 교체(AppLayout 미적용). ✓
- 생성 흐름 명시(createProject 자동 set + onSaved navigate) → Task 2 Step 3 주석 + 테스트 5. ✓
- 에러/로딩/0개 엣지 → Task 2 컴포넌트(`error`·`isLoading`·dashed 카드). ✓
- 단위·E2E 테스트 → Task 1~3 단위, Task 4 E2E. ✓
- 비범위(회의 이동=후속, 삭제 현행, `/projects` 무변경) → 본 플랜 미포함. ✓

**2. Placeholder scan:** TBD/TODO/“적절히 처리” 없음. 모든 코드 스텝 완전 코드. ✓

**3. Type consistency:** `Project` 타입(`personal`·`member_count`·`meeting_count`) api 정의와 일치. `ProjectIcon`(project,size)·`ProjectDialog`(onClose,onSaved) 실제 시그니처 일치. store 액션명(`fetchProjects`·`setCurrentProject`·`createProject`) 일치. `current_project_id` 키 일치. ✓
