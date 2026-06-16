# 프로젝트별 관리 기능 — 설계 (Design Spec)

- 날짜: 2026-06-16
- 브랜치: `feat/project-management`
- 상태: 설계 승인 완료, 구현 계획(writing-plans) 대기

## 1. 목표

회의·폴더를 "프로젝트" 단위로 격리·관리한다.

요구사항(원문, idea.md):
1. 프로젝트 생성 및 정보관리 기능
2. 프로젝트의 사용자 관리
3. 개인 프로젝트는 디폴트로 존재해야 함
4. 할당된 프로젝트만 볼 수 있음
5. 프로젝트 초대 기능
6. 프로젝트의 특징을 잘 나타낼 수 있는 아이콘 할당

## 2. 코드베이스 전제 (탐색 결과)

- **휴면 `teams` 인프라 존재**: `Team`/`TeamMembership`(role admin|member) 모델, `teams_controller`(index/create/invite/remove_member), 라우트(`resources :teams`), meetings/folders/tags의 `team_id` 컬럼. **단 team_id는 항상 null·접근제어 무시·프론트 UI 0 → 완전 미사용.** 따라서 손대도 데이터 리스크 거의 없음.
- **현 접근제어**: `Meeting.accessible_by` = admin이면 전체, member면 본인(created_by) + 공유된(shared) 회의(전역). 폴더는 `shared` 불리언 + 조상 상속(`effectively_shared?`).
- **유저관리**: admin 전용 유저 생성(`/api/v1/admin/users`), 회원가입 기본 비활성(`skip: [:registrations]`). 하이브리드 인증(loopback=desktop@local admin / 원격=JWT). `UserManagementPanel/Modal` 이미 존재.
- **초대 유사물**: 회의 `share_code`(6자 영숫자, 게스트 1회의 참여). 팀 invite는 기존 유저 이메일로 즉시 추가(초대코드 없음).
- **프론트**: React+TS+Tauri, react-router, `AppLayout`(Sidebar/BottomNav), lucide-react 아이콘, zustand 스토어(folder/meeting/ui/auth), `SettingsModal`(Personal/Global 탭, admin 게이팅), `FolderTree`가 사이드바에서 폴더 전환 담당.

## 3. 확정된 결정 사항

| # | 결정 | 값 |
|---|------|-----|
| D1 | 격리 모델 | **엄격 격리 + 전역 admin override**. 멤버는 자기 프로젝트만, 전역 admin은 전부. |
| D2 | 기존 데이터 이전 | 공용 **"기본" 프로젝트** 1개 생성 + 전 유저 멤버 + 기존 회의·폴더·태그 전부 이관 |
| D3 | 생성·관리 권한 | 누구나 생성, 생성자=프로젝트 admin(owner). 프로젝트 admin이 초대·제거·정보수정. 전역 admin은 전체 관리 |
| D4 | 초대 방식 | **초대 링크/코드** (만료·최대횟수). 로그인 유저=합류 / 비로그인=**가입 폼 입력 → 계정 생성 → 합류** |
| D5 | 아이콘 | 통합 피커: `lucide`+색상 / `emoji` / `image` 업로드 중 택1, 미설정 시 이니셜+색 자동 |
| D6 | 전환 UI | 사이드바 상단 **드롭다운**(빠른 전환) + 최상위 **그리드 페이지**(전체 보기·관리) |
| D7 | 구현 접근 | `Team`→`Project` 리네임 + 휴면 인프라 부활 |
| D8 | 프로젝트 삭제 | **비어있을 때만**(회의·폴더 0). 개인 프로젝트는 삭제 불가 |
| D9 | 신규 유저 기본 | 개인 프로젝트만 보유하고 시작("기본"은 이전용 아티팩트, 자동가입 안 함) |
| D10 | admin·개인프로젝트 | 전역 admin은 **남의 개인 프로젝트 포함 전부 열람**(현 god-mode·거버넌스 일관) |
| D11 | 가입 게이트 | 공개 회원가입은 계속 비활성. **유효한 초대코드가 있을 때만** 신규 가입 허용 |

## 4. 데이터 모델

### 4.1 리네임
- `Team` → `Project`, `TeamMembership` → `ProjectMembership`
- `meetings.team_id` / `folders.team_id` / `tags.team_id` → `*.project_id`
- 관련 FK·인덱스 재명명

### 4.2 `projects` 테이블 (기존 teams + 신규 컬럼)
| 컬럼 | 타입 | 비고 |
|------|------|------|
| `name` | string, null:false | 기존 |
| `created_by_id` | integer, null:false | 기존 (owner) |
| `description` | text, nullable | 신규 — 정보관리 |
| `icon_type` | string, nullable | 신규 — `lucide`\|`emoji`\|`image` |
| `icon_value` | string, nullable | 신규 — 아이콘명/이모지/파일경로 |
| `color` | string, nullable | 신규 — 배경색(hex) |
| `personal` | boolean, default:false, null:false | 신규 — 개인 프로젝트 플래그 |

- check_constraint: `icon_type IN ('lucide','emoji','image')` (nullable 허용)
- 개인 프로젝트: `personal:true`, 단독 멤버, 삭제 불가, 초대 불가

### 4.3 `project_memberships` (기존 team_memberships)
- `project_id, user_id, role(admin|member), unique(user_id, project_id)`
- role: `admin`(프로젝트 관리자/owner) · `member`(참여자)

### 4.4 `project_invites` (신규)
| 컬럼 | 타입 | 비고 |
|------|------|------|
| `project_id` | integer, null:false | |
| `code` | string, null:false, unique | 6자 영숫자 (`SecureRandom.alphanumeric(6)`, share_code 패턴) |
| `created_by_id` | integer, null:false | |
| `expires_at` | datetime, nullable | null=무기한 |
| `max_uses` | integer, nullable | null=무제한 |
| `use_count` | integer, default:0, null:false | |

### 4.5 핵심 불변식
- 모든 `meeting`/`folder`/`tag`는 **정확히 한 프로젝트에 소속** (백필 후 `project_id` NOT NULL)
- 유저마다 개인 프로젝트 1개 자동 존재
- 새 회의/폴더/태그의 기본 프로젝트 = 요청의 현재 프로젝트 컨텍스트

## 5. 접근제어 (2단계)

**1단계 — 프로젝트 멤버십**
- 내가 `ProjectMembership`을 가진 프로젝트만 보임
- 전역 `User.admin?` → 모든 프로젝트(개인 포함) 열람·관리

**2단계 — 프로젝트 내부 (기존 규칙 보존, 프로젝트로 스코핑)**
- 프로젝트 멤버는 그 프로젝트의 공유 회의·폴더를 봄
- private 회의(`shared:false`) = 작성자 + 프로젝트 admin
- private 폴더 = 하위 전체 숨김 (기존 `effectively_shared?` 상속 유지)

**코드 변경 지점**
- `Meeting.accessible_by(user, project_id)` — 프로젝트 멤버십 필터 추가. 비멤버=빈결과, admin=전체
- `Folder.tree(user, project_id)` — 동일
- `meeting_lookup.rb`의 `authorize_meeting_read!/control!` — 프로젝트 경계 검증 추가
- `move_to_folder` 등 mutating 경로(`update_all` 우회 주의) — 대상 폴더가 같은 프로젝트인지 검증(권한상승 방지)
- 시리얼라이저(`meeting_serializable.rb`)에 `project_id` 포함

**역할 정리**: 전역 `User.role`(admin/member)는 시스템 거버넌스용 유지. 프로젝트 권한은 `ProjectMembership.role` 별도.

## 6. 마이그레이션 & 백필 (⚠️ 안전 최우선)

> 배경: 과거 잘못된 마이그레이션(`NOT IN` 빈집합 → `destroy_all`)으로 전사·회의록 전멸 사고 발생. 이번 백필은 **파괴 연산 0 · 멱등 · 가드** 원칙.

**M1 — 리네임**: `rename_table teams→projects`, `team_memberships→project_memberships`, `rename_column *.team_id→project_id`. FK 재연결. ⚠️ SQLite는 FK 포함 테이블 리네임 시 테이블 재생성 가능 → 마이그 후 FK 무결성·데이터 보존 검증 필수.

**M2 — 컬럼/테이블 추가** (파괴 없음): `projects`에 `description/icon_type/icon_value/color/personal`, `project_invites` 신규.

**M3 — 백필** (INSERT/UPDATE만, 멱등):
1. "기본" 프로젝트 생성(`personal:false`) — 존재 시 skip
2. 전 유저를 "기본" 멤버로 (`find_or_create_by`). 전역 admin→프로젝트 admin, 그 외 member. owner=가장 오래된/local admin
3. 유저마다 개인 프로젝트 생성(`personal:true`, role admin) — 존재 시 skip
4. `project_id IS NULL`인 meeting/folder/tag → "기본"으로 `UPDATE ... WHERE project_id IS NULL` (절대 `NOT IN`·`destroy` 금지)
- `down`: 데이터 삭제 안 함 → `raise ActiveRecord::IrreversibleMigration`

**M4 — NOT NULL 제약**:
- 사전 가드: `where(project_id: nil).count > 0`이면 `raise`로 중단(무변경). 통과 시에만 meetings/folders/tags.`project_id` NOT NULL 추가.

**운영 안전**:
- 실행 전 DB 백업 + 복사본 선행 테스트
- 준비 전엔 `db/migrate_pending/`에 보관(러닝 dev서버 PendingMigration 500 회피), 이동 후 서버 재시작
- 마이그 후 행 수 검증(meetings/folders/tags 보존, project_id null 0)

## 7. 백엔드 API

- `resources :projects`: index(내것; admin=전체), show, create, update(name/description/icon_*/color), **destroy(비어있을 때만; 개인 불가)**
- `projects/:id/members`: index, role 변경, remove
- `projects/:id/invites`: create(code 생성 + expires_at/max_uses), index, revoke(delete)
- `GET /invite/:code`: 미리보기(프로젝트명·아이콘, 인증 불필요)
- `POST /invite/:code/redeem`:
  - 인증됨(기존 유저) → `ProjectMembership` 추가
  - 비인증 → `{name, email, password}` 입력 받아 **계정 생성(코드 유효성 게이트) → 멤버십 추가 → JWT 발급**
  - 코드 검증: 존재·미만료·`use_count < max_uses` → 통과 시 `use_count += 1`
- 스코핑: meetings/folders/tags index·create에 `project_id` 파라미터(기존 `folder_id` 패턴) + 멤버십 검증
- "현재 프로젝트"는 stateless하게 요청 파라미터로 전달

**보안**: 공개 registrations는 계속 `skip`. 신규 가입은 오직 `invite/:code/redeem`의 유효 코드 경로로만. IDOR/권한상승 방지를 위해 모든 프로젝트 스코프 엔드포인트에서 멤버십 재검증.

## 8. 프론트엔드

- `projectStore`(zustand): `projects[], currentProjectId`, CRUD, members, invites
- **사이드바 상단 드롭다운**: 현재 프로젝트 아이콘+명+▾ → 목록 + "새 프로젝트" (앱 제목 자리)
- **`프로젝트` 그리드 페이지**(신규 라우트): 카드(아이콘·멤버수·회의수) + "새 프로젝트". admin=전체 표시
- 생성/편집 다이얼로그: name·description·**아이콘 피커(3탭: 아이콘/이모지/업로드)**·color
- 프로젝트 설정: 멤버 목록(role·remove)·초대코드 생성(링크복사·만료·최대횟수)·삭제(비어있을 때만 활성)
- **`/invite/:code` 라우트**: 미리보기 → (로그인)합류 버튼 / (비로그인)가입 폼(name/email/password)
- `currentProjectId`로 폴더트리·회의목록 스코핑. 프로젝트 전환 시 폴더 선택 리셋
- 초기 `currentProjectId` = 마지막 선택(localStorage) → 없으면 개인 프로젝트
- `ProjectIcon` 컴포넌트: 3타입 렌더 + 이니셜+색 폴백
- `image` 타입: 기존 업로드/리사이즈 헬퍼 재사용해 디스크에 저장(별도 projects 경로), `icon_value`에 파일 경로 보관. `meeting_attachments` 테이블은 쓰지 않음(회의 전용이므로). 정사각 크롭

## 9. 테스트 (TDD, 서브에이전트 실행)

**백엔드**
- 모델: Project(validations, personal 규칙, destroy 가드), ProjectMembership(unique), ProjectInvite(만료·max_uses·use_count), `Meeting.accessible_by`/`Folder.tree` 프로젝트 필터
- 초대 redeem 양경로(기존 유저 합류 / 신규 가입+합류), 코드 무효·만료·초과 거부
- 인가: 비멤버 접근 차단, admin override, 권한상승(타 프로젝트 폴더로 이동) 차단
- **마이그레이션 테스트**: 백필 멱등(2회 실행 안전)·project_id null 0·행 수 보존·파괴연산 부재

**프론트엔드**
- projectStore, 스위처 드롭다운, 그리드 페이지, 생성/편집 다이얼로그, 초대 리딤(양경로), 폴더/회의 스코핑, ProjectIcon 폴백

## 10. 롤아웃

- 브랜치 `feat/project-management`
- 마이그레이션 `migrate_pending` 보관 → 백업 → 복사본 테스트 → 이동 → 서버 재시작
- 전수 컴파일 검증(`vite build` + 백엔드 test) 후 기기 E2E
- 커밋은 명시 요청 시에만(no-auto-commit 방침)

## 11. 보류 (YAGNI, v2 후보)

- 프로젝트 간 회의/폴더 이동
- 이메일 알림 기반 초대(수락/거절 플로)
- 글로사리/프롬프트 템플릿의 프로젝트 소유(현재는 폴더 통한 자동 상속·전역 유지)
- soft-archive(보관) 삭제

## 12. 미해결 질문

없음 (모든 결정 D1–D11에서 확정).
