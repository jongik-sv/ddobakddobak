# 프로젝트 즐겨찾기(중요) — 구현 플랜

## 배경

사이드바 `ProjectSwitcher` 드롭다운에 프로젝트가 전부 나와 많음. 사용자별 즐겨찾기(중요) 표시를 도입해 드롭다운엔 즐겨찾기만 노출하고, `/projects` 페이지에서 별(★) 토글로 지정한다.

설계 결정(사용자 승인):
- 중요 표시는 **사용자별** — `project_favorites` 조인 테이블 (user_id, project_id, unique). 멤버십 플래그 아님(시스템 admin은 비멤버 프로젝트도 목록에 보이므로).
- 드롭다운: 즐겨찾기만 표시, 0개면 전체 폴백, 맨 아래 "전체 프로젝트…" → `/projects` 이동. 현재 선택 프로젝트는 즐겨찾기 아니어도 항상 표시.
- 순서 지정 없음. 즐겨찾기 boolean 토글만.

## Global Constraints

- 기존 패턴 준수: Meeting/Folder `important`처럼 `ActiveModel::Type::Boolean.new.cast()` 캐스팅.
- 커밋은 feature/project-favorites 브랜치에만. push 금지. main 접근 금지.
- **Rails dev 서버(포트 13323)가 러닝 중** — 마이그레이션 파일 생성 직후 반드시 `bin/rails db:migrate` 실행 (pending migration이면 러닝 서버 전 요청 500).
- frontend 타입체크는 `npx tsc -p tsconfig.app.json` (bare tsc는 거짓 green).
- 테스트: backend 신규 request spec 통과 + 관련 기존 spec 회귀 없음. frontend 신규/수정 vitest 통과.

## Task 1: Backend — project_favorites 테이블 + API

**파일:**
- `backend/db/migrate/` 신규: `create_project_favorites` — `user_id`(null:false), `project_id`(null:false), timestamps, `[user_id, project_id]` unique index. FK는 기존 테이블들 스타일 따라(schema.rb 확인).
- `backend/app/models/project_favorite.rb` 신규: `belongs_to :user`, `belongs_to :project`, uniqueness validation.
- `backend/app/models/user.rb`, `backend/app/models/project.rb`: `has_many :project_favorites, dependent: :destroy` 추가 (user 쪽은 `has_many :favorite_projects, through:` 불필요 — YAGNI).
- `backend/app/controllers/api/v1/projects_controller.rb`:
  - `index`: 기존 배치 쿼리(roles/member_counts/meeting_counts) 옆에 `favorite_ids = ProjectFavorite.where(user_id: current_user.id, project_id: project_ids).pluck(:project_id).to_set` 1쿼리 추가. `project_json`에 `favorite:` boolean 포함 (index 외 경로에서 호출되는 `project_json`은 개별 exists? 조회 fallback — 시그니처 확인 후 기존 호출부 깨지지 않게).
  - 신규 액션 `favorite`: `PUT /api/v1/projects/:id/favorite`, body `{ favorite: true|false }`. `ActiveModel::Type::Boolean.new.cast(params[:favorite])` — true면 `find_or_create_by!`, false면 destroy. 권한: `set_project`가 통과하는(=사용자가 볼 수 있는) 프로젝트면 허용, admin 불필요. 응답 `{ favorite: <bool> }`.
- `backend/config/routes.rb`: projects member 라우트에 `put :favorite` 추가 (기존 member 라우트 스타일 확인).
- spec: `backend/spec/requests/api/v1/` 기존 projects spec 파일 위치 확인 후 추가 — 토글 on/off, 중복 토글 멱등, 비멤버(시스템 admin) 토글 가능, index 응답에 favorite 필드 반영, 타 사용자 즐겨찾기 영향 없음.

**완료 후 즉시 `bin/rails db:migrate` 실행** (dev + test DB: `RAILS_ENV=test bin/rails db:migrate` 또는 `db:test:prepare`).

검증: 신규 spec + `bundle exec rspec spec/requests/api/v1/projects*` 통과.

## Task 2: Frontend — 별 토글 + 드롭다운 필터

**파일:**
- `frontend/src/api/projects.ts`: `Project`에 `favorite: boolean` 추가, `toggleProjectFavorite(id, favorite)` API 함수 (`PUT /projects/:id/favorite`).
- `frontend/src/stores/projectStore.ts`: `toggleFavorite(id, favorite)` 액션 — 낙관적 업데이트(projects 배열 내 해당 항목 favorite 갱신), 실패 시 롤백.
- `frontend/src/pages/ProjectsPage.tsx`: 각 카드에 별 토글 버튼 — 카드 우상단 코너(기존 메뉴 버튼과 겹치지 않게), favorite=true면 채워진 별(노랑 계열), false면 외곽선 별(muted, hover 시 표시). 클릭 시 카드 클릭(프로젝트 진입)으로 전파 금지(stopPropagation). 카드 정렬: favorite 먼저, 그 안에서 기존 순서 유지.
- `frontend/src/components/project/ProjectSwitcher.tsx`:
  - 표시 목록 = 기존 필터(isHiddenClutterProject 제외) ∩ favorite. favorite 0개면 기존 전체 목록 폴백.
  - 현재 선택 프로젝트가 목록에 없으면 맨 위에 추가.
  - 목록 아래 구분선 + "전체 프로젝트…" 항목 → `navigate('/projects')` (기존 라우팅 방식 확인, react-router 사용 여부).
- 테스트(vitest, 기존 테스트 파일 위치·스타일 따라):
  - projectStore toggleFavorite 낙관적 업데이트/롤백.
  - ProjectSwitcher: favorite만 표시, 0개 폴백, 현재 프로젝트 항상 표시, "전체 프로젝트…" 클릭 시 이동.

검증: 관련 vitest 통과 + `npx tsc -p tsconfig.app.json` 에러 0.
