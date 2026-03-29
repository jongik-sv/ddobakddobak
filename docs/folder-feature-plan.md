# 회의록 폴더 분류 기능 구현 계획

## Context

현재 회의록은 팀/상태/유형 기준으로만 필터링 가능하며, 사용자가 직접 폴더를 만들어 회의록을 분류하는 기능이 없다. 파일 시스템처럼 폴더 트리를 만들고, 회의록을 폴더에 넣어 관리할 수 있도록 한다.

## 설계 결정

- **단일 레벨(flat) 폴더 구조**: `parent_id`로 중첩도 가능하지만, 초기 구현은 1단계 중첩까지 지원
- **폴더 네비게이션 위치**: Sidebar에 폴더 트리 표시 + MeetingsPage에 브레드크럼/하위폴더 표시
- **폴더 삭제 시**: 내부 회의록은 부모 폴더(또는 루트)로 이동 (cascade 삭제 안 함)
- **기존 필터와 공존**: 폴더 선택 + 상태/검색/날짜 필터가 복합 적용

---

## 구현 단계

### 1. Backend: DB 마이그레이션

**파일**: `backend/db/migrate/YYYYMMDDHHMMSS_create_folders.rb` (신규)
```ruby
create_table :folders do |t|
  t.string  :name, null: false
  t.integer :team_id, null: false
  t.integer :parent_id           # null = 최상위 폴더
  t.integer :position, default: 0, null: false
  t.timestamps
end
add_index :folders, :team_id
add_index :folders, :parent_id
add_index :folders, [:team_id, :parent_id, :position]
```

**파일**: `backend/db/migrate/YYYYMMDDHHMMSS_add_folder_id_to_meetings.rb` (신규)
```ruby
add_column :meetings, :folder_id, :integer
add_index  :meetings, :folder_id
```

### 2. Backend: Model

**신규**: `backend/app/models/folder.rb`
- `belongs_to :team`
- `belongs_to :parent, class_name: "Folder", optional: true`
- `has_many :children, class_name: "Folder", foreign_key: :parent_id, dependent: :nullify`
- `has_many :meetings, dependent: :nullify`
- validates: name(presence, max 100), position(integer >= 0)
- scopes: `for_team`, `roots`, `ordered`
- class method: `tree_for_team(team_ids)` — 전체 폴더를 한 번에 로드 후 메모리에서 트리 구성

**수정**: `backend/app/models/meeting.rb`
- 추가: `belongs_to :folder, optional: true`

**수정**: `backend/app/models/team.rb`
- 추가: `has_many :folders, dependent: :destroy`

### 3. Backend: Controller + Routes

**신규**: `backend/app/controllers/api/v1/folders_controller.rb`

| Action | Method | 설명 |
|--------|--------|------|
| index | GET /api/v1/folders | 트리 구조 반환 (flat=true 시 flat 리스트) |
| create | POST /api/v1/folders | 폴더 생성 (name, team_id, parent_id) |
| update | PATCH /api/v1/folders/:id | 이름/위치 변경 |
| destroy | DELETE /api/v1/folders/:id | 폴더 삭제 (자식·회의를 부모로 이동) |

**수정**: `backend/app/controllers/api/v1/meetings_controller.rb`
- `index`: `folder_id` 파라미터 필터 추가
  - `folder_id` 값이 `"null"` → `WHERE folder_id IS NULL` (미분류)
  - `folder_id` 값이 숫자 → 해당 폴더
  - `folder_id` 미전달 → 전체 회의
- `create`: `folder_id: params[:folder_id]` 추가
- `upload_audio`: `folder_id: params[:folder_id]` 추가
- `update`: `folder_id` 수정 허용 (회의 이동)
- `meeting_json`: `folder_id` 필드 추가
- 신규 collection action: `move_to_folder` — 복수 회의를 한 번에 폴더로 이동

**수정**: `backend/config/routes.rb`
```ruby
# 추가
resources :folders, only: %i[index create update destroy]

# meetings collection에 추가
collection do
  post :upload_audio
  post :move_to_folder   # { meeting_ids: [...], folder_id: ... }
end
```

### 4. Frontend: API Client

**신규**: `frontend/src/api/folders.ts`
- Types: `FolderNode` (트리용, children 포함), `Folder` (flat용)
- Functions: `getFolderTree()`, `createFolder()`, `updateFolder()`, `deleteFolder()`, `moveMeetingsToFolder()`

**수정**: `frontend/src/api/meetings.ts`
- `Meeting` interface: `folder_id: number | null` 추가
- `GetMeetingsParams`: `folder_id?: number | null` 추가
- `getMeetings`: searchParams에 folder_id 전달 로직
- `createMeeting`: `folder_id?` param 추가
- `UpdateMeetingParams`: `folder_id?: number | null` 추가

### 5. Frontend: Store

**신규**: `frontend/src/stores/folderStore.ts`
- State: `folders` (tree), `selectedFolderId` (number | null | 'all'), `expandedFolderIds` (Set), loading/error
- Actions: `fetchFolders`, `setSelectedFolder`, `toggleExpanded`, `createFolder`, `renameFolder`, `removeFolder`

**수정**: `frontend/src/stores/meetingStore.ts`
- State 추가: `folderId: number | null | 'all'` (기본값 'all')
- `setFolderId` action 추가
- `fetchMeetings`: folderId를 params에 반영

### 6. Frontend: UI 컴포넌트

**6a. 신규**: `frontend/src/components/folder/FolderTree.tsx`
- Sidebar 안에서 렌더링되는 폴더 트리
- 구조:
  ```
  ▸ 전체 회의          (selectedFolderId = 'all')
  ▸ 미분류             (selectedFolderId = null)
  ▸ 프로젝트 Alpha     (expandable)
    ▸ 스프린트 리뷰
  ▸ 프로젝트 Beta
  [+ 새 폴더]
  ```
- 폴더 클릭 → `folderStore.setSelectedFolder` + `meetingStore.setFolderId` → `fetchMeetings`
- 우클릭/⋯ 메뉴: 이름 변경, 삭제, 하위 폴더 추가

**6b. 신규**: `frontend/src/components/folder/FolderBreadcrumb.tsx`
- MeetingsPage 상단에 현재 경로 표시: `전체 회의 > 프로젝트 Alpha > 스프린트 리뷰`

**6c. 신규**: `frontend/src/components/folder/CreateFolderDialog.tsx`
- 폴더 이름 입력 다이얼로그 (생성/이름변경 겸용)

**6d. 수정**: `frontend/src/components/layout/Sidebar.tsx`
- "회의 목록" NavLink 아래에 `<FolderTree />` 삽입
- 폴더 트리가 접히면 사이드바 깔끔, 펼치면 트리 노출

**6e. 수정**: `frontend/src/pages/MeetingsPage.tsx`
- FolderBreadcrumb 추가 (h1 "회의 목록" 아래)
- 폴더 내부일 때 하위 폴더 카드 그리드 표시 (회의 목록 위)
- 회의 카드에 폴더 이동 메뉴 (⋯ 버튼 → "폴더로 이동")
- 회의 생성 시 현재 폴더의 folder_id 자동 설정
- URL 쿼리파라미터 `?folder=<id>` 동기화

### 7. Frontend: 라우팅

**수정**: `frontend/src/App.tsx`
- 라우팅 변경 불필요 (폴더는 URL query param으로 처리, 별도 route 아님)

---

## 수정 대상 파일 목록

### 신규 파일 (9개)
1. `backend/db/migrate/..._create_folders.rb`
2. `backend/db/migrate/..._add_folder_id_to_meetings.rb`
3. `backend/app/models/folder.rb`
4. `backend/app/controllers/api/v1/folders_controller.rb`
5. `frontend/src/api/folders.ts`
6. `frontend/src/stores/folderStore.ts`
7. `frontend/src/components/folder/FolderTree.tsx`
8. `frontend/src/components/folder/FolderBreadcrumb.tsx`
9. `frontend/src/components/folder/CreateFolderDialog.tsx`

### 수정 파일 (9개)
1. `backend/app/models/meeting.rb` — folder association 추가
2. `backend/app/models/team.rb` — folders association 추가
3. `backend/app/controllers/api/v1/meetings_controller.rb` — folder_id 필터/생성/이동
4. `backend/config/routes.rb` — folders resource 추가
5. `frontend/src/api/meetings.ts` — folder_id 타입/파라미터
6. `frontend/src/stores/meetingStore.ts` — folderId 필터
7. `frontend/src/components/layout/Sidebar.tsx` — FolderTree 삽입
8. `frontend/src/pages/MeetingsPage.tsx` — 브레드크럼, 폴더 필터 UI
9. `backend/db/schema.rb` — 마이그레이션 후 자동 갱신

---

## 검증 방법

1. **마이그레이션**: `rails db:migrate` 후 `schema.rb`에 folders 테이블과 meetings.folder_id 확인
2. **API 테스트**:
   - `POST /api/v1/folders` — 폴더 생성
   - `GET /api/v1/folders` — 트리 구조 반환
   - `GET /api/v1/meetings?folder_id=1` — 해당 폴더 회의만
   - `GET /api/v1/meetings?folder_id=null` — 미분류 회의만
   - `PATCH /api/v1/meetings/:id` with `folder_id` — 회의 이동
   - `DELETE /api/v1/folders/:id` — 삭제 후 자식 폴더/회의가 부모로 이동 확인
3. **Frontend E2E**:
   - Sidebar에서 폴더 트리 표시 확인
   - 폴더 선택 시 회의 목록 필터링 확인
   - 새 폴더 생성 → 트리에 반영
   - 회의 카드에서 "폴더로 이동" → 이동 후 목록 갱신
   - 폴더 삭제 → 내부 회의가 미분류로 이동
4. **기존 테스트**: `rails test` / `npm test` 통과 확인
