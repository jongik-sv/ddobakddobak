# 프로젝트 선택 랜딩 (Project Selection Landing) — 설계

- **작성일:** 2026-06-17
- **브랜치:** `feat/project-management` (프로젝트별 관리 기능 후속)
- **선행:** `docs/superpowers/specs/2026-06-16-project-management-design.md` (D1–D11), 6 Phase 커밋 완료
- **상태:** 설계 승인 대기

## 1. 목적

로그인 직후 첫 화면을 **프로젝트 선택 랜딩**으로 만든다. 사용자가 어떤 프로젝트 컨텍스트로 진입할지 명시적으로 고르게 하되, 이미 선택 이력이 있으면 건너뛰고 마지막 프로젝트로 바로 진입한다.

레퍼런스 스타일: **Skywork식** — 좌측 프로젝트 리스트 사이드바 + 우측 카드 그리드, 다크.

## 2. 확정된 결정 (브레인스토밍)

| # | 결정 | 값 |
|---|------|-----|
| Q1 | 게이트 동작 | **최초/미선택시만** — `localStorage.current_project_id` 없을 때만 랜딩 표시 |
| Q2 | 디폴트 강조 | **마지막 사용** — localStorage 우선, 최초엔 **비개인(「기본」) 프로젝트** fallback |
| Q3 | 레이아웃 | **Skywork식** — 좌측 리스트 + 우측 카드 그리드, 다크 |
| Q4 | 라우트 | **`/` 인덱스 = 선택화면** (`App.tsx:146` 교체) |
| ① | `/projects` 관리페이지 | **그대로 유지** (랜딩에 흡수 안 함) |
| ② | Enter키 = 강조항목 진입 | **MVP 제외** (후속 옵션) |

## 3. 현행 구조 (영향 지점)

- `frontend/src/App.tsx:141` `GatedApp` = `SetupGate → AuthGuard → Routes`. 각 라우트가 `<AppLayout>`(사이드바 쉘)로 감쌈.
- `App.tsx:146` `<Route path="/" element={<Navigate to="/meetings" replace />} />` ← **교체 대상**.
- `frontend/src/stores/projectStore.ts` — Zustand. `currentProjectId` 초기값 = `storedCurrent()`(localStorage `current_project_id`). `fetchProjects` line 42–43: 유효 current 없으면 fallback = `find(p => p.personal) ?? projects[0]` ← **변경 대상**.
- `frontend/src/pages/ProjectsPage.tsx` — 기존 관리 그리드(`/projects`). 카드 클릭 → `setCurrentProject` → `/meetings`. ProjectDialog(생성/편집)·멤버 다이얼로그 보유. **무변경**(재사용만).
- `frontend/src/api/projects.ts` — `Project` 타입에 `personal: boolean`. (전용 default 플래그 없음.)
- 백엔드 `backfill_projects.rb:14` — 공용 「기본」 = `Project.find_or_create_by!(name: "기본", personal: false)`. → frontend는 이름매칭 대신 **first non-personal** 휴리스틱으로 식별(견고: 기존유저는 「기본」이 유일 비개인이거나 최저 id).

## 4. 컴포넌트 설계 (A안)

### 4.1 라우트 (App.tsx)

`/` element를 전체화면 랜딩으로 교체. `<AppLayout>` **미적용** = 사이드바 없이 전체화면 게이트(앱 쉘 사이드바와 Skywork 좌측 리스트 이중화 회피). AuthGuard 안이므로 인증 보장.

```jsx
const ProjectSelectLanding = lazy(load.ProjectSelectLanding)
// ...
<Route path="/" element={<Suspended><ProjectSelectLanding /></Suspended>} />
```

`load` 맵에 `ProjectSelectLanding` 추가(idle prefetch 동참). 나머지 라우트 무변경.

### 4.2 `ProjectSelectLanding` (신규, `frontend/src/pages/ProjectSelectLanding.tsx`)

**책임:** 게이트 판정 + Skywork 선택 UI 렌더 + 선택→진입.

**게이트:**
- mount 시 `storedCurrent()` 동기 확인.
  - 값 있음 → `<Navigate to="/meetings" replace />` 즉시 반환(플래시 없음). = "최초/미선택시만".
  - 값 없음 → `fetchProjects()` 후 Skywork UI 렌더.

**선택 핸들러:** 카드/리스트 항목 클릭 → `setCurrentProject(id)` → `navigate('/meetings')`.

**디폴트 강조(Q2):** `highlightId = projects.find(p => !p.personal)?.id ?? projects[0]?.id`. 자동진입 아님 — 시각 강조(★/테두리)만, 클릭해야 진입.

**상태:** `projectStore`의 `projects`, `isLoading`, `error`, `fetchProjects`, `setCurrentProject` 사용. 로컬 상태는 생성 다이얼로그 open 여부만.

### 4.3 Skywork 2-pane UI

- **좌측 리스트:** 프로젝트 아이콘+이름 행. 현재/제안 항목에 ★ + 강조 테두리. 하단 「+ 새 프로젝트」 버튼.
- **우측 그리드:** 반응형 카드(아이콘·이름·회의수·멤버수). 마지막에 「+」 생성 카드.
- **생성:** 기존 `ProjectsPage`의 ProjectDialog 재사용(또는 동일 다이얼로그 컴포넌트 import). 생성 성공 → `createProject`가 자동 `setCurrentProject(새 id)` → 랜딩에서 곧바로 `navigate('/meetings')`로 새 프로젝트 진입(명시 동작).
- **반응형:** 좁은 폭(<768px) → 2-pane가 단일 컬럼으로, 좌측 리스트는 상단 가로 칩/드롭다운으로 축약.

### 4.4 다크 팔레트 (Q3)

shadcn 시맨틱 토큰(`bg-card`/`text-foreground`/`text-muted-foreground`) **금지** — Tailwind v4 @theme 매핑 누락으로 저대비 렌더(`project_tailwind_theme_tokens` 함정, 직전 `efcdf40` 동일 이슈 수정). **명시색** 사용: 배경 zinc-900/950, 텍스트 zinc-100/300, 강조 indigo-500/400, 카드 zinc-800 + zinc-700 border. 프로젝트 관리 UI 6파일과 톤 일치.

### 4.5 store 변경 (projectStore.ts)

line 43 fallback 한 줄:
```diff
- current = (projects.find((p) => p.personal) ?? projects[0])?.id ?? null
+ current = (projects.find((p) => !p.personal) ?? projects[0])?.id ?? null
```
효과: 유효 current 없을 때(랜딩 외 경로 포함) 「기본」 우선 선택 → Q2 일관. last-used(localStorage) 동작은 기존대로 유지(line 33 init + line 42 guard).

## 5. 데이터 흐름

```
로그인(AuthGuard 통과)
  → "/" 진입 → ProjectSelectLanding
      ├─ storedCurrent() 있음 → /meetings (마지막 프로젝트 스코프)
      └─ 없음 → fetchProjects → Skywork 렌더 (비개인 강조)
                  → 카드 클릭 → setCurrentProject(id) → /meetings (선택 스코프)
```

## 6. 에러 / 엣지

- `fetchProjects` 실패 → `store.error` 메시지 + 재시도 버튼.
- 로딩 중 → 스켈레톤/스피너(앱 기존 패턴 따름).
- projects 0개(이론상 없음 — 전원 personal+기본 보유) → 「+ 새 프로젝트」 카드만 표시.
- 저장된 프로젝트가 삭제됨 → 게이트는 단순 presence 검사라 /meetings 진입; `fetchProjects` fallback이 자동 보정(비개인 선택). 랜딩 재표시 안 함(수용 — "최초/미선택시만").

## 7. 테스트

**단위 (vitest):**
- 게이트: `storedCurrent` 있음 → `<Navigate>` 렌더 / 없음 → 그리드 렌더.
- 강조: highlightId = 첫 비개인 프로젝트, 비개인 없으면 projects[0].
- 클릭: `setCurrentProject` 호출 + `navigate('/meetings')`.
- store: fallback이 비개인 우선으로 변경됨(personal-only 목록이면 personal 선택, 혼합이면 비개인).

**E2E (웹 https://localhost:13443, loopback 자동 admin):**
1. `localStorage.removeItem('current_project_id')` → "/" 진입 → Skywork 선택화면 표시, 「기본」 강조 → 클릭 → `/meetings`가 「기본」 스코프(회의 노출).
2. 재진입(localStorage 존재) → "/" 즉시 `/meetings` 리다이렉트, 선택화면 미표시.
3. 랜딩에서 「+ 새 프로젝트」 → 생성 → 진입.
- 콘솔 에러 0.

## 8. 무관 / 비범위 (변경 없음)

- `/projects` 관리페이지, ProjectSwitcher, 오프라인(`/local-meetings`)·초대(`/invite/:code`) 라우트.
- 백엔드(API·모델·마이그). 본 기능은 **프론트 전용** — 기존 `/api/v1/projects` 응답으로 충분.
- Enter키 진입, 키보드 내비, 프로젝트 검색/필터(NotebookLM식 탭) — 후속 옵션.
- **회의 프로젝트간 이동** — 본 스펙과 **별개 후속 작업**으로 결정(2026-06-17). 현 `move_to_folder`(meetings_controller.rb:186)는 같은 프로젝트 내 폴더 이동만 허용하고 프로젝트 경계를 차단함. 이동 기능 신설은 별도 spec/plan에서 진행. (프로젝트 삭제는 현 가드 동작 유지 — 변경 없음.)

## 9. 산출물

- 신규: `frontend/src/pages/ProjectSelectLanding.tsx` (+ 테스트)
- 수정: `frontend/src/App.tsx` (라우트·load 맵), `frontend/src/stores/projectStore.ts` (fallback 1줄)
- 재사용: ProjectDialog / ProjectCard 표현 컴포넌트(중복 시 추출 고려)
