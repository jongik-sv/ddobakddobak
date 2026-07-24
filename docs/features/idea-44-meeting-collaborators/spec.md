# Feature: idea-44-meeting-collaborators

## 목적

feature: idea.md 44번.
1. (버그) 회의 편집 UI가 소유권(`editable`)을 무시하고 `locked`만 체크 — 소유자 아닌데 편집 가능한 것처럼 보이다가 저장은 서버가 403으로 조용히 막음. `canEditMeeting(meeting, user) && !locked` 로 게이팅.
2. (기능) 폴더 단위 협업자 지정 + 회의로 실시간 상속. Unix 디렉터리 권한처럼: 폴더에 협업자를 지정하면 그 폴더(및 하위 폴더) 밑의 모든 회의가 즉시 그 협업자들에게 편집권을 갖는다. 회의 개별 협업자 지정도 가능(폴더 상속과 별개로 추가).

## 성공 기준

단위테스트 통과 (E2E 생략).
- backend(RSpec): `Meeting#editable_by?`, `Folder` 협업자 상속(조상 체인, 사이클 가드), `authorize_meeting_control!`, collaborator CRUD API(회의/폴더 양쪽)
- frontend(vitest): `canEditMeeting` 와이어링 4곳, 협업자 관리 UI

## 도메인

fullstack

## 범위 경계

- 포함: backend, frontend, database/migration
- 제외: E2E, docs

## 제약

기존 API 호환성 유지 — `meeting_json`의 `editable` 필드는 그대로(boolean), 의미만 `owner||admin` → `owner||admin||collaborator(직접+폴더상속)` 로 확장. 기존 소비자(canEditMeeting 등) 코드 변경 불필요.

## 데이터 모델

**신규 테이블 2개** (기존 `project_memberships` 패턴 재사용 — `role` 불필요, 있으면/없으면 이진 판단):

```
meeting_collaborators
  meeting_id  FK, not null
  user_id     FK, not null
  created_at
  unique index [meeting_id, user_id]

folder_collaborators
  folder_id   FK, not null
  user_id     FK, not null
  created_at
  unique index [folder_id, user_id]
```

**상속 규칙 (실시간, 스냅샷 아님)**: 회의의 유효 협업자 = 자신의 `meeting_collaborators` ∪ 소속 폴더의 `folder_collaborators` ∪ 그 폴더의 모든 조상 폴더의 `folder_collaborators`. 폴더 협업자를 바꾸면 그 밑 기존 회의에도 즉시 반영됨.

기존 `Folder#ancestor_records`(사이클 가드 있는 조상 체인, `folder.rb:37`)를 그대로 재사용해 `Folder#collaborator?(user)` 구현. 기존 `Folder#effectively_shared?`(`folder.rb:67`)와 동일한 순회 패턴.

주의: `Folder#editable_by?`(`folder.rb:29`, "폴더 자체를 편집(이름변경 등)할 권한")는 이번 기능과 **다른 개념** — 헷갈리지 않게 새 메서드는 `Folder#collaborator?`로 명명(폴더 자체 편집권이 아니라 "이 폴더 밑 회의들에 상속되는 협업자인가").

## 권한 로직 변경

- `Meeting#editable_by?(user)`: `admin? || owner? || MeetingCollaborator.exists?(meeting_id: id, user_id: user.id) || folder&.collaborator?(user)`
- `meeting_lookup.rb#authorize_meeting_control!`: 위와 동일 조건 사용하도록 통일(현재는 `meeting_admin? || owner?`만 — collaborator 분기 추가)
- 협업자 추가/제거 권한: 소유자 + admin만 (회의 협업자는 소유자, 폴더 협업자는 폴더 내 회의 소유자 아무나 + admin — 폴더에 소유 컬럼이 없으므로 `Folder#editable_by?` 재사용)
- 협업자 대상 제한: `update_owner` 액션과 동일 — 같은 프로젝트 멤버(`ProjectMembership.exists?`)만 지정 가능

## API

- `POST/DELETE /api/v1/meetings/:id/collaborators` (user_id)
- `GET /api/v1/meetings/:id/collaborators` (직접 지정분 + 상속분 구분해서 응답 — UI에서 "폴더에서 상속됨" 표시용)
- `POST/DELETE /api/v1/folders/:id/collaborators` (user_id)
- `GET /api/v1/folders/:id/collaborators`

## 진입점 (Entry Points)

- 사용자 진입 경로: 회의 상세 페이지 헤더/설정 메뉴 → "협업자 관리" (신규 UI 요소) / 폴더 트리 우클릭 또는 폴더 설정 → "협업자 관리"
- URL / 라우트: 기존 회의 상세(`/meetings/:id`) · 폴더 트리 내 모달로 처리, 별도 라우트 없음
- 수정할 파일: `meetingDetailTabs.tsx`, `MeetingPage.tsx`, `MeetingLivePage.tsx`, `useLiveMobileTabs.tsx`(editable 와이어링), `EditableTranscriptText` 사용처 3곳, `SpeakerPanel` readOnly, 폴더 트리 컴포넌트(협업자 관리 진입점 추가)
- 수정할 메뉴·네비게이션: 폴더 트리 컨텍스트 메뉴, 회의 상세 헤더 메뉴

## 비고

`update_owner`(소유자 이관, 단일)는 그대로 유지 — 이번 기능은 "추가 편집권 부여"(다중, 철회 가능)로 별개 개념. 두 메커니즘 공존.
