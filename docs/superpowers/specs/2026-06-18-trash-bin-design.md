# 휴지통(Trash Bin) 설계

- 날짜: 2026-06-18
- 브랜치: `feat/trash-bin`
- 범위: 회의(Meeting)·폴더(Folder)·프로젝트(Project) soft-delete → 휴지통 → 복구·영구삭제

## 1. 목표

회의·폴더·프로젝트를 삭제하면 즉시 영구 제거되지 않고 **휴지통**으로 이동한다. 사용자는 휴지통에서 항목을 **복구**하거나 **영구삭제**할 수 있다. 폴더·프로젝트를 삭제하면 그 안의 회의·하위폴더가 **함께 휴지통으로 이동하고 함께 복구**된다.

## 2. 결정 사항 (확정)

| 항목 | 결정 |
|------|------|
| Cascade | 폴더/프로젝트 삭제 시 내용물 같이 휴지통행 + 같이 복구 |
| 휴지통 범위 | 사용자별 통합 휴지통 (`deleted_by_id == me`), admin은 전체 |
| 보관 기간 | 무기한. 자동 영구삭제 없음(수동만) |
| 영구삭제·비우기 권한 | root 항목 소유자. **admin은 비소유자도 가능** |
| 메커니즘 | 수동 `deleted_at` 컬럼 + `Trashable` concern + 명시적 scope. `default_scope` 안 씀 |
| live 회의 | 삭제(휴지통행) 허용 — 현행 유지 |

## 3. 데이터 모델

`meetings`, `folders`, `projects` 세 테이블에 nullable 컬럼 추가:

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `deleted_at` | datetime, index | 휴지통행 시각. null=정상 |
| `deleted_by_id` | integer (users FK, nullable) | 삭제 실행자 |
| `trash_group_id` | string (uuid), index | 한 번의 cascade 삭제 묶음 식별자 |
| `trashed_as_root` | boolean default false, null:false | 사용자가 직접 누른 항목=true. 휴지통 목록에 노출되는 행 |

### SQLite 안전성 (필수 준수)

- **추가형 nullable 컬럼만 추가** → 테이블 재생성(rename/FK 변경) 없음 → `ON DELETE CASCADE` 자식 전멸·`foreign_keys=OFF` 무효화 지뢰(reference_sqlite_fk_cascade_migration_wipe) 회피
- 마이그레이션은 `add_column`/`add_index`만. `disable_ddl_transaction!` 불필요
- db/migrate 추가만으로 러닝 dev 서버가 PendingMigrationError 500 → 마이그레이션 후 서버 재시작 (feedback_rails_pending_migration_trap)

## 4. Trashable concern

`app/models/concerns/trashable.rb`:

- scope `kept` → `where(deleted_at: nil)`
- scope `trashed` → `where.not(deleted_at: nil)`
- `trashed?` → `deleted_at.present?`
- `soft_delete!(by:, group:, root: false)` → `deleted_at`=현재시각, `deleted_by_id`=by, `trash_group_id`=group, `trashed_as_root`=root (단일 update, 콜백 없이)
- `restore!` → 위 4컬럼 초기화
- **`default_scope` 사용 금지** (default_scope·연관 누수 위험, 이 repo 데이터손실 이력)

Meeting·Folder·Project 모델에 `include Trashable`.

## 5. Cascade — 묶음 삭제·복구

### 삭제(휴지통행)

`Trash::SoftDeleter` 서비스 (또는 모델 메서드). 한 번의 삭제 = 하나의 `trash_group_id`(uuid).

- **회의 단독**: 그 회의만 `soft_delete!(root: true)`
- **폴더**: 폴더(root) + 모든 하위폴더(재귀) + 그 폴더트리 안 `kept` 회의 → 전부 같은 group, root는 클릭한 폴더만
- **프로젝트**: 프로젝트(root) + 그 프로젝트의 `kept` 폴더·`kept` 회의 → 전부 같은 group

이미 휴지통에 있던 하위 항목(다른 group)은 **건드리지 않음**(자기 group 유지). `kept` 항목만 흡수.

### 복구·영구삭제 단위

- 휴지통 목록 = `trashed.where(trashed_as_root: true)` 행만 (사용자가 실제 누른 항목)
- **복구/영구삭제는 group 단위 통째**: 같은 `trash_group_id` 행 전부 대상
- 복구: group 내 모든 행 `restore!`
- 영구삭제: group 내 모든 행 실제 `destroy` (오디오 파일 포함, §7)

### 복구 엣지 케이스

- 단일 group 복구 시 상위 컨테이너가 **여전히 휴지통**인 경우는 group 설계상 거의 없음(컨테이너를 지우면 자식도 같은 group). 다만 안전망:
  - 회의 복구 후 `folder_id`가 가리키는 폴더가 trashed면 → `folder_id=nil`(프로젝트 root)로 detach
  - 폴더 복구 후 `project_id` 프로젝트가 trashed면 → 차단, "상위 프로젝트를 먼저 복구하세요" 반환
- `previous_meeting_id`가 trashed 회의를 가리켜도 `belongs_to optional`이라 깨지지 않음. 셀렉터에서 trashed 제외(§6)

## 6. Read 경로 필터 (`.kept`)

`default_scope`를 안 쓰므로 **모든 조회 진입점에 `.kept` 명시**. 구현 plan에서 `Meeting.`/`Folder.`/`Project.` query root 및 연관 조회를 전수 grep하여 적용. 최소 대상:

- `Meeting.accessible_by` scope, 회의 index, 검색/FTS scope
- 폴더 index·트리, 폴더별 회의 목록
- 프로젝트 index, 프로젝트별 회의수 카운트
- 이전 회의(previous_meeting) 셀렉터
- 대시보드 recent/important 목록
- 회의 상세·chat 접근(휴지통 회의는 404 또는 trashed 표시)

검증: request 스펙에서 "trashed 항목이 각 목록/검색에 안 나온다" 단언.

## 7. 오디오 파일

- **휴지통행**: 오디오 파일 보존 (삭제 안 함)
- **영구삭제**: `FileUtils.rm_f(meeting.audio_file_path)` 후 `destroy`
- 현 `meetings#destroy`의 파일삭제+destroy 로직을 **purge 경로로 이동**

## 8. API — `Api::V1::TrashController`

| 메서드 | 경로 | 동작 | 권한 |
|--------|------|------|------|
| (변경) DELETE | `/meetings/:id`, `/folders/:id`, `/projects/:id` | destroy → **soft-delete(휴지통행)** | 현행 삭제 권한 그대로 |
| GET | `/trash` | 내 휴지통 root 항목 목록(타입·이름·삭제일·삭제자·group_id) | 로그인. admin은 전체 |
| POST | `/trash/:type/:id/restore` | group 통째 복구 | 삭제자/owner/admin |
| DELETE | `/trash/:type/:id` | group 통째 영구삭제 | root 소유자. admin 가능 |
| DELETE | `/trash` | 휴지통 비우기(내 항목 전체 영구삭제) | 본인 항목. admin 옵션 |

- `:type` ∈ `meeting|folder|project`
- 기존 destroy 액션 3곳을 soft-delete로 교체. 영구삭제 로직은 TrashController(또는 `Trash::Purger`)로
- 권한 헬퍼: 영구삭제·비우기는 `current_user == 소유자 || current_user.admin?`

## 9. 프론트엔드

- 사이드바/상단 메뉴에 **"휴지통"** 진입점
- `TrashPage`: 항목 리스트 — 타입 배지(회의/폴더/프로젝트), 이름, 삭제일, 삭제자, [복구] [영구삭제] 버튼, 상단 [휴지통 비우기]
- 폴더/프로젝트 항목은 "회의 N개 포함" 등 묶음 규모 표시
- 기존 삭제 버튼 동작: 엔드포인트 동일(soft-delete로 서버측 변경)이라 호출부 변경 최소. 확인 다이얼로그 문구만 "휴지통으로 이동"으로
- API 클라이언트 `frontend/src/api/trash.ts`

## 10. 테스트 (TDD)

- **모델 스펙**: `Trashable` concern(kept/trashed/soft_delete!/restore!), cascade 삭제(폴더·프로젝트 트리), 복구 묶음, 이미-trashed 항목 미간섭
- **request 스펙**: TrashController 4액션, 권한(삭제자/owner/admin/타인 차단), read-path 제외(목록·검색·트리에 trashed 안 나옴), 영구삭제 시 오디오 파일 삭제, live 회의 휴지통행 허용
- **프론트**: TrashPage 렌더·복구/영구삭제 호출, trash.ts api

## 11. 리스크·완화

| 리스크 | 완화 |
|--------|------|
| 마이그레이션 데이터손실 | 추가형 nullable 컬럼만, 테이블 재생성 없음 |
| default_scope 누수 | 안 씀. 명시적 `.kept` + request 스펙 단언 |
| read 경로 누락(trashed 노출) | query root 전수 grep + 스펙 |
| 러닝 dev 서버 PendingMigration 500 | 마이그 후 서버 재시작 |
| FTS/이전회의 셀렉터 누락 | 명시 대상에 포함 |

## 12. 비범위 (YAGNI)

- 자동 영구삭제(N일) — 수동만
- 단일 하위 항목 복구 UI — group 단위 복구만 (엣지 detach 안전망은 있음)
- 휴지통 항목 검색·정렬 고급 기능
