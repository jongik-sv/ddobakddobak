# 회의·폴더 프로젝트간 이동 — 설계

날짜: 2026-06-17
브랜치(예정): `feat/cross-project-move`
관련: `feat/project-management`(프로젝트 격리 기반)

## 목적

회의와 폴더를 한 프로젝트에서 다른 프로젝트로 옮긴다. 현재는 UI가 없어 수동 Rails runner로만 가능(계량대 이전 전례). `move_to_folder`는 같은 프로젝트 내 폴더이동만 지원하고 교차 프로젝트를 차단한다.

## 범위

**포함:**
- 회의 **단건** 프로젝트 이동 (백엔드는 일괄 대비 배열 API로 설계)
- 폴더 **단건** 프로젝트 이동 (서브트리 통째)
- 공용 프로젝트 셀렉터 모달

**제외(후속):**
- 회의 **일괄** 선택/이동 UI — 다중선택 인프라(체크박스·선택바·선택 store)가 현재 없어 별도 작업. 백엔드 API는 `meeting_ids[]` 배열을 받게 만들어 두어, 후속에서 UI만 얹으면 동작하도록 한다.
- 이동 시 대상 폴더 선택(대상에선 항상 최상위 안착, 이후 드래그로 재배치).

## 권한 모델

이동 허용 조건 = **원본 권한 AND 대상 권한**:

- **원본**: 회의는 `Meeting#editable_by?`(소유자 ∨ admin), 폴더는 `Folder#editable_by?`(admin ∨ 폴더 직속 회의의 creator).
- **대상**: 대상 프로젝트 멤버(`project_memberships`에 존재) **OR** 시스템 admin(`current_user.admin?` override).

둘 다 충족해야 이동. 어느 한쪽이라도 실패 → 403. 남의 프로젝트로 밀어넣기·빼오기(권한상승)를 차단한다. `update_all`은 콜백·인가를 우회하므로 `Meeting.editable_by` 스코프가 유일 방어선이며, 이를 반드시 거친다.

## 백엔드

### 1. `POST /api/v1/meetings/move_to_project` (collection)

params: `meeting_ids: number[]`, `target_project_id: number`

가드(순서):
1. `meeting_ids` 비었으면 422
2. 대상 프로젝트 존재 확인, 없으면 404
3. 대상 멤버십: `target.project_memberships.exists?(user_id: current_user.id) || current_user.admin?` 아니면 403
4. 잠긴 회의 포함 시 403 (move_to_folder 패턴: `Meeting.where(id: ids).where.not(locked_at: nil).exists?`)

처리:
```ruby
meetings = Meeting.editable_by(current_user).where(id: meeting_ids)
meetings.update_all(project_id: target.id, folder_id: nil)
```
- `folder_id: nil` — 원본 폴더는 대상 프로젝트에 없으므로 분리(최상위 안착).
- `editable_by` 스코프로 남의 공유 회의 이동 차단.

반환: `{ moved: meetings.count }`

라우트: `resources :meetings` collection에 `post :move_to_project` 추가(move_to_folder 옆).

### 2. `POST /api/v1/folders/:id/move_to_project` (member)

params: `target_project_id: number`

가드:
1. 폴더 존재(없으면 404)
2. `folder.editable_by?(current_user)` 아니면 403
3. 대상 멤버십(위와 동일) 아니면 403
4. 자기 프로젝트로의 이동(target == 폴더 현재 project_id)이면 422(무의미한 이동 거부)

처리(단일 트랜잭션):
1. 서브트리 폴더 id 재귀 수집 — 루트부터 BFS/DFS, `seen` 사이클 가드(`ancestor_records` 역방향 패턴 참고). 결과 = 루트 포함 모든 자손 폴더 id.
2. 서브트리 폴더 전부 `update_all(project_id: target.id)`.
3. 루트 폴더만 `parent_id: nil`(최상위 안착). 내부 부모-자식 구조는 보존.
4. 서브트리에 속한 회의 전부 `Meeting.where(folder_id: subtree_ids).update_all(project_id: target.id)` — `folder_id` 유지(폴더 같이 이동).

> 잠금 회의 처리: 폴더 이동은 폴더 단위 권한(editable_by?)으로 통제하며, move_to_folder의 잠금가드와 달리 개별 잠금은 검사하지 않는다(이동이 회의 내용을 바꾸지 않음). 단, 일관성을 위해 구현 단계에서 잠긴 회의 포함 여부를 로깅한다.

반환: `{ moved_folders: n, moved_meetings: m }`

라우트: `resources :folders` member에 `post :move_to_project` 추가.

### 데이터 안전

이동은 `update_all`(파괴적 아님, FK cascade 무관)이지만, 대량 폴더서브트리 이동 시 고아 폴더(부모가 다른 프로젝트에 남음) 위험. 트랜잭션으로 원자성 보장 + 서브트리 전체를 함께 옮겨 고아 방지. SQLite FK cascade 함정([[reference_sqlite_fk_cascade_migration_wipe]])은 스키마 변경이 아니므로 무관.

## 프론트엔드

### 공용 컴포넌트: `MoveToProjectModal`

`frontend/src/components/project/MoveToProjectModal.tsx` (신규)

props:
- `mode: 'meetings' | 'folder'`
- `meetingIds?: number[]` (mode='meetings')
- `folderId?: number` (mode='folder')
- `sourceProjectId: number`
- `title: string` (회의/폴더 이름, 확인 문구용)
- `onClose: () => void`
- `onMoved: () => void`

동작:
- 프로젝트 후보 = `projects.filter(p => p.role != null && p.id !== sourceProjectId && !isHiddenClutterProject(p))`. 시스템 admin이면 멤버 아닌 것도 포함(`useAuthStore`로 판별, 백엔드 override와 합치).
- 각 항목 `ProjectIcon` + `projectDisplayName(p)`.
- 선택 후 확인 → API 호출 → 성공: 토스트(`n개 이동됨`/`이동 완료`) + `onMoved()`(목록·폴더 갱신) + 닫기. 실패: 에러 메시지.
- 명시색(zinc/indigo). shadcn 시맨틱 토큰 회피([[project_tailwind_theme_tokens]]).

### 진입점

**회의 단건** — `MeetingListUI.tsx`의 ⋯ 메뉴("정보 수정 / 폴더로 이동 / 삭제")에 **"프로젝트 이동"** 추가("폴더로 이동" 아래). 클릭 → `MoveToProjectModal(mode='meetings', meetingIds=[id])`. 콜백으로 부모(`MeetingsPage`)가 모달 상태·목록 갱신 관리.

**폴더** — `FolderTree.tsx`의 폴더별 ⋯ 메뉴("이름 변경 / 하위 폴더 / 비공개 전환 / 중요 / 오타 사전 / 삭제")에 **"프로젝트 이동"** 추가(삭제 위). 클릭 → `MoveToProjectModal(mode='folder', folderId=id)`. 성공 시 폴더트리·회의목록 갱신.

### API 클라이언트

`frontend/src/api/meetings.ts`:
```ts
moveMeetingsToProject(ids: number[], targetProjectId: number):
  Promise<{ moved: number }>
```
`frontend/src/api/folders.ts`:
```ts
moveFolderToProject(folderId: number, targetProjectId: number):
  Promise<{ moved_folders: number; moved_meetings: number }>
```

## 테스트

**백엔드(request/model spec):**
- 회의 이동: 권한 통과 시 project_id 변경+folder_id nil / 비멤버 대상 403 / 비소유 회의 제외(editable_by) / 잠긴 회의 403 / 시스템admin override / 빈 ids 422.
- 폴더 이동: 서브트리 전체 project_id 변경 / 루트 parent_id nil·내부구조 보존 / 회의 folder_id 유지·project_id 변경 / 권한 403 / 고아 미발생(자손 검증) / 사이클 가드.

**프론트(component test):**
- `MoveToProjectModal`: 후보 필터(원본·클러터 제외, 멤버만 / admin 전체), 선택→API 호출, 성공 콜백, 실패 에러표시.
- `MeetingListUI`·`FolderTree` 메뉴에 "프로젝트 이동" 노출(권한 게이팅).

## 미해결·후속

- 회의 일괄 선택/이동 UI(다중선택 인프라).
- 이동 시 대상 폴더 직접 지정.
- 별건: 회의 삭제 웹 무반응 버그(`MeetingsPage.tsx:182` Tauri confirm) — 본 작업과 독립, 같은 세션서 함께 처리 예정.
