# 회의·폴더 프로젝트간 이동 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회의 단건·폴더(서브트리)를 다른 프로젝트로 옮기는 UI+API 추가.

**Architecture:** Rails 백엔드에 2개 collection/member 액션 추가(권한=원본 editable_by AND 대상 멤버십/admin override, `update_all`+트랜잭션). 프론트는 공용 `MoveToProjectModal` + 회의 ⋯·폴더 ⋯ 메뉴 진입점. 백엔드 회의 API는 일괄 대비 `meeting_ids[]` 배열 수신.

**Tech Stack:** Rails 7 / RSpec / React+TS / Vitest / Zustand / ky.

스펙: `docs/superpowers/specs/2026-06-17-cross-project-move-design.md`

작업 디렉토리: `/Users/jji/project/ddobakddobak/backend` (Rails), 프론트는 `/Users/jji/project/ddobakddobak/frontend`. 브랜치 = 현재 `feat/project-management` 위에서 진행(별도 브랜치 불필요, 사용자 지시 따름).

---

## Task 1: 백엔드 — 회의 프로젝트 이동 엔드포인트

**Files:**
- Modify: `config/routes.rb` (meetings collection에 라우트 추가)
- Modify: `app/controllers/api/v1/meetings_controller.rb` (move_to_project 액션, move_to_folder 아래)
- Test: `spec/requests/api/v1/meetings_move_to_project_spec.rb` (Create)

- [ ] **Step 1: 실패 테스트 작성**

Create `spec/requests/api/v1/meetings_move_to_project_spec.rb`:

```ruby
require "rails_helper"

RSpec.describe "POST /api/v1/meetings/move_to_project", type: :request do
  let(:owner) { create(:user) }
  let(:source) { create(:project) }
  let(:target) { create(:project) }
  let!(:m) { create(:meeting, project: source, creator: owner, folder: create(:folder, project: source)) }

  before do
    ProjectMembership.find_or_create_by!(user: owner, project: source) { |pm| pm.role = "admin" }
  end

  def move(params)
    post "/api/v1/meetings/move_to_project", params: params
  end

  context "원본 소유 + 대상 멤버" do
    before { create(:project_membership, user: owner, project: target, role: "member") }

    it "project_id 변경 + folder_id nil + moved 수 반환" do
      login_as(owner)
      move(meeting_ids: [m.id], target_project_id: target.id)
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["moved"]).to eq(1)
      expect(m.reload.project_id).to eq(target.id)
      expect(m.reload.folder_id).to be_nil
    end
  end

  it "대상 비멤버면 403, 미변경" do
    login_as(owner)
    move(meeting_ids: [m.id], target_project_id: target.id)
    expect(response).to have_http_status(:forbidden)
    expect(m.reload.project_id).to eq(source.id)
  end

  it "비소유 회의는 editable_by 스코프로 제외(moved 0)" do
    other = create(:user)
    create(:project_membership, user: other, project: source, role: "member")
    create(:project_membership, user: other, project: target, role: "member")
    login_as(other)
    move(meeting_ids: [m.id], target_project_id: target.id)
    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body)["moved"]).to eq(0)
    expect(m.reload.project_id).to eq(source.id)
  end

  it "잠긴 회의 포함 시 403" do
    create(:project_membership, user: owner, project: target, role: "member")
    m.update!(locked_at: Time.current)
    login_as(owner)
    move(meeting_ids: [m.id], target_project_id: target.id)
    expect(response).to have_http_status(:forbidden)
    expect(m.reload.project_id).to eq(source.id)
  end

  it "시스템 admin은 비멤버 대상도 허용(override)" do
    admin = create(:user, role: "admin")
    login_as(admin)
    move(meeting_ids: [m.id], target_project_id: target.id)
    expect(response).to have_http_status(:ok)
    expect(m.reload.project_id).to eq(target.id)
  end

  it "meeting_ids 비면 422" do
    create(:project_membership, user: owner, project: target, role: "member")
    login_as(owner)
    move(meeting_ids: [], target_project_id: target.id)
    expect(response).to have_http_status(:unprocessable_entity)
  end

  it "대상 프로젝트 없으면 404" do
    login_as(owner)
    move(meeting_ids: [m.id], target_project_id: 999999)
    expect(response).to have_http_status(:not_found)
  end
end
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bundle exec rspec spec/requests/api/v1/meetings_move_to_project_spec.rb`
Expected: FAIL — 라우트 없음(404 for all / `No route matches`).

- [ ] **Step 3: 라우트 추가**

`config/routes.rb` meetings collection 블록(현재 `post :move_to_folder` 있는 곳)에 추가:

```ruby
        collection do
          post :upload_audio
          post :move_to_folder
          post :move_to_project
          post :join, to: "meeting_shares#join"
        end
```

- [ ] **Step 4: 액션 구현**

`app/controllers/api/v1/meetings_controller.rb`의 `move_to_folder` 메서드(`end` 닫힌 직후, 196행 근처)에 추가:

```ruby
      def move_to_project
        meeting_ids = params[:meeting_ids]
        return render json: { error: "meeting_ids is required" }, status: :unprocessable_entity if meeting_ids.blank?

        # 대상 프로젝트 멤버십/admin override 확인(require_project! 재사용: 실패 시 render 후 nil).
        target = require_project!(params[:target_project_id])
        return unless target

        # 잠긴 회의가 하나라도 포함되면 이동 차단(move_to_folder 패턴, 부분 적용 방지).
        if Meeting.where(id: meeting_ids).where.not(locked_at: nil).exists?
          return render json: { error: "잠긴 회의입니다. 잠금을 해제한 뒤 다시 시도하세요." }, status: :forbidden
        end

        # update_all 은 콜백·인가를 우회하므로 editable_by 스코프가 유일한 방어선이다.
        # folder_id: nil — 원본 폴더는 대상 프로젝트에 없으므로 분리(최상위 안착).
        meetings = Meeting.editable_by(current_user).where(id: meeting_ids)
        meetings.update_all(project_id: target.id, folder_id: nil)
        render json: { moved: meetings.count }
      end
```

> 주의: `require_project!`는 `params[:project_id]` 기본이므로 반드시 `params[:target_project_id]`를 명시 전달. `target_project_id` 미존재 → blank? → 400(bad_request) 반환되지만, 테스트는 999999(존재안함)로 404를 검증한다. blank 케이스는 프론트가 항상 채우므로 별도 처리 불필요.

- [ ] **Step 5: 테스트 통과 확인**

Run: `bundle exec rspec spec/requests/api/v1/meetings_move_to_project_spec.rb`
Expected: PASS (8 examples, 0 failures).

- [ ] **Step 6: 커밋**

```bash
git add config/routes.rb app/controllers/api/v1/meetings_controller.rb spec/requests/api/v1/meetings_move_to_project_spec.rb
git commit -m "feat(move): 회의 프로젝트 이동 API (move_to_project)"
```

---

## Task 2: 백엔드 — Folder#subtree_ids 모델 메서드

**Files:**
- Modify: `app/models/folder.rb` (subtree_ids 인스턴스 메서드, ancestor_records 아래)
- Test: `spec/models/folder_subtree_spec.rb` (Create)

- [ ] **Step 1: 실패 테스트 작성**

Create `spec/models/folder_subtree_spec.rb`:

```ruby
require "rails_helper"

RSpec.describe Folder, "#subtree_ids" do
  let(:project) { create(:project) }

  it "자신 + 모든 자손 폴더 id (루트 포함)" do
    root = create(:folder, project: project)
    child = create(:folder, project: project, parent: root)
    grandchild = create(:folder, project: project, parent: child)
    sibling = create(:folder, project: project) # 무관 폴더
    expect(root.subtree_ids).to match_array([root.id, child.id, grandchild.id])
    expect(root.subtree_ids).not_to include(sibling.id)
  end

  it "자식 없으면 자신만" do
    leaf = create(:folder, project: project)
    expect(leaf.subtree_ids).to eq([leaf.id])
  end

  it "사이클이 있어도 무한루프 없이 종료" do
    a = create(:folder, project: project)
    b = create(:folder, project: project, parent: a)
    a.update_column(:parent_id, b.id) # a<->b 사이클
    expect(a.subtree_ids).to match_array([a.id, b.id])
  end
end
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bundle exec rspec spec/models/folder_subtree_spec.rb`
Expected: FAIL — `undefined method 'subtree_ids'`.

- [ ] **Step 3: 메서드 구현**

`app/models/folder.rb`의 `ancestor_records` 메서드(43행 `end`) 아래에 추가:

```ruby
  # 자신 + 모든 자손 폴더 id (루트 포함). BFS, seen 사이클 가드.
  def subtree_ids
    result = []
    seen = {}
    queue = [self]
    while (node = queue.shift)
      next if seen[node.id]
      seen[node.id] = true
      result << node.id
      queue.concat(node.children.to_a)
    end
    result
  end
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `bundle exec rspec spec/models/folder_subtree_spec.rb`
Expected: PASS (3 examples, 0 failures).

- [ ] **Step 5: 커밋**

```bash
git add app/models/folder.rb spec/models/folder_subtree_spec.rb
git commit -m "feat(move): Folder#subtree_ids (서브트리 폴더 id 재귀수집)"
```

---

## Task 3: 백엔드 — 폴더 프로젝트 이동 엔드포인트

**Files:**
- Modify: `config/routes.rb` (folders member에 라우트 추가)
- Modify: `app/controllers/api/v1/folders_controller.rb` (move_to_project 액션 + before_action)
- Test: `spec/requests/api/v1/folders_move_to_project_spec.rb` (Create)

- [ ] **Step 1: 실패 테스트 작성**

Create `spec/requests/api/v1/folders_move_to_project_spec.rb`:

```ruby
require "rails_helper"

RSpec.describe "POST /api/v1/folders/:id/move_to_project", type: :request do
  let(:owner) { create(:user) }
  let(:source) { create(:project) }
  let(:target) { create(:project) }
  let(:root) { create(:folder, project: source) }
  let(:child) { create(:folder, project: source, parent: root) }
  let!(:m_root) { create(:meeting, project: source, creator: owner, folder: root) }
  let!(:m_child) { create(:meeting, project: source, creator: owner, folder: child) }

  before do
    ProjectMembership.find_or_create_by!(user: owner, project: source) { |pm| pm.role = "admin" }
  end

  def move(folder, params)
    post "/api/v1/folders/#{folder.id}/move_to_project", params: params
  end

  context "권한 통과(원본 소유 + 대상 멤버)" do
    before { create(:project_membership, user: owner, project: target, role: "member") }

    it "서브트리 폴더·회의 전부 대상 project_id, 루트 parent nil, 내부구조 보존" do
      child # touch (lazy let)
      login_as(owner)
      move(root, target_project_id: target.id)
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["moved_folders"]).to eq(2)
      expect(body["moved_meetings"]).to eq(2)
      expect(root.reload.project_id).to eq(target.id)
      expect(root.reload.parent_id).to be_nil
      expect(child.reload.project_id).to eq(target.id)
      expect(child.reload.parent_id).to eq(root.id) # 내부구조 보존
      expect(m_root.reload.project_id).to eq(target.id)
      expect(m_root.reload.folder_id).to eq(root.id) # folder_id 유지
      expect(m_child.reload.project_id).to eq(target.id)
    end

    it "고아 폴더 미발생(자손이 원본에 남지 않음)" do
      child
      login_as(owner)
      move(root, target_project_id: target.id)
      expect(Folder.where(project_id: source.id)).to be_empty
    end

    it "자기 프로젝트로 이동하면 422" do
      login_as(owner)
      move(root, target_project_id: source.id)
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  it "원본 폴더 편집권 없으면 403" do
    stranger = create(:user)
    create(:project_membership, user: stranger, project: target, role: "member")
    login_as(stranger)
    move(root, target_project_id: target.id)
    expect(response).to have_http_status(:forbidden)
    expect(root.reload.project_id).to eq(source.id)
  end

  it "대상 비멤버면 403" do
    login_as(owner)
    move(root, target_project_id: target.id)
    expect(response).to have_http_status(:forbidden)
    expect(root.reload.project_id).to eq(source.id)
  end

  it "시스템 admin override" do
    admin = create(:user, role: "admin")
    login_as(admin)
    move(root, target_project_id: target.id)
    expect(response).to have_http_status(:ok)
    expect(root.reload.project_id).to eq(target.id)
  end
end
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `bundle exec rspec spec/requests/api/v1/folders_move_to_project_spec.rb`
Expected: FAIL — 라우트 없음.

- [ ] **Step 3: 라우트 추가**

`config/routes.rb`의 `resources :folders` 블록을 member 라우트 포함하도록 수정. 현재:

```ruby
      resources :folders, only: %i[index create update destroy] do
        resources :glossary_entries, only: %i[index create], controller: "glossary_entries"
      end
```

으로 되어 있다. 다음으로 변경:

```ruby
      resources :folders, only: %i[index create update destroy] do
        member do
          post :move_to_project
        end
        resources :glossary_entries, only: %i[index create], controller: "glossary_entries"
      end
```

- [ ] **Step 4: 액션 + before_action 구현**

`app/controllers/api/v1/folders_controller.rb`:

(a) before_action 2줄을 move_to_project에도 적용 — 7~8행 수정:

```ruby
      before_action :set_folder, only: %i[update destroy move_to_project]
      before_action :authorize_folder_edit!, only: %i[update destroy move_to_project]
```

(b) `update` 메서드 아래(파괴적 액션 근처)에 액션 추가. `private` 위쪽 public 영역에:

```ruby
      def move_to_project
        target = require_project!(params[:target_project_id])
        return unless target

        if target.id == @folder.project_id
          return render json: { error: "이미 해당 프로젝트의 폴더입니다" }, status: :unprocessable_entity
        end

        ids = @folder.subtree_ids
        moved_meetings = 0
        Folder.transaction do
          Folder.where(id: ids).update_all(project_id: target.id)
          @folder.update_column(:parent_id, nil) # 루트만 최상위 안착, 내부구조 보존
          moved_meetings = Meeting.where(folder_id: ids).update_all(project_id: target.id)
        end
        render json: { moved_folders: ids.size, moved_meetings: moved_meetings }
      end
```

> `authorize_folder_edit!`가 `@folder.editable_by?`로 원본 권한을, `require_project!(target_project_id)`가 대상 멤버십/admin override를 강제한다(둘 다 충족해야 통과). `update_all`은 Integer(영향 행수)를 반환하므로 moved_meetings에 그대로 사용.

- [ ] **Step 5: 테스트 통과 확인**

Run: `bundle exec rspec spec/requests/api/v1/folders_move_to_project_spec.rb`
Expected: PASS (7 examples, 0 failures).

- [ ] **Step 6: 백엔드 회귀 확인 + 커밋**

```bash
bundle exec rspec spec/requests/api/v1/folders_spec.rb spec/requests/api/v1/meetings_project_isolation_spec.rb spec/models/folder_subtree_spec.rb
git add config/routes.rb app/controllers/api/v1/folders_controller.rb spec/requests/api/v1/folders_move_to_project_spec.rb
git commit -m "feat(move): 폴더 서브트리 프로젝트 이동 API"
```

Expected: 회귀 PASS.

---

## Task 4: 프론트 — API 클라이언트 2개

**Files:**
- Modify: `frontend/src/api/meetings.ts` (moveMeetingsToProject, 파일 끝 export 함수들 근처)
- Modify: `frontend/src/api/folders.ts` (moveFolderToProject, moveMeetingsToFolder 아래)
- Test: `frontend/src/api/__tests__/moveToProject.test.ts` (Create — 없으면 디렉토리 생성)

- [ ] **Step 1: 실패 테스트 작성**

Create `frontend/src/api/__tests__/moveToProject.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { moveMeetingsToProject } from '../meetings'
import { moveFolderToProject } from '../folders'
import apiClient from '../client'

vi.mock('../client', () => ({
  default: { post: vi.fn(() => ({ json: () => Promise.resolve({}) })) },
  getAuthHeaders: vi.fn(() => ({})),
}))

describe('move to project API', () => {
  beforeEach(() => vi.clearAllMocks())

  it('moveMeetingsToProject는 meeting_ids+target_project_id를 POST', async () => {
    await moveMeetingsToProject([1, 2], 9)
    expect(apiClient.post).toHaveBeenCalledWith('meetings/move_to_project', {
      json: { meeting_ids: [1, 2], target_project_id: 9 },
    })
  })

  it('moveFolderToProject는 folder id 경로 + target_project_id를 POST', async () => {
    await moveFolderToProject(5, 9)
    expect(apiClient.post).toHaveBeenCalledWith('folders/5/move_to_project', {
      json: { target_project_id: 9 },
    })
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd frontend && npx vitest run src/api/__tests__/moveToProject.test.ts`
Expected: FAIL — `moveMeetingsToProject is not a function`.

- [ ] **Step 3: 구현**

`frontend/src/api/meetings.ts` 끝부분(다른 export async function 들 사이)에 추가:

```ts
export async function moveMeetingsToProject(
  meetingIds: number[],
  targetProjectId: number,
): Promise<{ moved: number }> {
  return apiClient
    .post('meetings/move_to_project', { json: { meeting_ids: meetingIds, target_project_id: targetProjectId } })
    .json()
}
```

`frontend/src/api/folders.ts`의 `moveMeetingsToFolder` 함수 아래에 추가:

```ts
export async function moveFolderToProject(
  folderId: number,
  targetProjectId: number,
): Promise<{ moved_folders: number; moved_meetings: number }> {
  return apiClient
    .post(`folders/${folderId}/move_to_project`, { json: { target_project_id: targetProjectId } })
    .json()
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd frontend && npx vitest run src/api/__tests__/moveToProject.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/api/meetings.ts frontend/src/api/folders.ts frontend/src/api/__tests__/moveToProject.test.ts
git commit -m "feat(move): 프론트 API 클라이언트 (moveMeetingsToProject/moveFolderToProject)"
```

---

## Task 5: 프론트 — MoveToProjectModal 공용 컴포넌트

**Files:**
- Create: `frontend/src/components/project/MoveToProjectModal.tsx`
- Test: `frontend/src/components/project/MoveToProjectModal.test.tsx`

전제: `useProjectStore` 의 `projects`(`Project[]`, 각 `id/name/personal/role/owner/meeting_count` 보유), `useAuthStore`의 `user`, `projectDisplayName`/`isHiddenClutterProject`(`api/projects.ts`), `ProjectIcon`(`components/project/ProjectIcon`).

- [ ] **Step 1: 실패 테스트 작성**

Create `frontend/src/components/project/MoveToProjectModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MoveToProjectModal from './MoveToProjectModal'
import { useProjectStore } from '../../stores/projectStore'
import { useAuthStore } from '../../stores/authStore'

const moveMeetings = vi.fn(() => Promise.resolve({ moved: 1 }))
vi.mock('../../api/meetings', () => ({ moveMeetingsToProject: (...a: unknown[]) => moveMeetings(...a) }))
vi.mock('../../api/folders', () => ({ moveFolderToProject: vi.fn(() => Promise.resolve({ moved_folders: 1, moved_meetings: 0 })) }))

function seed(projects: unknown[], role: 'admin' | 'member' = 'member') {
  useProjectStore.setState({ projects } as never)
  useAuthStore.setState({ user: { id: 1, email: 'a@b.c', name: 'A', role } } as never)
}

const P = (over: Record<string, unknown>) => ({
  id: 1, name: 'P', personal: false, role: 'member', owner: null, meeting_count: 3,
  icon_type: null, icon_value: null, color: null, ...over,
})

describe('MoveToProjectModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('원본 프로젝트와 클러터는 후보에서 제외, 멤버만 노출', () => {
    seed([
      P({ id: 1, name: '원본' }),
      P({ id: 2, name: '대상B' }),
      P({ id: 3, name: '비멤버', role: null }),
      P({ id: 4, name: '빈개인', personal: true, role: null, meeting_count: 0 }),
    ])
    render(<MoveToProjectModal mode="meetings" meetingIds={[10]} sourceProjectId={1} title="회의X" onClose={() => {}} onMoved={() => {}} />)
    expect(screen.queryByText('원본')).toBeNull()
    expect(screen.getByText('대상B')).toBeInTheDocument()
    expect(screen.queryByText('비멤버')).toBeNull()
    expect(screen.queryByText('빈개인')).toBeNull()
  })

  it('시스템 admin은 비멤버 프로젝트도 후보에 포함', () => {
    seed([P({ id: 1, name: '원본' }), P({ id: 3, name: '비멤버', role: null })], 'admin')
    render(<MoveToProjectModal mode="meetings" meetingIds={[10]} sourceProjectId={1} title="회의X" onClose={() => {}} onMoved={() => {}} />)
    expect(screen.getByText('비멤버')).toBeInTheDocument()
  })

  it('대상 선택 후 이동 → moveMeetingsToProject 호출 + onMoved', async () => {
    const onMoved = vi.fn()
    seed([P({ id: 1, name: '원본' }), P({ id: 2, name: '대상B' })])
    render(<MoveToProjectModal mode="meetings" meetingIds={[10]} sourceProjectId={1} title="회의X" onClose={() => {}} onMoved={onMoved} />)
    fireEvent.click(screen.getByText('대상B'))
    fireEvent.click(screen.getByRole('button', { name: '이동' }))
    await waitFor(() => expect(moveMeetings).toHaveBeenCalledWith([10], 2))
    await waitFor(() => expect(onMoved).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd frontend && npx vitest run src/components/project/MoveToProjectModal.test.tsx`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 컴포넌트 구현**

Create `frontend/src/components/project/MoveToProjectModal.tsx`:

```tsx
import { useState } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useAuthStore } from '../../stores/authStore'
import { projectDisplayName, isHiddenClutterProject } from '../../api/projects'
import { moveMeetingsToProject } from '../../api/meetings'
import { moveFolderToProject } from '../../api/folders'
import ProjectIcon from './ProjectIcon'

interface Props {
  mode: 'meetings' | 'folder'
  meetingIds?: number[]
  folderId?: number
  sourceProjectId: number
  title: string
  onClose: () => void
  onMoved: () => void
}

export default function MoveToProjectModal({ mode, meetingIds, folderId, sourceProjectId, title, onClose, onMoved }: Props) {
  const projects = useProjectStore((s) => s.projects)
  const isSystemAdmin = useAuthStore((s) => s.user?.role === 'admin')
  const [targetId, setTargetId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // 후보 = 원본·클러터 제외 + (내가 멤버 OR 시스템admin). 백엔드 override와 합치.
  const candidates = projects.filter(
    (p) => p.id !== sourceProjectId && !isHiddenClutterProject(p) && (p.role != null || isSystemAdmin),
  )

  const onSubmit = async () => {
    if (targetId == null) return
    setBusy(true)
    setError('')
    try {
      if (mode === 'meetings') await moveMeetingsToProject(meetingIds ?? [], targetId)
      else await moveFolderToProject(folderId!, targetId)
      onMoved()
      onClose()
    } catch {
      setError('이동에 실패했습니다. 권한 또는 연결을 확인하세요.')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-80 rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-base font-semibold text-zinc-900">프로젝트 이동</h2>
        <p className="mb-3 truncate text-xs text-zinc-500">{title}</p>
        {candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">이동할 다른 프로젝트가 없습니다.</p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {candidates.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => setTargetId(p.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
                    targetId === p.id ? 'bg-indigo-50 ring-1 ring-indigo-400' : 'hover:bg-zinc-100'
                  }`}
                >
                  <ProjectIcon project={p} size={24} />
                  <span className="truncate text-zinc-900">{projectDisplayName(p)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100">
            취소
          </button>
          <button
            onClick={onSubmit}
            disabled={targetId == null || busy}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            이동
          </button>
        </div>
      </div>
    </div>
  )
}
```

> `ProjectIcon`의 props 시그니처를 구현 전 확인할 것(`project={p}` 또는 `type/value` 분해). 기존 `ProjectsPage.tsx`/`ProjectSwitcher.tsx`의 `<ProjectIcon .../>` 사용처를 그대로 따른다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd frontend && npx vitest run src/components/project/MoveToProjectModal.test.tsx`
Expected: PASS (3 tests). ProjectIcon props 불일치 시 모킹하거나 사용처 시그니처에 맞춰 수정.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/project/MoveToProjectModal.tsx frontend/src/components/project/MoveToProjectModal.test.tsx
git commit -m "feat(move): MoveToProjectModal 공용 프로젝트 셀렉터"
```

---

## Task 6: 프론트 — 회의 ⋯ 메뉴 진입점 배선

**Files:**
- Modify: `frontend/src/components/meeting/MeetingListUI.tsx` (메뉴에 "프로젝트 이동" 추가 + prop)
- Modify: `frontend/src/pages/MeetingsPage.tsx` (모달 상태 + 렌더 + 갱신)

- [ ] **Step 1: MeetingListUI에 onMoveProject prop + 메뉴 항목 추가**

`MeetingListUI.tsx`:

(a) `MeetingActionButtonsProps`에 추가:
```ts
  onMoveProject: (meeting: Meeting) => void
```
(b) 구조분해 인자에 `onMoveProject` 추가(`onMove,` 아래).
(c) "폴더로 이동" 버튼(`<FolderInput .../> 폴더로 이동` 닫는 `</button>`) 바로 아래에 추가:
```tsx
            <button
              aria-label="프로젝트 이동"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                onMoveProject(meeting)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-100"
            >
              <FolderInput className="w-4 h-4" /> 프로젝트 이동
            </button>
```
> 아이콘은 이미 import된 `FolderInput` 재사용(별도 import 불필요). `MeetingActionButtons`를 호출하는 곳(같은 파일 내 카드/리스트 렌더)에 `onMoveProject={onMoveProject}`를 전달하도록 상위 props도 함께 배선. 상위 컴포넌트(목록 렌더)의 props 인터페이스에 `onMoveProject`를 추가하고, `MeetingActionButtons`에 넘긴다(`onMove`가 전달되는 모든 위치에 나란히 추가).

- [ ] **Step 2: MeetingsPage에 상태·핸들러·렌더 추가**

`MeetingsPage.tsx`:

(a) import 추가(상단, 다른 컴포넌트 import 근처):
```ts
import MoveToProjectModal from '../components/project/MoveToProjectModal'
import { useProjectStore } from '../stores/projectStore'
```
(b) 상태 추가(`movingMeeting` 근처):
```ts
const [movingProjectMeeting, setMovingProjectMeeting] = useState<Meeting | null>(null)
const currentProjectId = useProjectStore((s) => s.currentProjectId)
```
(c) 두 군데 `onMove={setMovingMeeting}` 옆에 `onMoveProject={setMovingProjectMeeting}` 추가(411·431행 근처 두 렌더 위치 모두).
(d) `MoveMeetingDialog` 렌더(490행 근처) 아래에 추가:
```tsx
        {movingProjectMeeting && currentProjectId != null && (
          <MoveToProjectModal
            mode="meetings"
            meetingIds={[movingProjectMeeting.id]}
            sourceProjectId={currentProjectId}
            title={movingProjectMeeting.title}
            onClose={() => setMovingProjectMeeting(null)}
            onMoved={() => fetchMeetings(currentPage)}
          />
        )}
```

- [ ] **Step 3: 빌드 + 회의목록 테스트 확인**

Run: `cd frontend && npx vitest run src/components/meeting/MeetingListUI.test.tsx && npx vite build`
Expected: 기존 MeetingListUI 테스트 PASS(onMoveProject 누락으로 깨지면 테스트의 props에 `onMoveProject={()=>{}}` 추가), build 클린.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/components/meeting/MeetingListUI.tsx frontend/src/pages/MeetingsPage.tsx frontend/src/components/meeting/MeetingListUI.test.tsx
git commit -m "feat(move): 회의 ⋯ 메뉴 프로젝트 이동 진입점"
```

---

## Task 7: 프론트 — 폴더 ⋯ 메뉴 진입점 배선

**Files:**
- Modify: `frontend/src/components/folder/FolderTree.tsx` (메뉴 항목 + 모달 + 핸들러)

전제: `FolderTreeItem`은 `folder`(FolderNode) 보유. 원본 프로젝트 = `useProjectStore.currentProjectId`(폴더트리는 현재 프로젝트로 스코핑됨). 이동 성공 후 폴더트리+회의목록 갱신 필요 — `useFolderStore.getState().fetchFolders()`(인자 없음) + `useMeetingStore.getState().fetchMeetings()`.

- [ ] **Step 1: import + 상태 + 핸들러 추가**

`FolderTree.tsx` `FolderTreeItem` 컴포넌트:

(a) import 추가:
```ts
import MoveToProjectModal from '../project/MoveToProjectModal'
import { useProjectStore } from '../../stores/projectStore'
```
(b) 상태 추가(`showGlossaryDialog` 근처):
```ts
const [showMoveProject, setShowMoveProject] = useState(false)
const currentProjectId = useProjectStore((s) => s.currentProjectId)
```

- [ ] **Step 2: 메뉴 항목 추가**

폴더 메뉴의 "삭제" 버튼 위(오타 사전 버튼과 삭제 사이)에 추가:
```tsx
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMenu(false)
                  setShowMoveProject(true)
                }}
                className="flex items-center gap-2 w-full px-3 py-2.5 min-h-[44px] text-sm hover:bg-muted transition-colors"
              >
                <FolderInput className="w-3.5 h-3.5" /> 프로젝트 이동
              </button>
```
> `FolderInput`을 lucide import 목록(2행 import 블록)에 추가.

- [ ] **Step 3: 모달 렌더**

`{showGlossaryDialog && (...)}` 블록(246행 근처) 아래에 추가:
```tsx
      {showMoveProject && currentProjectId != null && (
        <MoveToProjectModal
          mode="folder"
          folderId={folder.id}
          sourceProjectId={currentProjectId}
          title={folder.name}
          onClose={() => setShowMoveProject(false)}
          onMoved={() => {
            useFolderStore.getState().fetchFolders()
            useMeetingStore.getState().fetchMeetings()
          }}
        />
      )}
```
> `useFolderStore`/`useMeetingStore`는 파일 상단에 이미 import됨. 확정 액션명: `folderStore.fetchFolders()`(현재 프로젝트 트리 리로드, 인자 없음), `meetingStore.fetchMeetings(page?)`(기본 1페이지).

- [ ] **Step 4: 빌드 확인**

Run: `cd frontend && npx vite build`
Expected: 클린. 타입 에러 시 store 액션 시그니처 맞춤.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/folder/FolderTree.tsx
git commit -m "feat(move): 폴더 ⋯ 메뉴 프로젝트 이동 진입점"
```

---

## Task 8: 별건 — 회의 삭제 웹 무반응 버그 수정

스펙의 "미해결·후속"에 명시된 독립 버그. `MeetingsPage.tsx:182`가 Tauri `confirm`을 직접 import해 웹(비-Tauri)에서 throw → 삭제 무반응. 런타임 분기로 수정.

**Files:**
- Modify: `frontend/src/pages/MeetingsPage.tsx` (handleDeleteMeeting)

- [ ] **Step 1: isTauri 감지 유틸 확인**

Run: `cd frontend && grep -rn "isTauri\|__TAURI" src/config.ts src/lib | head`
Expected: 기존 `isTauri()` 유틸 유무 확인. 있으면 재사용, 없으면 `typeof (window as any).__TAURI_INTERNALS__ !== 'undefined'` 인라인 판별.

- [ ] **Step 2: handleDeleteMeeting 분기 + try/catch**

`MeetingsPage.tsx`의 `handleDeleteMeeting`(181~187행)을 교체:
```ts
  const handleDeleteMeeting = useCallback(async (meeting: Meeting) => {
    const isTauri = typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined'
    let ok: boolean
    if (isTauri) {
      const { confirm } = await import('@tauri-apps/plugin-dialog')
      ok = await confirm(`"${meeting.title}" 회의를 삭제하시겠습니까?`, { title: '회의 삭제', kind: 'warning' })
    } else {
      ok = window.confirm(`"${meeting.title}" 회의를 삭제하시겠습니까?`)
    }
    if (!ok) return
    try {
      await deleteMeeting(meeting.id)
      fetchMeetings(currentPage)
    } catch (e) {
      console.error('[deleteMeeting] 실패:', e)
    }
  }, [fetchMeetings, currentPage])
```
> 기존 `isTauri()` 유틸이 있으면 인라인 판별 대신 그것을 import해 사용.

- [ ] **Step 3: 빌드 확인**

Run: `cd frontend && npx vite build`
Expected: 클린.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/pages/MeetingsPage.tsx
git commit -m "fix(meeting): 웹에서 회의 삭제 무반응 수정 (Tauri confirm 분기)"
```

---

## 최종 검증 (전체 완료 후)

- [ ] 백엔드 전체: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_move_to_project_spec.rb spec/requests/api/v1/folders_move_to_project_spec.rb spec/models/folder_subtree_spec.rb spec/requests/api/v1/folders_spec.rb spec/requests/api/v1/meetings_project_isolation_spec.rb`
- [ ] 프론트 전체: `cd frontend && npx vitest run && npx vite build`
- [ ] 웹 E2E(https://localhost:13443): 회의 ⋯ "프로젝트 이동" → 모달 → 대상 선택 → 이동 → 목록 반영. 폴더 ⋯ "프로젝트 이동" → 서브트리 이동 확인. 회의 삭제 동작 확인.
- [ ] DB 안전: E2E 전 `cp storage/development.sqlite3 /tmp/ddobak_premove_$(date +%s).sqlite3` 백업.

## 미해결·후속
- 회의 일괄 선택/이동 UI(다중선택 인프라). 백엔드는 이미 배열 수신.
- 이동 시 대상 폴더 직접 지정.
