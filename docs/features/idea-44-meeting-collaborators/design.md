# idea-44-meeting-collaborators: 설계

## 요구사항 확인
- (버그) 회의 편집 UI가 `editable`(소유권)을 무시하고 `locked`만 체크하는 지점이 다수 존재 — 저장 시 서버 403으로 조용히 실패.
- (기능) 폴더 단위 협업자 지정 → 하위 폴더·회의로 실시간 상속(스냅샷 아님). 회의 개별 협업자 지정도 별도 가능(가산).
- 기존 API 호환 유지: `meeting_json.editable`은 그대로 boolean, 의미만 `owner||admin` → `owner||admin||collaborator(직접+폴더상속)`로 확장. `canEditMeeting` 등 소비자 코드는 무변경.

## 타겟 앱
- **경로**: N/A — 단일 워크스페이스가 아닌 `backend/`(Rails) + `frontend/`(React/Tauri) 이원 구조. 모든 경로는 루트 기준으로 `backend/`·`frontend/` 접두어를 포함해 표기.
- **근거**: 루트에 workspace manifest 없음(각자 독립 앱). fullstack 기능이므로 양쪽 모두 수정.

## 구현 방향
1. `meeting_collaborators`/`folder_collaborators` 조인 테이블 2개 신설(`project_memberships` 패턴 재사용, role 없이 존재 유무로 판단).
2. `Meeting#editable_by?`와 `Folder`에 `collaborator?` 신설, 인가 게이트(`meeting_lookup.rb`)에 반영. **읽기 게이트도 함께 확장**해야 폴더-상속 협업자가 비공유(private) 회의에 접근 가능(아래 "권한 모델" 참조 — spec 원문이 명시한 `authorize_meeting_control!`만으로는 read 단계에서 403이 먼저 발생해 기능이 동작하지 않음).
3. 협업자 CRUD 컨트롤러 액션 4종(회의 2 + 폴더 2, 조회는 index 스타일 GET 1개로 합침) — 회의 쪽은 spec이 명시한 대로 **소유자+admin만**(제어 게이트보다 좁음, 협업자 자신이 협업자를 못 늘리게), 폴더 쪽은 기존 `Folder#editable_by?` 재사용.
4. 프론트: 기존 `DomainFilesPanel`(ownerType 공용 패턴)을 그대로 본떠 `CollaboratorsPanel`(meeting/folder 공용) + `useCollaborators` 훅 신설. 회의는 `EditMeetingDialog`에 섹션으로 삽입(도메인 파일·소유자 이관과 같은 자리), 폴더는 `FolderTree.tsx`의 기존 "···" 드롭다운에 신규 항목 + `FolderCollaboratorsDialog` 신설(`DomainFilesDialog`와 동형).
5. `editable` 와이어링 버그: 실제 코드 확인 결과 프롬프트가 지목한 4곳보다 세분화된 **6개 파일, 9개 지점**(+ 1개 훅 시그니처 확장)이 발견됨 — 정확한 위치는 "파일 계획"·"주요 구조" 참조.

## 파일 계획

**경로 기준:** 프로젝트 루트 기준(`backend/`·`frontend/` 접두어 포함).

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `backend/db/migrate/20260723000001_create_meeting_collaborators.rb` | `meeting_collaborators` 테이블 생성 | 신규 |
| `backend/db/migrate/20260723000002_create_folder_collaborators.rb` | `folder_collaborators` 테이블 생성 | 신규 |
| `backend/db/schema.rb` | 마이그레이션 실행(`rails db:migrate`) 후 자동 갱신 — 수동 편집 금지 | 자동수정 |
| `backend/app/models/meeting_collaborator.rb` | `MeetingCollaborator` AR 모델(belongs_to meeting/user + uniqueness) | 신규 |
| `backend/app/models/folder_collaborator.rb` | `FolderCollaborator` AR 모델(동형) | 신규 |
| `backend/app/models/meeting.rb` | `has_many :meeting_collaborators` 추가, `editable_by?` 확장 | 수정 |
| `backend/app/models/folder.rb` | `has_many :folder_collaborators` 추가, `collaborator?(user)` 신설 | 수정 |
| `backend/app/controllers/concerns/meeting_lookup.rb` | `authorize_meeting_read!`/`authorize_meeting_control!`에 협업자 분기 추가(공용 헬퍼 `meeting_collaborator?`) | 수정 |
| `backend/app/controllers/api/v1/meetings_controller.rb` | `collaborators`/`add_collaborator`/`remove_collaborator` 액션 3개 + `authorize_meeting_collaborator_admin!`(소유자+admin 전용 게이트) + before_action 갱신 | 수정 |
| `backend/app/controllers/api/v1/folders_controller.rb` | 동형 액션 3개(`authorize_folder_edit!` 재사용) + before_action 갱신 | 수정 |
| `backend/config/routes.rb` | 회의/폴더 각각 `collaborators` GET/POST + `collaborators/:user_id` DELETE 라우트 | 수정 |
| `frontend/src/api/meetings/collaborators.ts` | 회의 협업자 GET/POST/DELETE API 클라이언트 + 타입 | 신규 |
| `frontend/src/api/meetings.ts` | barrel export에 `./meetings/collaborators` 추가 | 수정 |
| `frontend/src/api/folders.ts` | 폴더 협업자 타입 + GET/POST/DELETE 함수 추가 | 수정 |
| `frontend/src/hooks/useCollaborators.ts` | `useDomainFiles` 동형 패턴 — direct/inherited/projectMembers 상태 + CRUD, `ownerType: 'meeting'\|'folder'` | 신규 |
| `frontend/src/components/meeting/CollaboratorsPanel.tsx` | 협업자 목록(직접/상속 뱃지) + 추가(프로젝트 멤버 셀렉트)·제거 UI, meeting/folder 공용 | 신규 |
| `frontend/src/components/meeting/EditMeetingDialog.tsx` | "협업자" 섹션 삽입(소유자 이관 섹션 옆) + `canManageCollaborators` 계산 + `projectMembers` fetch 조건 확장 | 수정 |
| `frontend/src/components/folder/FolderCollaboratorsDialog.tsx` | `DomainFilesDialog`와 동형의 폴더 협업자 다이얼로그 | 신규 |
| `frontend/src/components/folder/FolderTree.tsx`(메뉴·내비게이션) | "···" 드롭다운에 "협업자 관리" 항목 추가 + 다이얼로그 상태·렌더 | 수정 |
| `frontend/src/components/meeting/meetingDetailTabs.tsx` | `SpeakerPanel`·`MemoEditorPanel`의 `readOnly` 와이어링 버그 수정(2곳) | 수정 |
| `frontend/src/pages/MeetingPage.tsx` | 동형 버그 수정(2곳) | 수정 |
| `frontend/src/pages/MeetingLivePage.tsx` | `SpeakerPanel`·`AiSummaryPanel`·`RecordTabPanel`의 `readOnly`/`editable` 미와이어링 수정(3곳) + `useLiveMobileTabs`에 `canEdit` 전달 | 수정 |
| `frontend/src/hooks/useLiveMobileTabs.tsx` | `canEdit` prop 신설 + `SpeakerPanel`·`AiSummaryPanel`·`RecordTabPanel`·`MeetingEditor`에 배선(4곳) | 수정 |

> 이 표에 라우터(`router`/`routes`/`App.tsx`) 신규 행이 없는 이유와 "메뉴·내비게이션" 판정 근거는 아래 "진입점" 섹션 말미에 명시.

## 진입점 (Entry Points)

이 기능은 **신규 페이지·신규 URL이 없다** — spec.md가 이미 명시("모달로 처리, 별도 라우트 없음"). 기존 회의 상세 페이지·폴더 트리(사이드바)에 삽입되는 모달/드롭다운 확장이므로 template.md의 "비-페이지 UI" 규정(적용될 상위 페이지 1개 이상 기입)을 적용한다.

- **사용자 진입 경로(회의)**: 회의 상세 페이지 진입 → 상단 툴바 "수정"(연필) 아이콘 클릭 → `EditMeetingDialog` 오픈 → "협업자" 섹션에서 추가/제거.
- **사용자 진입 경로(폴더)**: 사이드바 폴더 트리 → 대상 폴더의 "···" 버튼 클릭 → 드롭다운에서 "협업자 관리" 클릭 → `FolderCollaboratorsDialog` 오픈.
- **URL / 라우트**: 없음(모달). 적용될 상위 페이지: `/meetings/:id`(`MeetingPage.tsx`, 기존 라우트 재사용), 사이드바(모든 페이지 공통, 폴더 트리는 라우트 무관하게 상시 렌더).
- **수정할 라우터 파일**: N/A — 신규 라우트 없음. 라우터(`frontend/src/App.tsx` 등) 변경 불필요.
- **수정할 메뉴·내비게이션 파일**: `frontend/src/components/folder/FolderTree.tsx`(폴더 컨텍스트 메뉴 — line 229 `handleToggleShared` 버튼과 line 249 "오타 사전" 버튼 사이, "도메인 파일" 항목 직후에 "협업자 관리" `<button>` 삽입) + `dialog state`(`showCollaboratorsDialog`) 추가.
- **연결 확인 방법**: 사이드바에서 폴더 "···" 클릭 → "협업자 관리" 클릭 → 다이얼로그가 열리고 프로젝트 멤버 목록이 셀렉트에 채워짐. 회의 상세 → 수정 아이콘 클릭 → "협업자" 섹션이 보이고 추가/제거가 목록에 즉시 반영됨.

> **라우터 파일 부재에 대한 판단 근거**: 이 기능은 orphan-page 위험이 없다(신규 페이지 자체가 없음) — 라우터 게이트가 방지하려는 사고(신규 페이지를 만들고 메뉴에 연결을 잊는 것)가 구조적으로 발생할 수 없는 케이스. "메뉴·내비게이션" 요건은 `FolderTree.tsx`(실질적인 폴더 컨텍스트 메뉴)로 충족.

## 주요 구조

### 백엔드 모델
- `MeetingCollaborator`(`belongs_to :meeting, :user`, `validates :user_id, uniqueness: { scope: :meeting_id }`) — `backend/app/models/meeting_collaborator.rb` 신규.
- `FolderCollaborator`(동형) — `backend/app/models/folder_collaborator.rb` 신규.
- `Meeting#editable_by?(user)` (`backend/app/models/meeting.rb:212-215`) 확장:
  ```ruby
  def editable_by?(user)
    return false unless user
    (user.respond_to?(:admin?) && user.admin?) || created_by_id == user.id ||
      MeetingCollaborator.exists?(meeting_id: id, user_id: user.id) ||
      (folder&.collaborator?(user) || false)
  end
  ```
  `has_many :meeting_collaborators, dependent: :destroy`를 `meeting.rb:19`(`meeting_bookmarks`) 다음 줄에 추가.
- `Folder#collaborator?(user)` 신설(`backend/app/models/folder.rb`, `effectively_shared?`(line 67-76) 바로 다음에 삽입):
  ```ruby
  # 이 폴더 밑 회의들에 상속되는 협업자인가(자신 + 모든 조상). 폴더 자체 편집권(editable_by?)과는 다른 개념.
  def collaborator?(user)
    return false unless user
    FolderCollaborator.where(folder_id: [ id ] + ancestor_records.map(&:id), user_id: user.id).exists?
  end
  ```
  `has_many :folder_collaborators, dependent: :destroy`를 `folder.rb:7`(`has_many :meetings`) 다음 줄에 추가. `ancestor_records`가 이미 사이클 가드를 갖고 있으므로 재사용만으로 안전.

### 권한 모델 (meeting_lookup.rb) — 핵심 설계 결정
spec 원문은 `authorize_meeting_control!`만 언급하지만, `set_meeting`이 모든 액션 진입 시 **먼저** `authorize_meeting_read!`를 호출한다(`meeting_lookup.rb:13`). 읽기 게이트는 현재 `owner? || (project_member? && shared_visible?)`만 허용 — 폴더-상속 협업자가 접근해야 하는 대상은 대개 **비공유(private) 회의**(spec의 핵심 유스케이스)이므로, 읽기 게이트를 확장하지 않으면 제어 게이트에 도달하기 전에 403이 난다. 따라서 **읽기·제어 게이트 양쪽에 협업자 분기를 추가**한다. 공용 헬퍼로 중복을 막고, 기존 `meeting_admin?`(개인 프로젝트 admin override 예외 포함)은 그대로 보존한다(`Meeting#editable_by?`의 raw `admin?`과는 별개로 유지 — 기존에도 이미 다른 기준이었음, 이번에 섞지 않음).

`backend/app/controllers/concerns/meeting_lookup.rb` diff:
```ruby
def authorize_meeting_read!
  return if meeting_admin?
  return if @meeting.owner?(current_user)
  return if meeting_collaborator?(@meeting)                        # 추가
  return if project_member?(@meeting) && @meeting.shared_visible?

  render json: { error: "이 회의에 접근할 권한이 없습니다" }, status: :forbidden
end

def authorize_meeting_control!
  return if meeting_admin?
  return if @meeting.owner?(current_user)
  return if meeting_collaborator?(@meeting)                        # 추가

  render json: { error: "회의를 제어할 권한이 없습니다" }, status: :forbidden
end

# 신설: 직접 지정 협업자 또는 소속 폴더(및 조상)의 협업자인지.
def meeting_collaborator?(meeting)
  MeetingCollaborator.exists?(meeting_id: meeting.id, user_id: current_user.id) ||
    (meeting.folder&.collaborator?(current_user) || false)
end
```

**협업자 CRUD 자체의 권한은 이보다 좁다** — spec: "협업자 추가/제거 권한: 소유자 + admin만". `authorize_meeting_control!`을 재사용하면 협업자가 스스로를 포함해 협업자를 늘릴 수 있는 권한 상승 버그가 되므로, 전용 게이트를 `MeetingsController` private 섹션(`can_transfer_meeting_owner?`/`authorize_lock!` 근처, `meetings_controller.rb:807` 부근)에 별도로 둔다:
```ruby
# 협업자 추가/제거 권한: 소유자 + 시스템 admin만(authorize_meeting_control!보다 좁음 — 협업자 자신은 협업자를 못 늘림).
def authorize_meeting_collaborator_admin!
  return if meeting_admin?
  return if @meeting.owner?(current_user)

  render json: { error: "협업자를 관리할 권한이 없습니다" }, status: :forbidden
end
```
폴더 쪽은 spec이 명시한 대로 기존 `Folder#editable_by?`(=admin 또는 이 폴더 직속 회의 소유자)를 그대로 재사용 — `authorize_folder_edit!`에 신규 액션만 추가하면 된다(비대칭이지만 spec이 의도한 차이).

### 컨트롤러 액션 (신규 4종 + 조회 통합 → 실제 6개 엔드포인트)

**`backend/app/controllers/api/v1/meetings_controller.rb`**
- `before_action :set_meeting, only: %i[..., collaborators add_collaborator remove_collaborator]` (line 14 목록에 3개 추가)
- `before_action :authorize_meeting_collaborator_admin!, only: %i[add_collaborator remove_collaborator]` (신규 줄, line 16 근처)
- `reject_if_locked!`(line 18)에는 **추가하지 않음** — 협업자 관리는 콘텐츠 편집이 아니라 접근권한 관리이므로 잠금과 무관(설계 결정).
- 액션 3개를 `update_owner`(line 174-188) 다음, `def update`(line 190) 이전에 삽입:
  ```ruby
  # GET /api/v1/meetings/:id/collaborators — 직접 지정 + 폴더 상속분(구분, UI "폴더에서 상속됨" 표시용).
  def collaborators
    direct_ids = MeetingCollaborator.where(meeting_id: @meeting.id).pluck(:user_id)
    direct = ::User.where(id: direct_ids).map { |u| collaborator_json(u) }

    inherited = []
    if @meeting.folder
      seen = direct_ids.to_set
      ([ @meeting.folder ] + @meeting.folder.ancestor_records).each do |fld|
        FolderCollaborator.where(folder_id: fld.id).includes(:user).each do |fc|
          next if seen.include?(fc.user_id)
          seen << fc.user_id
          inherited << collaborator_json(fc.user).merge(folder_id: fld.id, folder_name: fld.name)
        end
      end
    end
    render json: { direct: direct, inherited: inherited }
  end

  # POST /api/v1/meetings/:id/collaborators — 대상은 이 회의 프로젝트 멤버만(update_owner와 동일 제약).
  def add_collaborator
    target = ::User.find_by(id: params[:user_id])
    return render json: { error: "사용자를 찾을 수 없습니다" }, status: :not_found unless target
    unless @meeting.project_id && ProjectMembership.exists?(project_id: @meeting.project_id, user_id: target.id)
      return render json: { error: "프로젝트 멤버만 협업자로 지정할 수 있습니다" }, status: :unprocessable_entity
    end
    collaborator = MeetingCollaborator.find_or_create_by!(meeting_id: @meeting.id, user_id: target.id)
    render json: { collaborator: collaborator_json(collaborator.user) }, status: :created
  end

  # DELETE /api/v1/meetings/:id/collaborators/:user_id
  def remove_collaborator
    collaborator = MeetingCollaborator.find_by(meeting_id: @meeting.id, user_id: params[:user_id])
    return render json: { error: "협업자를 찾을 수 없습니다" }, status: :not_found unless collaborator
    collaborator.destroy
    head :no_content
  end
  ```
- `authorize_meeting_collaborator_admin!` + `collaborator_json(user) = { user_id: user.id, name: user.name, email: user.email }` 헬퍼를 private 섹션(line ~807 부근, `member_json` 패턴과 동일)에 추가.

**`backend/app/controllers/api/v1/folders_controller.rb`** — 동형, `update_domain_files`(line 103-122) 다음·`private`(line 124) 이전에 삽입:
- `before_action :set_folder`(line 7)에 `collaborators add_collaborator remove_collaborator` 추가.
- `before_action :authorize_folder_edit!`(line 8)에는 `add_collaborator remove_collaborator`**만** 추가(GET `collaborators`는 project members GET과 동일하게 비관리자도 조회 가능).
  ```ruby
  def collaborators
    direct_ids = FolderCollaborator.where(folder_id: @folder.id).pluck(:user_id)
    direct = ::User.where(id: direct_ids).map { |u| collaborator_json(u) }
    inherited = []
    seen = direct_ids.to_set
    @folder.ancestor_records.each do |fld|
      FolderCollaborator.where(folder_id: fld.id).includes(:user).each do |fc|
        next if seen.include?(fc.user_id)
        seen << fc.user_id
        inherited << collaborator_json(fc.user).merge(folder_id: fld.id, folder_name: fld.name)
      end
    end
    render json: { direct: direct, inherited: inherited }
  end

  def add_collaborator
    target = ::User.find_by(id: params[:user_id])
    return render json: { error: "사용자를 찾을 수 없습니다" }, status: :not_found unless target
    unless @folder.project_id && ProjectMembership.exists?(project_id: @folder.project_id, user_id: target.id)
      return render json: { error: "프로젝트 멤버만 협업자로 지정할 수 있습니다" }, status: :unprocessable_entity
    end
    collaborator = FolderCollaborator.find_or_create_by!(folder_id: @folder.id, user_id: target.id)
    render json: { collaborator: collaborator_json(collaborator.user) }, status: :created
  end

  def remove_collaborator
    collaborator = FolderCollaborator.find_by(folder_id: @folder.id, user_id: params[:user_id])
    return render json: { error: "협업자를 찾을 수 없습니다" }, status: :not_found unless collaborator
    collaborator.destroy
    head :no_content
  end
  ```
  `collaborator_json` 헬퍼를 private 섹션에 추가(회의 쪽과 동일 shape).

### 라우트 (`backend/config/routes.rb`)
회의 member 블록(`routes.rb:74` `patch :owner` 다음):
```ruby
get    :collaborators
post   :collaborators, action: :add_collaborator
delete "collaborators/:user_id", action: :remove_collaborator, as: :remove_meeting_collaborator
```
폴더 member 블록(`routes.rb:126` `put :domain_files` 다음):
```ruby
get    :collaborators
post   :collaborators, action: :add_collaborator
delete "collaborators/:user_id", action: :remove_collaborator, as: :remove_folder_collaborator
```
(`projects_controller`의 `members`/`members/:user_id` 패턴과 동형 — 프로젝트 쪽 `as: :remove_member` 참고.)

### 프론트 API 클라이언트
`frontend/src/api/meetings/collaborators.ts`(신규, `getProjectMembers`/`updateMeetingOwner` 패턴 참고):
```ts
import apiClient from '../client'

export interface Collaborator { user_id: number; name: string; email: string }
export interface InheritedCollaborator extends Collaborator { folder_id: number; folder_name: string }
export interface CollaboratorsResponse { direct: Collaborator[]; inherited: InheritedCollaborator[] }

export async function getMeetingCollaborators(meetingId: number): Promise<CollaboratorsResponse> {
  return apiClient.get(`meetings/${meetingId}/collaborators`).json<CollaboratorsResponse>()
}
export async function addMeetingCollaborator(meetingId: number, userId: number): Promise<Collaborator> {
  return (await apiClient.post(`meetings/${meetingId}/collaborators`, { json: { user_id: userId } })
    .json<{ collaborator: Collaborator }>()).collaborator
}
export async function removeMeetingCollaborator(meetingId: number, userId: number): Promise<void> {
  await apiClient.delete(`meetings/${meetingId}/collaborators/${userId}`)
}
```
`frontend/src/api/meetings.ts`에 `export * from './meetings/collaborators'` 추가.

`frontend/src/api/folders.ts`에 동형 타입(`FolderCollaborator`/`InheritedFolderCollaborator`/`FolderCollaboratorsResponse`)과 `getFolderCollaborators`/`addFolderCollaborator`/`removeFolderCollaborator` 함수 추가(파일 하단, 기존 `moveFolderToProject` 다음).

### 프론트 훅 — `frontend/src/hooks/useCollaborators.ts`(신규)
`useDomainFiles(ownerType, ownerId, projectId)`(`frontend/src/hooks/useDomainFiles.ts`)와 동일 골격:
```ts
export type CollaboratorOwnerType = 'meeting' | 'folder'

export function useCollaborators(ownerType: CollaboratorOwnerType, ownerId: number, projectId: number | null) {
  // direct, inherited, projectMembers, loading, error 상태
  // load(): ownerType별로 getMeetingCollaborators/getFolderCollaborators 분기 호출 + projectId 있으면 getProjectMembers(projectId)도 호출
  // add(userId): ownerType별 addMeetingCollaborator/addFolderCollaborator → 성공 시 reload
  // remove(userId): ownerType별 removeMeetingCollaborator/removeFolderCollaborator → 성공 시 reload
  // return { direct, inherited, projectMembers, loading, error, add, remove, reload }
}
```
프로젝트 멤버 목록을 훅이 직접 들고 있으므로 `CollaboratorsPanel`은 순수 프레젠테이션에 가깝게 유지된다(폴더 쪽은 `EditMeetingDialog`처럼 기존에 fetch해둔 `projectMembers`가 없으므로 훅 자체 조회가 필수).

### 프론트 컴포넌트 — `frontend/src/components/meeting/CollaboratorsPanel.tsx`(신규)
`DomainFilesPanel`과 동형 책임 분담:
- Props: `ownerType: 'meeting' | 'folder'`, `ownerId: number`, `projectId: number | null`, `canManage: boolean`.
- `useCollaborators(ownerType, ownerId, projectId)` 사용.
- 목록: 직접 지정 협업자(제거 버튼, `canManage`일 때만) + 상속분(읽기전용, "폴더 OO에서 상속됨" 뱃지).
- 추가: `<select>`(이미 협업자인 멤버는 옵션에서 제외) + "추가" 버튼, `canManage`일 때만 렌더.
- 에러 처리: `errorToMessage`(기존 `lib/errors`) 재사용.

### `EditMeetingDialog.tsx` 삽입 지점
`canTransferOwner`(line 66-70) 옆에 신규 플래그:
```ts
const canManageCollaborators = isMeetingOwner || currentUser?.role === 'admin'
```
`projectMembers` fetch effect(line 79-82)의 가드를 `if (!canTransferOwner && !canManageCollaborators) return`로 확장(두 섹션이 같은 목록을 공유 — 중복 fetch 방지). "도메인 파일" 섹션(line 217-227) 다음, "소유자" 섹션(line 229) 앞에 삽입:
```tsx
{canManageCollaborators && (
  <div>
    <label className="block text-sm font-medium mb-1">협업자</label>
    <CollaboratorsPanel ownerType="meeting" ownerId={meeting.id} projectId={meeting.project_id ?? null} canManage={canManageCollaborators} />
  </div>
)}
```

### `FolderCollaboratorsDialog.tsx`(신규, `DomainFilesDialog.tsx` 그대로 본뜸)
```tsx
export default function FolderCollaboratorsDialog({ folderId, folderName, projectId, onClose }: Props) {
  return (
    <Dialog onClose={onClose} ...>
      <h2>협업자 관리 — {folderName}</h2>
      <p className="text-xs text-muted-foreground">이 폴더의 협업자는 하위 모든 회의에 실시간 상속됩니다.</p>
      <CollaboratorsPanel ownerType="folder" ownerId={folderId} projectId={projectId} canManage={true} />
      {/* 닫기 버튼 */}
    </Dialog>
  )
}
```
`canManage={true}` 고정 — 폴더 쪽은 서버가 `authorize_folder_edit!`로 걸러주며, `FolderTree.tsx`는 다른 메뉴 항목(이름변경·휴지통 등)과 마찬가지로 클라이언트 사전 필터링을 하지 않는 기존 컨벤션을 따른다(서버 403이 최종 방어선).

### `FolderTree.tsx` 배선
`showDomainFilesDialog`(line 59) 옆에 `showCollaboratorsDialog` state 추가. "도메인 파일" 버튼(line 249-258) 다음에:
```tsx
<button onClick={(e) => { e.stopPropagation(); setShowMenu(false); setShowCollaboratorsDialog(true) }} className="...">
  <Users className="w-3.5 h-3.5" /> 협업자 관리
</button>
```
렌더 블록은 `showDomainFilesDialog &&`(line 316-323) 다음에 동형으로 `showCollaboratorsDialog && <FolderCollaboratorsDialog folderId={folder.id} folderName={folder.name} projectId={currentProjectId} onClose={...} />` 추가.

## editable 와이어링 버그 수정 — 정확한 위치 (실제 코드 직접 확인)

leaf 컴포넌트(`EditableTranscriptText`, `TranscriptPanel`, `FullRecord`, `LiveRecord`, `AiSummaryPanel`, `SpeakerPanel`, `MemoEditorPanel`, `MeetingEditor`, `RecordTabPanel`)는 모두 **자신에게 전달된 prop을 올바르게 신뢰**한다(`editable`/`readOnly` 기본값도 대부분 안전하지 않은 `true`/`false`이지만 그 자체가 버그는 아님 — 문제는 상위에서 아예 값을 안 넘기는 지점). 실제 결함은 전부 "호출부에서 canEdit을 빠뜨림"이다:

| 파일 | 라인 | 현재 | 수정 |
|------|------|------|------|
| `frontend/src/components/meeting/meetingDetailTabs.tsx` | 93 | `<SpeakerPanel ... readOnly={locked} .../>` | `readOnly={locked \|\| !canEdit}` |
| `frontend/src/components/meeting/meetingDetailTabs.tsx` | 142 | `<MemoEditorPanel ... readOnly={locked} />` | `readOnly={locked \|\| !canEdit}` |
| `frontend/src/pages/MeetingPage.tsx` | 579 | `<SpeakerPanel ... readOnly={locked} .../>` | `readOnly={locked \|\| !canEdit}` |
| `frontend/src/pages/MeetingPage.tsx` | 618 | `<MemoEditorPanel ... readOnly={locked} />` | `readOnly={locked \|\| !canEdit}` |
| `frontend/src/pages/MeetingLivePage.tsx` | 382 | `<SpeakerPanel meetingId={meetingId} isRecording={isActive} collapsible />`(readOnly 자체 미전달 → 기본값 false) | `readOnly={!canEdit}` 추가 |
| `frontend/src/pages/MeetingLivePage.tsx` | 395-400 | `<AiSummaryPanel ... />`(editable 미전달 → 기본값 true) | `editable={canEdit}` 추가 |
| `frontend/src/pages/MeetingLivePage.tsx` | 376-379 | `<RecordTabPanel meetingId={meetingId} currentTimeMs={0} />`(readOnly 미전달 → 기본값 false, 내부 `LiveRecord`/`FullRecord`가 editable=true로 렌더) | `readOnly={!canEdit}` 추가 |
| `frontend/src/hooks/useLiveMobileTabs.tsx` | 62 | `<SpeakerPanel meetingId={meetingId} isRecording={isActive} />` | `readOnly={!canEdit}` 추가 (canEdit는 신규 인자) |
| `frontend/src/hooks/useLiveMobileTabs.tsx` | 66-69 | `<RecordTabPanel meetingId={meetingId} currentTimeMs={0} />` | `readOnly={!canEdit}` 추가 |
| `frontend/src/hooks/useLiveMobileTabs.tsx` | 79 | `<AiSummaryPanel ... />` | `editable={canEdit}` 추가 |
| `frontend/src/hooks/useLiveMobileTabs.tsx` | 96 | `<MeetingEditor editorRef={memoEditorRef} />`(editable 미전달 → 기본값 true) | `editable={canEdit}` 추가 |

`useLiveMobileTabs.tsx`는 `UseLiveMobileTabsArgs` 인터페이스(line 16-31)에 `canEdit: boolean` 필드가 아예 없다 — 함수 시그니처 확장이 선행돼야 한다. `useMemo`(line 112) 의존성 배열에 `canEdit` 추가.

`frontend/src/pages/MeetingLivePage.tsx`의 `useLiveMobileTabs({...})` 호출부(line 301-315)에 `canEdit,`(이미 line 258에서 계산된 `canEdit` 변수)를 인자로 추가.

**변경 불필요(이미 정확)**: `TranscriptPanel`(`meetingDetailTabs.tsx:105`, `MeetingPage.tsx:573`는 이미 `readOnly={locked || !canEdit}`), `AiSummaryPanel`(`meetingDetailTabs.tsx:119`, `MeetingPage.tsx:593`는 이미 `editable={!locked && canEdit}`), `EditableTranscriptText`/`TranscriptPanel.tsx:182`/`FullRecord.tsx:158`/`LiveRecord.tsx:93`(전부 상위 `readOnly`/`editable`를 정확히 전파), `frontend/src/api/meetings/helpers.ts`의 `canEditMeeting`(서버 `editable` 신뢰가 1순위라 백엔드 확장만으로 자동 정합).

## 데이터 흐름
1. **쓰기(협업자 지정)**: UI(`CollaboratorsPanel`) → `POST /meetings/:id/collaborators` or `/folders/:id/collaborators`(user_id) → `authorize_meeting_collaborator_admin!`/`authorize_folder_edit!` → `MeetingCollaborator`/`FolderCollaborator` upsert → 목록 갱신.
2. **읽기(회의 열람·편집 게이팅)**: 어떤 회의 액션이든 → `set_meeting` → `authorize_meeting_read!`(협업자 분기 포함) → 액션별 `authorize_meeting_control!`(협업자 분기 포함, 콘텐츠 변경 액션만) → `meeting_json`의 `editable: meeting.editable_by?(current_user)`(협업자 분기 포함, `MeetingCollaborator.exists?` + `folder&.collaborator?` 실시간 평가, 스냅샷 없음) → 프론트 `canEditMeeting`이 그대로 신뢰 → 각 패널의 `readOnly`/`editable` prop.

## 설계 결정
- **결정**: `editable_by?` 확장은 "콘텐츠 편집" 외에 `destroy`(회의 삭제)·`authorize_lock!`(잠금/해제)·`shared` 토글까지 균일하게 적용한다(별도 세분화 안 함).
  **대안**: 협업자에게는 콘텐츠 편집만 허용하고 삭제/잠금/공유토글은 소유자·admin 전용으로 유지(별도 메서드로 분리).
  **근거**: spec이 "의미만 확장, 기존 소비자 코드 변경 불필요"라고 명시했고, `meeting_json.editable`이 이미 이 4가지 어포던스 전부를 게이팅하는 단일 필드다 — 분리하려면 API 계약(추가 필드)이 바뀌어 spec의 호환성 제약과 충돌한다. 다만 클래스 레벨 스코프 `Meeting.editable_by`(`meeting.rb:198`, `move_to_folder`/`move_to_project` 등 벌크 액션이 씀)는 여전히 **소유자만**(변경하지 않음) — 인스턴스 메서드만 확장, 벌크 스코프는 협업자를 포함하지 않는 의도적 비대칭.
- **결정**: 협업자 CRUD는 `authorize_meeting_control!`이 아닌 별도의 좁은 게이트(`authorize_meeting_collaborator_admin!`, 소유자+admin) 사용.
  **대안**: 기존 `authorize_meeting_control!` 재사용(협업자도 제어 가능하니까).
  **근거**: spec이 "협업자 추가/제거 권한: 소유자 + admin만"이라고 명시. 재사용 시 협업자가 협업자를 늘릴 수 있는 권한 상승이 됨.
- **결정**: 읽기 게이트(`authorize_meeting_read!`)에도 협업자 분기를 추가(spec 원문이 명시하지 않았지만).
  **대안**: spec 원문 그대로 `authorize_meeting_control!`만 확장.
  **근거**: `set_meeting`이 모든 액션 앞단에서 먼저 읽기 인가를 강제하므로, 읽기를 확장하지 않으면 비공유 회의(폴더 상속의 주 유스케이스)에서 협업자가 403으로 아예 진입 불가.
- **결정**: `Folder#collaborator?`는 폴더 협업자 CRUD 자체는 게이팅하지 않는다(그건 `authorize_folder_edit!` 몫) — 오직 "이 폴더 밑 회의들에 상속되는 협업자인가"만 판정.
  **근거**: spec이 이름 충돌(`Folder#editable_by?`=폴더 자체 편집권)을 명시적으로 경계했다.

## 선행 조건
없음(기존 `project_memberships`/`ancestor_records`/`effectively_shared?` 재사용만, 신규 외부 의존성 없음).

## 리스크
- **MEDIUM — N+1 (회의 목록 직렬화)**: `meeting_json`의 `editable: meeting.editable_by?(current_user)`가 회의마다 호출되는데, 확장된 `editable_by?`는 `MeetingCollaborator.exists?` 1쿼리 + `folder&.collaborator?`(내부적으로 `ancestor_records` 부모 체인 N쿼리 + `FolderCollaborator.where` 1쿼리)를 추가로 발생시킨다. 50건 목록이면 폴더 깊이에 비례해 수백 쿼리로 늘 수 있다. 이번 스코프(단위테스트 통과)에서는 기능 정확성을 우선하고, 후속 작업으로 `Folder.visible_folder_ids`처럼 요청 단위 배치 프리로드(전 폴더 1회 로드 후 in-memory 평가)를 검토할 것 — 지금 손대지 않는 이유를 QA/후속 티켓에 남긴다.
- **MEDIUM — 권한 상승 실수**: 협업자 CRUD 게이트를 `authorize_meeting_control!`과 혼동해 재사용하면 협업자가 협업자를 추가하는 권한 상승이 된다(위 "설계 결정" 참조, RSpec으로 반드시 회귀 방지).
- **LOW — 폴더 협업자 UI 사전 필터링 없음**: `FolderTree.tsx`는 기존 컨벤션대로 메뉴를 항상 노출하고 서버 403에 의존한다. 비관리자가 "협업자 관리"를 눌러도 다이얼로그는 열리지만 추가/제거 시 403 에러 메시지만 보인다(신규 사용자 경험 저하 없음 — 기존 폴더 메뉴 항목들과 동일 패턴).
- **없음** 그 외.

## QA 체크리스트

### Backend (RSpec)
- [ ] `Meeting#editable_by?`: 소유자/admin은 true(기존 유지)
- [ ] `Meeting#editable_by?`: 직접 지정 협업자(`MeetingCollaborator`)는 true
- [ ] `Meeting#editable_by?`: 소속 폴더의 협업자(직속)는 true
- [ ] `Meeting#editable_by?`: 조상 폴더의 협업자(2단계 이상)는 true
- [ ] `Meeting#editable_by?`: 무관한 사용자는 false
- [ ] `Folder#collaborator?`: 자신에게 직접 지정된 협업자는 true
- [ ] `Folder#collaborator?`: 조상 폴더 협업자는 true(다단계)
- [ ] `Folder#collaborator?`: 사이클(parent_id 순환)이 있어도 무한루프 없이 종료
- [ ] `Folder#collaborator?`: 무관한 사용자는 false
- [ ] `authorize_meeting_read!`: 폴더 상속 협업자가 **비공유(private)** 회의를 읽을 수 있다(핵심 회귀 방지 — 이게 막히면 기능 전체가 동작 안 함)
- [ ] `authorize_meeting_control!`: 직접/폴더상속 협업자가 회의를 수정(update)할 수 있다
- [ ] `authorize_meeting_control!`: 무관한 사용자는 여전히 403
- [ ] `POST /meetings/:id/collaborators`: 소유자가 같은 프로젝트 멤버를 협업자로 추가 → 201
- [ ] `POST /meetings/:id/collaborators`: 프로젝트 비멤버 대상이면 422
- [ ] `POST /meetings/:id/collaborators`: **일반 협업자(비소유자)가 호출하면 403**(권한 상승 회귀 방지 핵심 케이스)
- [ ] `POST /meetings/:id/collaborators`: admin은 호출 가능
- [ ] `DELETE /meetings/:id/collaborators/:user_id`: 소유자가 제거 → 204, 이후 `editable_by?` false로 전환
- [ ] `DELETE /meetings/:id/collaborators/:user_id`: 존재하지 않는 대상은 404
- [ ] `GET /meetings/:id/collaborators`: 직접(direct)과 상속(inherited, folder_id/folder_name 포함)이 구분되어 응답
- [ ] `POST/DELETE /folders/:id/collaborators`: 폴더 내 회의 소유자(`Folder#editable_by?` true)는 가능, 무관한 사용자는 403
- [ ] `GET /folders/:id/collaborators`: 직접/조상상속 구분 응답
- [ ] 폴더 협업자 변경이 하위 기존 회의에 **즉시**(스냅샷 아님) 반영됨 — 협업자 추가 전엔 403, 추가 후 재요청하면 200

### Frontend (vitest)
- [ ] `frontend/src/components/meeting/meetingDetailTabs.test.tsx`(신규): `buildMeetingDetailTabs({ locked: false, canEdit: false, ... })` 결과에서 `SpeakerPanel`/`MemoEditorPanel`에 해당하는 tab content의 `readOnly` prop이 `true`인지 렌더 후 확인(react-testing-library로 각 탭 content 렌더 + 버튼/에디터 disabled 상태 검증, 또는 반환된 Tab[].content의 props를 직접 검사)
- [ ] 동 파일: `canEdit: true, locked: true` 조합 시 `readOnly`가 여전히 `true`(잠금 우선)
- [ ] `frontend/src/hooks/useLiveMobileTabs.test.tsx`(신규): `canEdit: false`일 때 summary 탭의 `AiSummaryPanel`이 `editable={false}`로, transcript 탭의 `SpeakerPanel`/`RecordTabPanel`이 `readOnly={true}`로 렌더되는지
- [ ] `frontend/src/pages/MeetingPage.test.tsx`(기존 있으면 케이스 추가, 없으면 스킵 가능 — 페이지 레벨 통합은 이미 하위 컴포넌트 테스트로 커버): `canEdit=false`일 때 `SpeakerPanel`/`MemoEditorPanel`에 readOnly 전달 스모크
- [ ] `frontend/src/components/meeting/CollaboratorsPanel.test.tsx`(신규): direct/inherited 목록 렌더, 상속 뱃지 표시, `canManage=false`일 때 추가/제거 버튼 미노출, 추가 성공 시 목록 갱신(API mock)
- [ ] `frontend/src/api/meetings/collaborators.test.ts`(신규, 또는 `meetings.test.ts`에 `describe` 추가): `getMeetingCollaborators`/`addMeetingCollaborator`/`removeMeetingCollaborator`가 올바른 엔드포인트·메서드·바디로 호출되는지(`vi.mock('./client', ...)` 패턴, `meetings.test.ts` 참고)
- [ ] `frontend/src/api/folders.test.ts`(기존 있으면 추가): 폴더 협업자 함수 3종 엔드포인트 검증

**fullstack Task 필수 항목(E2E 생략 — spec.md 범위 경계에서 명시적으로 제외, 단 문구는 정책상 보존):**
- [ ] (클릭 경로) 메뉴/사이드바/버튼을 클릭하여 목표 페이지에 도달한다 (URL 직접 입력 금지) — *E2E 제외 스코프이므로 자동 검증 생략, 수동 확인만*
- [ ] (화면 렌더링) 핵심 UI 요소가 브라우저에서 실제 표시되고 기본 상호작용이 동작한다 — *동상*

## Implementation Steps
- [ ] 1. 마이그레이션 작성·실행(`meeting_collaborators`, `folder_collaborators`) + `schema.rb` 갱신 확인
- [ ] 2. `MeetingCollaborator`/`FolderCollaborator` 모델 생성
- [ ] 3. `Meeting#editable_by?` 확장 + `has_many :meeting_collaborators` 추가
- [ ] 4. `Folder#collaborator?` 신설 + `has_many :folder_collaborators` 추가
- [ ] 5. `meeting_lookup.rb`: `meeting_collaborator?` 헬퍼 + `authorize_meeting_read!`/`authorize_meeting_control!` 확장
- [ ] 6. `meetings_controller.rb`: `collaborators`/`add_collaborator`/`remove_collaborator` 액션 + `authorize_meeting_collaborator_admin!` + before_action + routes.rb
- [ ] 7. `folders_controller.rb`: 동형 액션 + before_action + routes.rb
- [ ] 8. 백엔드 RSpec 작성 및 통과(QA 체크리스트 backend 전항목)
- [ ] 9. `frontend/src/api/meetings/collaborators.ts` + `folders.ts` 확장 + barrel export
- [ ] 10. `useCollaborators` 훅 + `CollaboratorsPanel` 컴포넌트
- [ ] 11. `EditMeetingDialog.tsx`(협업자 섹션) + `FolderCollaboratorsDialog.tsx` + `FolderTree.tsx`(메뉴 항목) 배선
- [ ] 12. editable 와이어링 버그 9개 지점 수정(meetingDetailTabs.tsx ×2, MeetingPage.tsx ×2, MeetingLivePage.tsx ×3, useLiveMobileTabs.tsx ×4 — 시그니처 확장 포함)
- [ ] 13. 프론트 vitest 작성 및 통과(QA 체크리스트 frontend 전항목)
- [ ] 14. 전체 재확인: `rails_helper` 기반 RSpec 전체 실행 + `vitest run` 전체 실행 그린
