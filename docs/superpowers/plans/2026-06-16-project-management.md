# 프로젝트별 관리 기능 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회의·폴더를 "프로젝트" 단위로 격리·관리한다(엄격 격리 + 전역 admin override, 개인 프로젝트 디폴트, 초대코드 가입, 통합 아이콘, 사이드바 드롭다운 + 그리드 페이지).

**Architecture:** 휴면 `teams` 인프라를 `Project`로 리네임·부활한다. (1) DB·코드 리네임(무동작변경 리팩토링) → (2) 프로젝트 필드·초대·개인프로젝트 모델 → (3) 안전 백필 + NOT NULL → (4) 멤버십 기반 접근제어 스코핑 → (5) 백엔드 API → (6) 프론트엔드. 각 Phase는 테스트 green 상태로 끝나고 커밋한다.

**Tech Stack:** Rails 8.1 + SQLite + RSpec/FactoryBot/shoulda-matchers (백엔드), React+TS+Tauri + zustand + ky + Vitest/@testing-library (프론트), Devise+JWT(JTIMatcher), lucide-react.

**관련 문서:** 설계 spec `docs/superpowers/specs/2026-06-16-project-management-design.md` (결정 D1–D11).

**브랜치:** `feat/project-management` (이미 생성됨).

---

## ⚠️ 안전 원칙 (전 Phase 공통)

이 코드베이스는 과거 잘못된 마이그레이션(`NOT IN` 빈집합 → `destroy_all`)으로 전사·회의록 전멸 사고가 있었다. **마이그레이션에서 `destroy_all`/`delete_all`/`NOT IN` 금지. INSERT·UPDATE만. NOT NULL은 사전 가드 통과 후에만.** 마이그레이션은 dev 서버를 멈춘 뒤 실행하거나 `db/migrate_pending/` 패턴을 따른다(러닝 dev서버 PendingMigration 500 회피).

테스트 실행:
- 백엔드: `cd backend && bundle exec rspec <path>`
- 프론트: `cd frontend && npm run test`

---

## 파일 구조 (생성/수정 맵)

### 백엔드 — 수정
- `backend/app/models/meeting.rb` — `belongs_to :team`→`:project`, `accessible_by` 스코핑
- `backend/app/models/folder.rb` — `belongs_to :team`→`:project`, `tree(user, project_id)`
- `backend/app/models/user.rb` — `team_memberships`→`project_memberships`, `teams`→`projects`, `after_create :ensure_personal_project`
- `backend/app/models/tag.rb` — `belongs_to :team`→`:project` (있으면)
- `backend/app/controllers/api/v1/meetings_controller.rb` — project_id 스코핑(index/create/upload_audio/move_to_folder)
- `backend/app/controllers/api/v1/folders_controller.rb` — project 멤버십 가드 + tree(project)
- `backend/app/controllers/api/v1/tags_controller.rb` — project_id 스코핑
- `backend/app/controllers/concerns/meeting_lookup.rb` — 프로젝트 경계 검증
- `backend/app/controllers/concerns/meeting_serializable.rb` — `project_id` 포함
- `backend/config/routes.rb` — `teams`→`projects` 확장 + invites + 공개 invite 라우트

### 백엔드 — 생성
- `backend/app/models/project.rb` (← team.rb 리네임 + 확장)
- `backend/app/models/project_membership.rb` (← team_membership.rb 리네임)
- `backend/app/models/project_invite.rb`
- `backend/app/controllers/api/v1/projects_controller.rb` (← teams_controller.rb 리네임 + 확장)
- `backend/app/controllers/api/v1/invites_controller.rb`
- `backend/app/controllers/concerns/project_scoped.rb`
- `backend/app/services/ensure_personal_project.rb`
- 마이그레이션 4개(아래 Phase별)

### 프론트 — 생성
- `frontend/src/api/projects.ts`
- `frontend/src/stores/projectStore.ts`
- `frontend/src/components/project/ProjectIcon.tsx`
- `frontend/src/components/project/ProjectSwitcher.tsx`
- `frontend/src/components/project/ProjectDialog.tsx` (생성/편집 + 아이콘 피커)
- `frontend/src/components/project/IconPicker.tsx`
- `frontend/src/components/project/ProjectMembersPanel.tsx`
- `frontend/src/pages/ProjectsPage.tsx`
- `frontend/src/pages/InviteRedeemPage.tsx`

### 프론트 — 수정
- `frontend/src/components/layout/Sidebar.tsx` — 제목 자리에 ProjectSwitcher
- `frontend/src/App.tsx` — `/projects`, `/invite/:code` 라우트
- `frontend/src/stores/folderStore.ts` — fetch에 project_id
- `frontend/src/stores/meetingStore.ts` — fetch/create에 project_id
- `frontend/src/api/folders.ts` / `meetings.ts` — project_id 파라미터

---

# Phase 1 — Team→Project 리네임 (리팩토링, 동작 변경 0)

**목표:** 휴면 teams 인프라를 Project로 리네임. DB + 모델 + 컨트롤러 + 라우트 + 팩토리 + 스펙. 끝나면 기존 전체 스위트가 green이어야 한다(순수 리네임).

> teams/team_memberships 테이블은 실사용 0행이라 데이터 리스크 없음. FK가 가리키는 테이블명만 갈아끼우면 된다.

### Task 1.1: 리네임 마이그레이션

**Files:**
- Create: `backend/db/migrate/20260617000001_rename_teams_to_projects.rb`

- [ ] **Step 1: 마이그레이션 작성**

```ruby
class RenameTeamsToProjects < ActiveRecord::Migration[8.1]
  # 휴면 teams 인프라를 Project로 리네임(무데이터 리스크 — 실사용 0행).
  # teams 테이블을 가리키는 FK(meetings/tags/team_memberships→teams)를 먼저 떼고,
  # 테이블·컬럼을 리네임한 뒤 projects 로 다시 건다.
  def up
    remove_foreign_key :meetings, :teams, if_exists: true
    remove_foreign_key :tags, :teams, if_exists: true
    remove_foreign_key :team_memberships, :teams, if_exists: true

    rename_table :teams, :projects
    rename_table :team_memberships, :project_memberships

    rename_column :meetings, :team_id, :project_id
    rename_column :folders, :team_id, :project_id
    rename_column :tags, :team_id, :project_id

    # 재연결. meetings/folders 는 project_id 가 곧 NOT NULL 이 되므로 cascade/nullify 대신 기본(restrict).
    # (프로젝트 삭제는 앱에서 '비어있을 때만' 으로 막으므로 on_delete 는 사실상 트리거 안 됨.)
    add_foreign_key :meetings, :projects, column: :project_id
    add_foreign_key :folders, :projects, column: :project_id
    add_foreign_key :tags, :projects, column: :project_id, on_delete: :cascade
    add_foreign_key :project_memberships, :projects, on_delete: :cascade
  end

  def down
    remove_foreign_key :meetings, :projects, column: :project_id, if_exists: true
    remove_foreign_key :folders, :projects, column: :project_id, if_exists: true
    remove_foreign_key :tags, :projects, column: :project_id, if_exists: true
    remove_foreign_key :project_memberships, :projects, if_exists: true

    rename_column :tags, :project_id, :team_id
    rename_column :folders, :project_id, :team_id
    rename_column :meetings, :project_id, :team_id

    rename_table :project_memberships, :team_memberships
    rename_table :projects, :teams

    add_foreign_key :meetings, :teams, on_delete: :cascade
    add_foreign_key :tags, :teams
    add_foreign_key :team_memberships, :teams, on_delete: :cascade
  end
end
```

- [ ] **Step 2: dev 서버 멈춘 상태에서 마이그레이션 실행**

Run: `cd backend && bundle exec rails db:migrate`
Expected: 성공. `db/schema.rb`에 `projects`, `project_memberships` 테이블 + meetings/folders/tags의 `project_id` 컬럼 생성.

- [ ] **Step 3: 스키마·FK·행수 검증 (사고 방지)**

Run:
```bash
cd backend && bundle exec rails runner '
puts "projects table: #{ActiveRecord::Base.connection.table_exists?(:projects)}"
puts "project_memberships: #{ActiveRecord::Base.connection.table_exists?(:project_memberships)}"
puts "meetings.project_id: #{Meeting.column_names.include?("project_id")}"
puts "meetings count: #{Meeting.count}"  # 마이그 전후 동일해야 함
'
```
Expected: 모두 true, meetings count 보존(리네임은 데이터 무변경).

- [ ] **Step 4: git add (커밋은 Task 1.4에서 모델·코드 리네임 후 함께)**

### Task 1.2: 모델·컨트롤러 파일 리네임

**Files:**
- Rename: `backend/app/models/team.rb` → `project.rb`
- Rename: `backend/app/models/team_membership.rb` → `project_membership.rb`
- Rename: `backend/app/controllers/api/v1/teams_controller.rb` → `projects_controller.rb`
- Modify: `backend/app/models/meeting.rb`, `folder.rb`, `user.rb`, `tag.rb`

- [ ] **Step 1: Project 모델 (team.rb 내용 리네임)**

`backend/app/models/project.rb`:
```ruby
class Project < ApplicationRecord
  belongs_to :creator, class_name: "User", foreign_key: :created_by_id
  has_many :project_memberships, dependent: :destroy
  has_many :members, through: :project_memberships, source: :user
  has_many :meetings, dependent: :restrict_with_error
  has_many :folders, dependent: :restrict_with_error

  validates :name, presence: true
end
```
그리고 `backend/app/models/team.rb` 삭제.

- [ ] **Step 2: ProjectMembership 모델**

`backend/app/models/project_membership.rb`:
```ruby
class ProjectMembership < ApplicationRecord
  belongs_to :user
  belongs_to :project

  validates :role, inclusion: { in: %w[admin member] }
  validates :user_id, uniqueness: { scope: :project_id, message: "is already a member of this project" }
end
```
그리고 `backend/app/models/team_membership.rb` 삭제.

- [ ] **Step 3: 참조 갱신 — meeting.rb / folder.rb**

`backend/app/models/meeting.rb` 첫 association 한 줄:
```ruby
belongs_to :project, optional: true   # 기존: belongs_to :team, optional: true
```
`backend/app/models/folder.rb` 첫 association 한 줄:
```ruby
belongs_to :project, optional: true   # 기존: belongs_to :team, optional: true
```

- [ ] **Step 4: user.rb 참조 갱신**

`backend/app/models/user.rb` lines 8–9:
```ruby
  has_many :project_memberships, dependent: :destroy
  has_many :projects, through: :project_memberships
```
(기존 `team_memberships`/`teams` 두 줄 교체)

- [ ] **Step 5: tag.rb 참조 갱신 (있으면)**

Run: `grep -n "belongs_to :team" backend/app/models/tag.rb`
있으면 `belongs_to :project, optional: true`로 교체. 없으면 skip.

- [ ] **Step 6: projects_controller (teams_controller 리네임 — Phase 1은 클래스명·team→project 변수만, 확장은 Phase 5)**

`backend/app/controllers/api/v1/projects_controller.rb` (teams_controller.rb의 `Team`→`Project`, `team`→`project`, `TeamMembership`→`ProjectMembership`, `team_memberships`→`project_memberships`, `team_id`→`project_id` 일괄 치환). 그리고 teams_controller.rb 삭제.

### Task 1.3: 라우트 리네임

**Files:**
- Modify: `backend/config/routes.rb`

- [ ] **Step 1: teams 라우트를 projects로**

`backend/config/routes.rb`의 Teams 블록 교체:
```ruby
      # Projects
      resources :projects, only: %i[index create] do
        member do
          post :invite
          delete "members/:user_id", action: :remove_member, as: :remove_member
        end
      end
```
(Phase 5에서 show/update/destroy/invites 확장)

### Task 1.4: 팩토리·스펙 리네임 + 전체 스위트 green

**Files:**
- Rename: `backend/spec/factories/teams.rb` → `projects.rb`, `team_memberships.rb` → `project_memberships.rb`
- Modify: `backend/spec/factories/meetings.rb` + 모든 `:team` 참조 스펙

- [ ] **Step 1: 팩토리 리네임**

`backend/spec/factories/projects.rb`:
```ruby
FactoryBot.define do
  factory :project do
    sequence(:name) { |n| "Project #{n}" }
    association :creator, factory: :user
  end
end
```
`backend/spec/factories/project_memberships.rb`:
```ruby
FactoryBot.define do
  factory :project_membership do
    association :user
    association :project
    role { "member" }
  end
end
```
기존 teams.rb / team_memberships.rb 삭제.

- [ ] **Step 2: meeting 팩토리 갱신**

`backend/spec/factories/meetings.rb`의 `association :team` → `association :project`.

- [ ] **Step 3: 스펙 전수 치환**

Run:
```bash
cd backend && grep -rl ":team\b\|team_membership\|create(:team\|team:" spec/ | sort -u
```
각 파일에서 `:team`→`:project`, `:team_membership`→`:project_membership`, `team:`→`project:`, `create(:team`→`create(:project` 치환. (예: action_items_spec.rb의 `create(:team, creator: user)` → `create(:project, creator: user)`, `create(:team_membership, user: user, team: team, ...)` → `create(:project_membership, user: user, project: project, ...)`, `create(:meeting, team: team, ...)` → `create(:meeting, project: project, ...)`)

- [ ] **Step 4: 전체 스위트 실행 → green**

Run: `cd backend && bundle exec rspec`
Expected: 전부 PASS (순수 리네임, 동작 변경 0). 실패하면 누락된 team 참조 — `grep -rn "Team\|team_id\|:team" backend/app backend/spec`로 추적.

- [ ] **Step 5: 커밋**

```bash
cd backend && bundle exec rspec >/dev/null && cd .. && \
git add backend/ && \
git commit -m "refactor(project): Team→Project 리네임 (DB·모델·라우트·스펙, 동작 변경 0)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Phase 2 — 프로젝트 필드 · 초대 · 개인 프로젝트 모델

**목표:** Project에 정보/아이콘/personal 필드 추가, ProjectInvite 모델, 신규 유저 개인 프로젝트 자동 생성. 백필은 Phase 3.

### Task 2.1: 필드·초대 테이블 마이그레이션

**Files:**
- Create: `backend/db/migrate/20260617000002_add_project_fields_and_invites.rb`

- [ ] **Step 1: 마이그레이션 작성**

```ruby
class AddProjectFieldsAndInvites < ActiveRecord::Migration[8.1]
  def change
    add_column :projects, :description, :text
    add_column :projects, :icon_type, :string     # 'lucide' | 'emoji' | 'image'
    add_column :projects, :icon_value, :string     # 아이콘명 / 이모지문자 / 파일경로
    add_column :projects, :color, :string           # hex 배경색
    add_column :projects, :personal, :boolean, null: false, default: false
    add_index :projects, :personal

    create_table :project_invites do |t|
      t.references :project, null: false, foreign_key: { on_delete: :cascade }
      t.string :code, null: false
      t.integer :created_by_id, null: false
      t.datetime :expires_at
      t.integer :max_uses
      t.integer :use_count, null: false, default: 0
      t.timestamps
    end
    add_index :project_invites, :code, unique: true
  end
end
```

- [ ] **Step 2: 마이그레이션 실행**

Run: `cd backend && bundle exec rails db:migrate`
Expected: projects에 신규 컬럼 + project_invites 테이블. schema.rb 갱신.

### Task 2.2: Project 모델 — 검증·personal·삭제가드·아이콘

**Files:**
- Modify: `backend/app/models/project.rb`
- Test: `backend/spec/models/project_spec.rb`

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/models/project_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe Project, type: :model do
  describe "validations" do
    it { is_expected.to validate_presence_of(:name) }

    it "icon_type을 lucide/emoji/image로 제한한다" do
      expect(build(:project, icon_type: "lucide")).to be_valid
      expect(build(:project, icon_type: "bogus")).not_to be_valid
      expect(build(:project, icon_type: nil)).to be_valid
    end
  end

  describe "#deletable?" do
    let(:project) { create(:project) }

    it "회의·폴더가 없으면 true" do
      expect(project.deletable?).to be true
    end

    it "회의가 있으면 false" do
      create(:meeting, project: project, creator: project.creator)
      expect(project.deletable?).to be false
    end

    it "폴더가 있으면 false" do
      create(:folder, project: project)
      expect(project.deletable?).to be false
    end

    it "개인 프로젝트는 비어 있어도 false" do
      personal = create(:project, personal: true)
      expect(personal.deletable?).to be false
    end
  end

  describe "#admin?" do
    it "해당 유저의 멤버십 role이 admin이면 true" do
      project = create(:project)
      user = create(:user)
      create(:project_membership, project: project, user: user, role: "admin")
      expect(project.admin?(user)).to be true
    end

    it "member면 false" do
      project = create(:project)
      user = create(:user)
      create(:project_membership, project: project, user: user, role: "member")
      expect(project.admin?(user)).to be false
    end
  end
end
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && bundle exec rspec spec/models/project_spec.rb`
Expected: FAIL (deletable?/admin? 미정의, icon_type 검증 없음). folder 팩토리가 project를 요구하면 Step 3에서 팩토리도 손봄.

- [ ] **Step 3: Project 모델 구현**

`backend/app/models/project.rb`:
```ruby
class Project < ApplicationRecord
  ICON_TYPES = %w[lucide emoji image].freeze

  belongs_to :creator, class_name: "User", foreign_key: :created_by_id
  has_many :project_memberships, dependent: :destroy
  has_many :members, through: :project_memberships, source: :user
  has_many :meetings, dependent: :restrict_with_error
  has_many :folders, dependent: :restrict_with_error
  has_many :project_invites, dependent: :destroy

  validates :name, presence: true
  validates :icon_type, inclusion: { in: ICON_TYPES }, allow_nil: true

  # 삭제 가능 = 개인 프로젝트가 아니고, 회의·폴더가 0건일 때만(데이터 보호).
  def deletable?
    !personal? && meetings.none? && folders.none?
  end

  def member?(user)
    return false unless user
    project_memberships.exists?(user_id: user.id)
  end

  def admin?(user)
    return false unless user
    project_memberships.exists?(user_id: user.id, role: "admin")
  end
end
```

- [ ] **Step 4: folder/project 팩토리 보강**

`backend/spec/factories/folders.rb`에 `association :project` 추가(폴더가 project 필수가 되기 전이라도 테스트 일관성). 없으면 생성:
```ruby
FactoryBot.define do
  factory :folder do
    sequence(:name) { |n| "Folder #{n}" }
    association :project
  end
end
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd backend && bundle exec rspec spec/models/project_spec.rb`
Expected: PASS.

### Task 2.3: ProjectInvite 모델

**Files:**
- Create: `backend/app/models/project_invite.rb`
- Create: `backend/spec/factories/project_invites.rb`
- Test: `backend/spec/models/project_invite_spec.rb`

- [ ] **Step 1: 실패 테스트**

`backend/spec/models/project_invite_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe ProjectInvite, type: :model do
  let(:project) { create(:project) }

  describe ".generate!" do
    it "6자 영숫자 코드를 만든다" do
      invite = ProjectInvite.generate!(project: project, created_by: project.creator)
      expect(invite.code).to match(/\A[a-zA-Z0-9]{6}\z/)
    end
  end

  describe "#redeemable?" do
    it "만료·횟수 제한 없으면 true" do
      invite = ProjectInvite.generate!(project: project, created_by: project.creator)
      expect(invite.redeemable?).to be true
    end

    it "만료되면 false" do
      invite = ProjectInvite.generate!(project: project, created_by: project.creator, expires_at: 1.hour.ago)
      expect(invite.redeemable?).to be false
    end

    it "최대 횟수 도달하면 false" do
      invite = ProjectInvite.generate!(project: project, created_by: project.creator, max_uses: 1)
      invite.update!(use_count: 1)
      expect(invite.redeemable?).to be false
    end
  end
end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/models/project_invite_spec.rb`
Expected: FAIL (ProjectInvite 미존재).

- [ ] **Step 3: 모델·팩토리 구현**

`backend/app/models/project_invite.rb`:
```ruby
class ProjectInvite < ApplicationRecord
  belongs_to :project
  belongs_to :creator, class_name: "User", foreign_key: :created_by_id

  validates :code, presence: true, uniqueness: true

  # 회의 share_code 패턴(SecureRandom.alphanumeric)을 재사용.
  def self.generate!(project:, created_by:, expires_at: nil, max_uses: nil)
    create!(
      project: project,
      created_by: created_by,
      code: loop { c = SecureRandom.alphanumeric(6); break c unless exists?(code: c) },
      expires_at: expires_at,
      max_uses: max_uses
    )
  end

  def redeemable?
    return false if expires_at && expires_at < Time.current
    return false if max_uses && use_count >= max_uses
    true
  end

  def consume!
    increment!(:use_count)
  end
end
```
`backend/spec/factories/project_invites.rb`:
```ruby
FactoryBot.define do
  factory :project_invite do
    association :project
    association :creator, factory: :user
    sequence(:code) { |n| format("c%05d", n)[0, 6] }
  end
end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/models/project_invite_spec.rb`
Expected: PASS.

### Task 2.4: 신규 유저 개인 프로젝트 자동 생성

**Files:**
- Create: `backend/app/services/ensure_personal_project.rb`
- Modify: `backend/app/models/user.rb`
- Test: `backend/spec/models/user_spec.rb` (추가)

- [ ] **Step 1: 실패 테스트 추가**

`backend/spec/models/user_spec.rb`에 추가:
```ruby
  describe "개인 프로젝트 자동 생성" do
    it "유저 생성 시 personal 프로젝트와 admin 멤버십이 만들어진다" do
      user = create(:user)
      personal = user.projects.find_by(personal: true)
      expect(personal).to be_present
      expect(personal.admin?(user)).to be true
    end

    it "개인 프로젝트는 1개만 (재호출 멱등)" do
      user = create(:user)
      EnsurePersonalProject.call(user)
      expect(user.projects.where(personal: true).count).to eq(1)
    end
  end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/models/user_spec.rb -e "개인 프로젝트"`
Expected: FAIL.

- [ ] **Step 3: 서비스 + 콜백 구현**

`backend/app/services/ensure_personal_project.rb`:
```ruby
# 유저의 개인 프로젝트(personal: true)를 보장한다. 멱등.
class EnsurePersonalProject
  def self.call(user)
    existing = user.projects.find_by(personal: true)
    return existing if existing

    project = Project.create!(
      name: "내 회의",
      creator: user,
      personal: true,
      icon_type: "lucide",
      icon_value: "user",
      color: "#6366f1"
    )
    ProjectMembership.create!(project: project, user: user, role: "admin")
    project
  end
end
```
`backend/app/models/user.rb`에 콜백 추가(Devise include 아래, 연관 선언 뒤):
```ruby
  after_create :ensure_personal_project

  private

  def ensure_personal_project
    EnsurePersonalProject.call(self)
  end

  public
```
> 주의: user.rb에 이미 public 메서드가 많다. 콜백·private 메서드는 클래스 끝부분에 두고, 기존 public 메서드 영역을 침범하지 않도록 `private`/`public` 토글을 정확히 배치하거나, 콜백 메서드를 기존 public 영역에 두고 `after_create`만 선언한다(가장 단순). 단순안:
```ruby
  # 연관 선언 근처
  after_create { EnsurePersonalProject.call(self) }
```

- [ ] **Step 4: 통과 + 전체 스위트 영향 확인**

Run: `cd backend && bundle exec rspec spec/models/user_spec.rb`
Run: `cd backend && bundle exec rspec`
Expected: PASS. (주의: 다른 스펙에서 `create(:user)`가 이제 부수적으로 Project 1개 생성 — 카운트 단언이 깨지면 해당 스펙 수정. 대개 무영향.)

- [ ] **Step 5: 커밋**

```bash
cd backend && bundle exec rspec >/dev/null && cd .. && \
git add backend/ && \
git commit -m "feat(project): 프로젝트 필드·초대 모델·개인 프로젝트 자동생성

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Phase 3 — 백필 + NOT NULL (⚠️ 데이터 안전 핵심)

**목표:** 공용 "기본" 프로젝트 생성 + 전 유저 멤버 + 개인 프로젝트 + 기존 회의/폴더/태그를 "기본"으로 이관. 그 후 `project_id` NOT NULL. 백필 로직은 멱등 서비스로 분리해 테스트한다.

### Task 3.1: BackfillProjects 서비스 (멱등, INSERT/UPDATE만)

**Files:**
- Create: `backend/app/services/backfill_projects.rb`
- Test: `backend/spec/services/backfill_projects_spec.rb`

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/services/backfill_projects_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe BackfillProjects do
  describe ".call" do
    it "유저가 없으면 아무것도 안 한다" do
      expect { described_class.call }.not_to change(Project, :count)
    end

    context "기존 유저·데이터가 있을 때" do
      let!(:admin) { create(:user, :admin) }
      let!(:member) { create(:user) }

      before do
        # 개인 프로젝트 자동생성을 끄고 '레거시 상태'(project_id 없음)를 만든다.
        Project.delete_all
        ProjectMembership.delete_all
        @m = Meeting.create!(title: "old", created_by_id: member.id, project_id: nil, important: true)
        @f = Folder.create!(name: "oldf", project_id: nil)
      end

      it "기본 프로젝트를 만들고 전 유저를 멤버로 넣는다" do
        described_class.call
        base = Project.find_by(name: "기본", personal: false)
        expect(base).to be_present
        expect(base.member?(admin)).to be true
        expect(base.member?(member)).to be true
        expect(base.admin?(admin)).to be true   # 전역 admin → 프로젝트 admin
      end

      it "유저마다 개인 프로젝트를 만든다" do
        described_class.call
        expect(admin.projects.where(personal: true).count).to eq(1)
        expect(member.projects.where(personal: true).count).to eq(1)
      end

      it "고아 회의·폴더를 기본으로 이관한다 (파괴 없이)" do
        expect { described_class.call }.not_to change(Meeting, :count)
        base = Project.find_by(name: "기본", personal: false)
        expect(@m.reload.project_id).to eq(base.id)
        expect(@f.reload.project_id).to eq(base.id)
      end

      it "두 번 호출해도 안전(멱등)" do
        described_class.call
        expect { described_class.call }.not_to change(Project, :count)
        expect(ProjectMembership.where(project: Project.find_by(name: "기본")).count).to eq(2)
      end
    end
  end
end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/services/backfill_projects_spec.rb`
Expected: FAIL (BackfillProjects 미존재).

- [ ] **Step 3: 서비스 구현 (파괴 연산 0)**

`backend/app/services/backfill_projects.rb`:
```ruby
# 1회성 백필 — 공용 "기본" 프로젝트 생성 + 전 유저 멤버 + 개인 프로젝트 + 고아 데이터 이관.
# 원칙: INSERT/UPDATE만. destroy/delete/NOT IN 절대 금지. 멱등(재실행 안전).
class BackfillProjects
  def self.call
    users = User.order(:id).to_a
    return if users.empty?

    owner = User.find_by(email: User::LOCAL_EMAIL) ||
            User.where(role: "admin").order(:id).first ||
            users.first

    base = Project.find_or_create_by!(name: "기본", personal: false) do |p|
      p.created_by_id = owner.id
      p.icon_type = "lucide"
      p.icon_value = "home"
      p.color = "#6366f1"
    end

    users.each do |u|
      ProjectMembership.find_or_create_by!(project_id: base.id, user_id: u.id) do |pm|
        pm.role = u.admin? ? "admin" : "member"
      end
      EnsurePersonalProject.call(u)
    end

    # 고아(project_id IS NULL) 데이터만 기본으로. WHERE project_id IS NULL — NOT IN 안 씀.
    Meeting.where(project_id: nil).update_all(project_id: base.id)
    Folder.where(project_id: nil).update_all(project_id: base.id)
    Tag.where(project_id: nil).update_all(project_id: base.id)

    base
  end
end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/services/backfill_projects_spec.rb`
Expected: PASS.

### Task 3.2: 백필 마이그레이션

**Files:**
- Create: `backend/db/migrate/20260617000003_backfill_projects.rb`

- [ ] **Step 1: 마이그레이션 작성 (서비스 호출, down 비가역)**

```ruby
class BackfillProjects < ActiveRecord::Migration[8.1]
  def up
    # 서비스에 위임(테스트로 검증된 멱등 백필). reset_column_information 으로 신규 컬럼 인지.
    Project.reset_column_information
    ProjectMembership.reset_column_information
    Meeting.reset_column_information
    Folder.reset_column_information
    Tag.reset_column_information
    say_with_time "Backfilling projects (기본 + 개인 + 고아 이관)" do
      ::BackfillProjects.call
    end
  end

  def down
    # 백필은 데이터 생성/이관 — 비가역. 복원하지 않는다.
    raise ActiveRecord::IrreversibleMigration
  end
end
```
> 주의: 마이그 클래스명과 서비스명이 같으므로 `::BackfillProjects.call`로 최상위 서비스를 명시 호출(마이그 클래스 자신과 충돌 회피).

- [ ] **Step 2: dev 서버 멈춘 상태에서 실행 + 검증**

Run: `cd backend && bundle exec rails db:migrate`
Run:
```bash
cd backend && bundle exec rails runner '
base = Project.find_by(name: "기본", personal: false)
puts "기본: #{base&.id}"
puts "nil meetings: #{Meeting.where(project_id: nil).count}"   # 0 이어야 함
puts "nil folders:  #{Folder.where(project_id: nil).count}"    # 0
puts "nil tags:     #{Tag.where(project_id: nil).count}"       # 0
'
```
Expected: 기본 프로젝트 존재, nil 카운트 전부 0.

### Task 3.3: NOT NULL 제약 (사전 가드)

**Files:**
- Create: `backend/db/migrate/20260617000004_add_project_id_not_null.rb`

- [ ] **Step 1: 마이그레이션 작성 (가드 통과 후에만 제약)**

```ruby
class AddProjectIdNotNull < ActiveRecord::Migration[8.1]
  def up
    %w[meetings folders tags].each do |t|
      nulls = select_value("SELECT COUNT(*) FROM #{t} WHERE project_id IS NULL").to_i
      if nulls.positive?
        raise "#{t}: project_id NULL #{nulls}건 — 백필 미완. NOT NULL 중단(무변경)."
      end
    end
    change_column_null :meetings, :project_id, false
    change_column_null :folders, :project_id, false
    change_column_null :tags, :project_id, false
  end

  def down
    change_column_null :meetings, :project_id, true
    change_column_null :folders, :project_id, true
    change_column_null :tags, :project_id, true
  end
end
```

- [ ] **Step 2: 실행 + 전체 스위트**

Run: `cd backend && bundle exec rails db:migrate`
Run: `cd backend && bundle exec rspec`
Expected: 마이그 성공, 스위트 green. (factory의 meeting은 `association :project`라 NOT NULL 충족.)

- [ ] **Step 3: 커밋**

```bash
cd backend && bundle exec rspec >/dev/null && cd .. && \
git add backend/ && \
git commit -m "feat(project): 백필 서비스+마이그(기본 프로젝트·개인·이관) + project_id NOT NULL 가드

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Phase 4 — 접근제어 스코핑 (멤버십 기반)

**목표:** 멤버인 프로젝트만 보이게. 전역 admin은 전체. 프로젝트 내부에선 기존 shared/private 규칙 유지.

### Task 4.1: ProjectScoped 컨트롤러 컨선

**Files:**
- Create: `backend/app/controllers/concerns/project_scoped.rb`

- [ ] **Step 1: 컨선 구현**

`backend/app/controllers/concerns/project_scoped.rb`:
```ruby
# 요청의 project_id 를 현재 프로젝트로 해석하고 멤버십을 강제한다.
# 전역 admin 은 모든 프로젝트 접근. 비멤버는 403.
module ProjectScoped
  extend ActiveSupport::Concern

  private

  # 멤버십(또는 admin) 확인된 Project 를 반환. 실패 시 render 후 nil.
  def require_project!(project_id = params[:project_id])
    if project_id.blank?
      render json: { error: "project_id is required" }, status: :bad_request
      return nil
    end
    project = Project.find_by(id: project_id)
    unless project
      render json: { error: "Project not found" }, status: :not_found
      return nil
    end
    unless project_admin_override? || project.member?(current_user)
      render json: { error: "이 프로젝트에 접근할 권한이 없습니다" }, status: :forbidden
      return nil
    end
    project
  end

  def project_admin_override?
    current_user.respond_to?(:admin?) && current_user.admin?
  end
end
```

### Task 4.2: Meeting.accessible_by 프로젝트 스코핑

**Files:**
- Modify: `backend/app/models/meeting.rb`
- Test: `backend/spec/models/meeting_spec.rb` (추가/수정)

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/models/meeting_spec.rb`에 추가:
```ruby
  describe ".accessible_by 프로젝트 격리" do
    let(:user)  { create(:user) }
    let(:p1)    { create(:project) }
    let(:p2)    { create(:project) }

    before { create(:project_membership, user: user, project: p1, role: "member") }

    it "멤버인 프로젝트의 공유 회의만 보인다" do
      mine = create(:meeting, project: p1, creator: user)
      other_shared = create(:meeting, project: p1, creator: create(:user), shared: true)
      foreign = create(:meeting, project: p2, creator: create(:user), shared: true)

      ids = Meeting.accessible_by(user).pluck(:id)
      expect(ids).to include(mine.id, other_shared.id)
      expect(ids).not_to include(foreign.id)   # 비멤버 프로젝트 → 안 보임
    end

    it "전역 admin은 프로젝트 무관 전부 본다" do
      admin = create(:user, :admin)
      foreign = create(:meeting, project: p2, creator: create(:user))
      expect(Meeting.accessible_by(admin).pluck(:id)).to include(foreign.id)
    end
  end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/models/meeting_spec.rb -e "프로젝트 격리"`
Expected: FAIL (foreign 회의가 보임 — 아직 프로젝트 필터 없음).

- [ ] **Step 3: accessible_by 수정**

`backend/app/models/meeting.rb` lines 102–112 교체:
```ruby
  scope :in_project, ->(pid) { pid.present? ? where(project_id: pid) : all }

  scope :accessible_by, ->(user) {
    if user.admin?
      all
    else
      member_pids = ProjectMembership.where(user_id: user.id).select(:project_id)
      base = where(project_id: member_pids)
      visible_shared = base.where(shared: true).where(
        "meetings.folder_id IS NULL OR meetings.folder_id IN (?)",
        Folder.visible_folder_ids
      )
      base.where(created_by_id: user.id).or(visible_shared)
    end
  }
```
> 비멤버 프로젝트는 `member_pids`에 없어 자동 제외. 프로젝트 내부에선 기존 own+shared 로직 그대로.

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/models/meeting_spec.rb`
Expected: PASS.

### Task 4.3: Folder.tree 프로젝트 스코핑

**Files:**
- Modify: `backend/app/models/folder.rb`
- Test: `backend/spec/models/folder_spec.rb` (추가)

- [ ] **Step 1: 실패 테스트**

`backend/spec/models/folder_spec.rb`에 추가:
```ruby
  describe ".tree project 스코핑" do
    it "지정 프로젝트의 폴더만 반환한다" do
      user = create(:user, :admin)
      p1 = create(:project); p2 = create(:project)
      f1 = create(:folder, project: p1, name: "A")
      _f2 = create(:folder, project: p2, name: "B")
      ids = Folder.tree(user, p1.id).map { |n| n[:id] }
      expect(ids).to eq([f1.id])
    end
  end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/models/folder_spec.rb -e "project 스코핑"`
Expected: FAIL (인자 개수/필터).

- [ ] **Step 3: tree 시그니처 확장**

`backend/app/models/folder.rb` line 82 `def self.tree(user = nil)` 교체:
```ruby
  def self.tree(user = nil, project_id = nil)
    base = ordered.includes(:tags)
    base = base.where(project_id: project_id) if project_id.present?
    all_folders = base.to_a
    if user && !user.admin?
      visible = visible_folder_ids.to_set
      all_folders = all_folders.select { |f| visible.include?(f.id) }
    end
    scope = user ? Meeting.accessible_by(user) : Meeting.all
    scope = scope.where(project_id: project_id) if project_id.present?
    meeting_counts = scope.where(folder_id: all_folders.map(&:id))
                          .group(:folder_id).count
    children_by_parent = all_folders.group_by(&:parent_id)
    roots = children_by_parent[nil] || []
    build_tree(roots, children_by_parent, meeting_counts)
  end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/models/folder_spec.rb`
Expected: PASS.

### Task 4.4: meeting_lookup 프로젝트 경계 + move_to_folder 가드

**Files:**
- Modify: `backend/app/controllers/concerns/meeting_lookup.rb`
- Modify: `backend/app/controllers/api/v1/meetings_controller.rb` (move_to_folder)
- Test: `backend/spec/requests/api/v1/meetings_spec.rb` (추가)

- [ ] **Step 1: 실패 테스트 (비멤버 show 403)**

`backend/spec/requests/api/v1/meetings_spec.rb`에 추가(없으면 생성):
```ruby
require "rails_helper"

RSpec.describe "Api::V1::Meetings project 격리", type: :request do
  let(:owner) { create(:user) }
  let(:outsider) { create(:user) }
  let(:project) { create(:project) }
  let!(:m) { create(:meeting, project: project, creator: owner, shared: true) }

  before { create(:project_membership, user: owner, project: project, role: "admin") }

  it "비멤버는 공유 회의라도 403" do
    login_as(outsider)
    get "/api/v1/meetings/#{m.id}"
    expect(response).to have_http_status(:forbidden)
  end

  it "멤버는 200" do
    create(:project_membership, user: outsider, project: project, role: "member")
    login_as(outsider)
    get "/api/v1/meetings/#{m.id}"
    expect(response).to have_http_status(:ok)
  end
end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_spec.rb -e "project 격리"`
Expected: FAIL (비멤버가 shared_visible로 200).

- [ ] **Step 3: meeting_lookup에 프로젝트 멤버십 게이트 추가**

`backend/app/controllers/concerns/meeting_lookup.rb`의 `authorize_meeting_read!`와 `authorize_meeting_control!` 맨 위(`return if meeting_admin?` 다음)에 추가:
```ruby
    # 프로젝트 격리: admin 이 아니면, 회의 소속 프로젝트의 멤버가 아닌 한 모든 접근 차단
    # (active participant 는 공유코드 참여라 예외 — read 한정).
    unless meeting_admin? || project_member?(@meeting)
      return if @meeting.active_participants.exists?(user_id: current_user.id) # read 경로에서만 의미
      return render json: { error: "이 프로젝트에 접근할 권한이 없습니다" }, status: :forbidden
    end
```
그리고 헬퍼 추가:
```ruby
  def project_member?(meeting)
    meeting.project_id && ProjectMembership.exists?(project_id: meeting.project_id, user_id: current_user.id)
  end
```
> 단, control 경로에선 participant 예외를 두면 안 되므로 control 용은 participant 라인을 빼고 그대로 403. 두 메서드에 맞게 분리 적용(read=participant 예외 허용, control=불허).

권장 최종형(명확 분리):
```ruby
  def authorize_meeting_read!
    return if meeting_admin?
    return if @meeting.owner?(current_user)
    if project_member?(@meeting)
      return if @meeting.shared_visible?
    end
    return if @meeting.active_participants.exists?(user_id: current_user.id)
    render json: { error: "이 회의에 접근할 권한이 없습니다" }, status: :forbidden
  end

  def authorize_meeting_control!
    return if meeting_admin?
    return if @meeting.owner?(current_user)
    if project_member?(@meeting)
      return if @meeting.host_participant&.user_id == current_user.id
    end
    render json: { error: "회의를 제어할 권한이 없습니다" }, status: :forbidden
  end
```

- [ ] **Step 4: move_to_folder 프로젝트 경계**

`backend/app/controllers/api/v1/meetings_controller.rb` move_to_folder — 대상 폴더가 회의들과 같은 프로젝트인지 확인. `meetings.update_all` 직전에:
```ruby
        # 대상 폴더가 있으면 그 폴더의 프로젝트와 이동 대상 회의들의 프로젝트가 일치해야 한다(교차 이동 차단).
        if params[:folder_id].present?
          target = Folder.find_by(id: params[:folder_id])
          return render json: { error: "폴더를 찾을 수 없습니다" }, status: :not_found unless target
          if Meeting.editable_by(current_user).where(id: meeting_ids).where.not(project_id: target.project_id).exists?
            return render json: { error: "다른 프로젝트의 폴더로는 이동할 수 없습니다" }, status: :forbidden
          end
        end
```

- [ ] **Step 5: 통과 + 전체 스위트**

Run: `cd backend && bundle exec rspec`
Expected: green.

- [ ] **Step 6: 커밋**

```bash
cd backend && bundle exec rspec >/dev/null && cd .. && \
git add backend/ && \
git commit -m "feat(project): 멤버십 기반 접근제어 스코핑(accessible_by·tree·meeting_lookup·move 경계)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Phase 5 — 백엔드 API

**목표:** projects CRUD + members + invites + 공개 invite redeem(가입 포함). meetings/folders/tags 스코핑 파라미터.

### Task 5.1: 라우트 확장

**Files:**
- Modify: `backend/config/routes.rb`

- [ ] **Step 1: projects + invites + 공개 invite 라우트**

`backend/config/routes.rb`의 Projects 블록을 교체:
```ruby
      # Projects
      resources :projects, only: %i[index show create update destroy] do
        member do
          get  :members
          patch  "members/:user_id", action: :update_member, as: :update_member
          delete "members/:user_id", action: :remove_member, as: :remove_member
        end
        resources :invites, only: %i[index create destroy], controller: "project_invites"
      end

      # 공개 초대(인증 불필요 — 미리보기 / redeem(가입 가능))
      get  "invite/:code", to: "invites#show"
      post "invite/:code/redeem", to: "invites#redeem"
```

### Task 5.2: ProjectsController 확장

**Files:**
- Modify: `backend/app/controllers/api/v1/projects_controller.rb`
- Test: `backend/spec/requests/api/v1/projects_spec.rb`

- [ ] **Step 1: 실패 테스트**

`backend/spec/requests/api/v1/projects_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe "Api::V1::Projects", type: :request do
  let(:user) { create(:user) }
  before { login_as(user) }

  describe "POST /api/v1/projects" do
    it "프로젝트를 만들고 생성자를 admin 멤버로 넣는다" do
      post "/api/v1/projects", params: { name: "마케팅", icon_type: "emoji", icon_value: "📣" }, as: :json
      expect(response).to have_http_status(:created)
      json = response.parsed_body["project"]
      expect(json["name"]).to eq("마케팅")
      project = Project.find(json["id"])
      expect(project.admin?(user)).to be true
    end
  end

  describe "GET /api/v1/projects" do
    it "내가 멤버인 프로젝트만 (개인 포함)" do
      other = create(:project)  # 내가 멤버 아님
      get "/api/v1/projects", as: :json
      ids = response.parsed_body["projects"].map { |p| p["id"] }
      expect(ids).to include(user.projects.find_by(personal: true).id)
      expect(ids).not_to include(other.id)
    end
  end

  describe "DELETE /api/v1/projects/:id" do
    it "비어있는 비개인 프로젝트는 삭제" do
      project = create(:project)
      create(:project_membership, user: user, project: project, role: "admin")
      delete "/api/v1/projects/#{project.id}", as: :json
      expect(response).to have_http_status(:no_content)
    end

    it "회의가 있으면 409" do
      project = create(:project)
      create(:project_membership, user: user, project: project, role: "admin")
      create(:meeting, project: project, creator: user)
      delete "/api/v1/projects/#{project.id}", as: :json
      expect(response).to have_http_status(:conflict)
    end

    it "개인 프로젝트는 삭제 불가(409)" do
      personal = user.projects.find_by(personal: true)
      delete "/api/v1/projects/#{personal.id}", as: :json
      expect(response).to have_http_status(:conflict)
    end
  end
end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/projects_spec.rb`
Expected: FAIL.

- [ ] **Step 3: 컨트롤러 구현**

`backend/app/controllers/api/v1/projects_controller.rb`:
```ruby
module Api
  module V1
    class ProjectsController < ApplicationController
      include ProjectScoped

      before_action :authenticate_user!
      before_action :set_project, only: %i[show update destroy members update_member remove_member]
      before_action :authorize_project_admin!, only: %i[update destroy update_member remove_member]

      def index
        projects = current_user.admin? ? Project.all : current_user.projects
        render json: { projects: projects.distinct.map { |p| project_json(p) } }
      end

      def show
        render json: { project: project_json(@project, detail: true) }
      end

      def create
        project = Project.new(project_params.merge(creator: current_user))
        if project.save
          ProjectMembership.create!(project: project, user: current_user, role: "admin")
          render json: { project: project_json(project) }, status: :created
        else
          render json: { errors: project.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def update
        if @project.update(project_params)
          render json: { project: project_json(@project) }
        else
          render json: { errors: @project.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        unless @project.deletable?
          msg = @project.personal? ? "개인 프로젝트는 삭제할 수 없습니다" : "회의·폴더가 남아 있어 삭제할 수 없습니다"
          return render json: { error: msg }, status: :conflict
        end
        @project.destroy
        head :no_content
      end

      def members
        render json: { members: @project.project_memberships.includes(:user).map { |pm| member_json(pm) } }
      end

      def update_member
        pm = @project.project_memberships.find_by(user_id: params[:user_id])
        return render json: { error: "Member not found" }, status: :not_found unless pm
        if pm.update(role: params[:role])
          render json: { member: member_json(pm) }
        else
          render json: { errors: pm.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def remove_member
        pm = @project.project_memberships.find_by(user_id: params[:user_id])
        return render json: { error: "Member not found" }, status: :not_found unless pm
        pm.destroy
        head :no_content
      end

      private

      def set_project
        @project = require_project!(params[:id])
      end

      def authorize_project_admin!
        return if @project.nil? # require_project! 가 이미 렌더
        return if project_admin_override? || @project.admin?(current_user)
        render json: { error: "프로젝트 관리 권한이 없습니다" }, status: :forbidden
      end

      def project_params
        params.permit(:name, :description, :icon_type, :icon_value, :color)
      end

      def project_json(p, detail: false)
        json = {
          id: p.id, name: p.name, description: p.description,
          icon_type: p.icon_type, icon_value: p.icon_value, color: p.color,
          personal: p.personal,
          role: p.project_memberships.find_by(user_id: current_user.id)&.role,
          member_count: p.project_memberships.count,
          meeting_count: p.meetings.count
        }
        json
      end

      def member_json(pm)
        { user_id: pm.user_id, name: pm.user.name, email: pm.user.email, role: pm.role }
      end
    end
  end
end
```
> `set_project`가 `require_project!`를 쓰므로 비멤버는 자동 403/404. update/destroy/member관리는 추가로 `authorize_project_admin!`.

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/projects_spec.rb`
Expected: PASS.

### Task 5.3: ProjectInvitesController (코드 발급/목록/폐기)

**Files:**
- Create: `backend/app/controllers/api/v1/project_invites_controller.rb`
- Test: `backend/spec/requests/api/v1/project_invites_spec.rb`

- [ ] **Step 1: 실패 테스트**

`backend/spec/requests/api/v1/project_invites_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe "Api::V1::ProjectInvites", type: :request do
  let(:admin) { create(:user) }
  let(:project) { create(:project, creator: admin) }
  before do
    create(:project_membership, user: admin, project: project, role: "admin")
    login_as(admin)
  end

  it "프로젝트 admin이 초대 코드를 만든다" do
    post "/api/v1/projects/#{project.id}/invites", params: { max_uses: 5 }, as: :json
    expect(response).to have_http_status(:created)
    expect(response.parsed_body["invite"]["code"]).to match(/\A[a-zA-Z0-9]{6}\z/)
  end

  it "비admin 멤버는 초대 생성 불가(403)" do
    member = create(:user)
    create(:project_membership, user: member, project: project, role: "member")
    login_as(member)
    post "/api/v1/projects/#{project.id}/invites", as: :json
    expect(response).to have_http_status(:forbidden)
  end
end
```

- [ ] **Step 2: 실패 확인 → 구현**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/project_invites_spec.rb` → FAIL

`backend/app/controllers/api/v1/project_invites_controller.rb`:
```ruby
module Api
  module V1
    class ProjectInvitesController < ApplicationController
      include ProjectScoped

      before_action :authenticate_user!
      before_action :set_project_as_admin!

      def index
        render json: { invites: @project.project_invites.order(created_at: :desc).map { |i| invite_json(i) } }
      end

      def create
        invite = ProjectInvite.generate!(
          project: @project, created_by: current_user,
          expires_at: params[:expires_at].presence, max_uses: params[:max_uses].presence
        )
        render json: { invite: invite_json(invite) }, status: :created
      end

      def destroy
        invite = @project.project_invites.find_by(id: params[:id])
        return head :not_found unless invite
        invite.destroy
        head :no_content
      end

      private

      def set_project_as_admin!
        @project = require_project!(params[:project_id])
        return if @project.nil?
        unless project_admin_override? || @project.admin?(current_user)
          render json: { error: "프로젝트 관리 권한이 없습니다" }, status: :forbidden
        end
      end

      def invite_json(i)
        { id: i.id, code: i.code, expires_at: i.expires_at, max_uses: i.max_uses,
          use_count: i.use_count, redeemable: i.redeemable? }
      end
    end
  end
end
```

- [ ] **Step 3: 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/project_invites_spec.rb`
Expected: PASS.

### Task 5.4: InvitesController (공개 미리보기 + redeem + 가입)

**Files:**
- Create: `backend/app/controllers/api/v1/invites_controller.rb`
- Test: `backend/spec/requests/api/v1/invites_spec.rb`

- [ ] **Step 1: 실패 테스트 (3 경로: 미리보기 / 기존유저 합류 / 신규가입)**

`backend/spec/requests/api/v1/invites_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe "Api::V1::Invites", type: :request do
  let(:owner) { create(:user) }
  let(:project) { create(:project, creator: owner, name: "팀A") }
  let(:invite) { ProjectInvite.generate!(project: project, created_by: owner) }

  describe "GET /api/v1/invite/:code" do
    it "인증 없이 프로젝트 미리보기" do
      get "/api/v1/invite/#{invite.code}"
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["project"]["name"]).to eq("팀A")
    end

    it "잘못된 코드는 404" do
      get "/api/v1/invite/zzzzzz"
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "POST /api/v1/invite/:code/redeem" do
    it "로그인 유저는 멤버로 합류" do
      member = create(:user)
      login_as(member)
      expect {
        post "/api/v1/invite/#{invite.code}/redeem", as: :json
      }.to change { project.project_memberships.count }.by(1)
      expect(response).to have_http_status(:ok)
      expect(invite.reload.use_count).to eq(1)
    end

    it "비로그인 + 가입정보 → 계정 생성 + 합류 + 토큰 발급" do
      expect {
        post "/api/v1/invite/#{invite.code}/redeem",
             params: { name: "신규", email: "new@example.com", password: "password123" }, as: :json
      }.to change(User, :count).by(1)
      expect(response).to have_http_status(:created)
      body = response.parsed_body
      expect(body["access_token"]).to be_present
      expect(body["refresh_token"]).to be_present
      new_user = User.find_by(email: "new@example.com")
      expect(project.member?(new_user)).to be true
    end

    it "만료 코드는 410" do
      expired = ProjectInvite.generate!(project: project, created_by: owner, expires_at: 1.hour.ago)
      post "/api/v1/invite/#{expired.code}/redeem",
           params: { name: "x", email: "x@example.com", password: "password123" }, as: :json
      expect(response).to have_http_status(:gone)
    end
  end
end
```

- [ ] **Step 2: 실패 확인 → 구현**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/invites_spec.rb` → FAIL

`backend/app/controllers/api/v1/invites_controller.rb`:
```ruby
module Api
  module V1
    class InvitesController < ApplicationController
      # 공개 엔드포인트 — 인증 불필요. (현재 로그인 상태면 current_user 가 채워진다.)
      before_action :set_invite

      def show
        render json: { project: preview_json(@invite.project), valid: @invite.redeemable? }
      end

      def redeem
        return render json: { error: "만료되었거나 사용할 수 없는 초대입니다" }, status: :gone unless @invite.redeemable?

        if current_user
          join!(current_user)
          @invite.consume!
          render json: { joined: true, project: preview_json(@invite.project) }, status: :ok
        else
          signup_and_join!
        end
      end

      private

      def set_invite
        @invite = ProjectInvite.find_by(code: params[:code])
        render json: { error: "초대를 찾을 수 없습니다" }, status: :not_found unless @invite
      end

      def join!(user)
        ProjectMembership.find_or_create_by!(project: @invite.project, user: user) { |pm| pm.role = "member" }
      end

      # 비로그인 — 초대코드가 유효 가입 게이트. 계정 생성 + 합류 + JWT 발급.
      def signup_and_join!
        user = User.new(name: params[:name], email: params[:email], password: params[:password], role: "member")
        unless user.save
          return render json: { errors: user.errors.full_messages }, status: :unprocessable_entity
        end
        join!(user)
        @invite.consume!

        access = JwtService.encode_access_token(user)
        refresh = JwtService.encode_refresh_token(user, user.generate_refresh_token_jti!)
        render json: {
          access_token: access, refresh_token: refresh,
          user: { id: user.id, email: user.email, name: user.name, role: user.role },
          project: preview_json(@invite.project)
        }, status: :created
      end

      def preview_json(p)
        { id: p.id, name: p.name, icon_type: p.icon_type, icon_value: p.icon_value, color: p.color }
      end
    end
  end
end
```
> JWT 발급은 `Auth::SessionsController#create`와 동일 패턴(JwtService.encode_access_token + refresh). 공개 회원가입(Devise registrations)은 계속 비활성 — 가입은 오직 이 유효 초대 경로뿐.

- [ ] **Step 3: 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/invites_spec.rb`
Expected: PASS.

### Task 5.5: meetings/folders/tags 스코핑 + serializer project_id

**Files:**
- Modify: `meetings_controller.rb`, `folders_controller.rb`, `tags_controller.rb`, `meeting_serializable.rb`

- [ ] **Step 1: meeting_serializable에 project_id 추가**

`backend/app/controllers/concerns/meeting_serializable.rb`의 base json 해시에 한 줄 추가(folder_id 근처):
```ruby
      project_id: meeting.project_id,
```

- [ ] **Step 2: meetings_controller index 스코핑**

`index`에서 `scope = Meeting.accessible_by(current_user)` 다음 줄에:
```ruby
        scope = scope.where(project_id: params[:project_id]) if params[:project_id].present?
```

- [ ] **Step 3: meetings_controller create/upload_audio에 project_id**

`create`와 `upload_audio`의 `Meeting.new(...)`에 `project_id` 추가(+ 멤버십 검증). 두 액션 공통으로 before_action 추가:
```ruby
      before_action :require_create_project!, only: %i[create upload_audio]
```
그리고 private:
```ruby
      def require_create_project!
        @create_project = require_project!(params[:project_id])
      end
```
(`ProjectScoped` include 필요 — 컨트롤러 상단에 `include ProjectScoped` 추가.) `Meeting.new(...)` 해시에 `project_id: @create_project.id` 추가.

- [ ] **Step 4: folders_controller 스코핑**

상단에 `include ProjectScoped`. `index`:
```ruby
      def index
        project = require_project!(params[:project_id])
        return unless project
        if params[:flat] == "true"
          folders = Folder.ordered.where(project_id: project.id).to_a
          counts = Meeting.accessible_by(current_user).where(project_id: project.id)
                          .where(folder_id: folders.map(&:id)).group(:folder_id).count
          render json: { folders: folders.map { |f| folder_json(f, counts[f.id] || 0) } }
        else
          render json: { folders: Folder.tree(current_user, project.id) }
        end
      end
```
`create`의 `Folder.new(...)`에 `project_id: project.id` 추가(create에도 `project = require_project!`).

- [ ] **Step 5: tags_controller 스코핑**

`include ProjectScoped`. `create`:
```ruby
      def create
        project = require_project!(params[:project_id])
        return unless project
        tag = Tag.new(name: params[:name], color: params[:color] || "#6b7280", project_id: project.id)
        ...
      end
```
`index`도 `where(project_id: params[:project_id])` 필터.

- [ ] **Step 6: 요청 스펙 보강 + 전체 스위트**

기존 meetings/folders 요청 스펙이 `project_id` 없이 호출하면 이제 create가 400일 수 있다 → 스펙에 `project_id: project.id` 파라미터 추가. 영향 스펙 수정 후:
Run: `cd backend && bundle exec rspec`
Expected: green.

- [ ] **Step 7: 커밋**

```bash
cd backend && bundle exec rspec >/dev/null && cd .. && \
git add backend/ && \
git commit -m "feat(project): 백엔드 API(projects CRUD·members·invites·공개 redeem 가입) + 스코핑 파라미터

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Phase 6 — 프론트엔드

**목표:** project API/store, 아이콘 컴포넌트, 사이드바 스위처, 그리드 페이지, 생성/편집 다이얼로그(아이콘 피커), 멤버·초대 UI, `/invite/:code` 리딤, 폴더·회의 스코핑.

### Task 6.1: projects API 클라이언트

**Files:**
- Create: `frontend/src/api/projects.ts`

- [ ] **Step 1: API 모듈 작성 (ky apiClient 패턴)**

`frontend/src/api/projects.ts`:
```typescript
import apiClient from './client'

export type IconType = 'lucide' | 'emoji' | 'image'

export interface Project {
  id: number
  name: string
  description: string | null
  icon_type: IconType | null
  icon_value: string | null
  color: string | null
  personal: boolean
  role: 'admin' | 'member' | null
  member_count: number
  meeting_count: number
}

export interface ProjectMember {
  user_id: number
  name: string
  email: string
  role: 'admin' | 'member'
}

export interface ProjectInvite {
  id: number
  code: string
  expires_at: string | null
  max_uses: number | null
  use_count: number
  redeemable: boolean
}

export interface ProjectInput {
  name: string
  description?: string | null
  icon_type?: IconType | null
  icon_value?: string | null
  color?: string | null
}

export async function getProjects(): Promise<Project[]> {
  const res = await apiClient.get('projects').json<{ projects: Project[] }>()
  return res.projects
}

export async function createProject(data: ProjectInput): Promise<Project> {
  const res = await apiClient.post('projects', { json: data }).json<{ project: Project }>()
  return res.project
}

export async function updateProject(id: number, data: Partial<ProjectInput>): Promise<Project> {
  const res = await apiClient.patch(`projects/${id}`, { json: data }).json<{ project: Project }>()
  return res.project
}

export async function deleteProject(id: number): Promise<void> {
  await apiClient.delete(`projects/${id}`)
}

export async function getProjectMembers(id: number): Promise<ProjectMember[]> {
  const res = await apiClient.get(`projects/${id}/members`).json<{ members: ProjectMember[] }>()
  return res.members
}

export async function removeProjectMember(id: number, userId: number): Promise<void> {
  await apiClient.delete(`projects/${id}/members/${userId}`)
}

export async function getProjectInvites(id: number): Promise<ProjectInvite[]> {
  const res = await apiClient.get(`projects/${id}/invites`).json<{ invites: ProjectInvite[] }>()
  return res.invites
}

export async function createProjectInvite(
  id: number,
  data: { expires_at?: string | null; max_uses?: number | null } = {},
): Promise<ProjectInvite> {
  const res = await apiClient.post(`projects/${id}/invites`, { json: data }).json<{ invite: ProjectInvite }>()
  return res.invite
}

// 공개(인증 불필요) — prefixUrl 동일. redeem 은 로그인/비로그인 모두 처리.
export async function getInvitePreview(code: string): Promise<{ project: Partial<Project>; valid: boolean }> {
  return apiClient.get(`invite/${code}`).json()
}

export async function redeemInvite(
  code: string,
  signup?: { name: string; email: string; password: string },
): Promise<{ joined?: boolean; access_token?: string; refresh_token?: string; user?: { id: number; email: string; name: string; role: 'admin' | 'member' }; project: Partial<Project> }> {
  return apiClient.post(`invite/${code}/redeem`, signup ? { json: signup } : undefined).json()
}
```

### Task 6.2: projectStore (현재 프로젝트 + CRUD)

**Files:**
- Create: `frontend/src/stores/projectStore.ts`
- Test: `frontend/src/stores/projectStore.test.ts`

- [ ] **Step 1: 실패 테스트 (folderStore.test.ts 패턴)**

`frontend/src/stores/projectStore.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useProjectStore } from './projectStore'
import type { Project } from '../api/projects'

const { mockGetProjects } = vi.hoisted(() => ({ mockGetProjects: vi.fn() }))
vi.mock('../api/projects', () => ({
  getProjects: mockGetProjects,
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
}))

function makeProject(o: Partial<Project> = {}): Project {
  return { id: 1, name: 'P', description: null, icon_type: null, icon_value: null, color: null,
    personal: false, role: 'admin', member_count: 1, meeting_count: 0, ...o }
}

describe('projectStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.getState().reset()
    localStorage.clear()
  })

  it('fetch 후 첫 프로젝트가 currentProjectId로 설정된다(저장값 없을 때 personal 우선)', async () => {
    mockGetProjects.mockResolvedValue([makeProject({ id: 9, personal: false }), makeProject({ id: 3, personal: true })])
    await useProjectStore.getState().fetchProjects()
    expect(useProjectStore.getState().currentProjectId).toBe(3) // personal 우선
  })

  it('setCurrentProject는 localStorage에 저장한다', () => {
    useProjectStore.getState().setCurrentProject(7)
    expect(useProjectStore.getState().currentProjectId).toBe(7)
    expect(localStorage.getItem('current_project_id')).toBe('7')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npm run test -- projectStore`
Expected: FAIL.

- [ ] **Step 3: store 구현**

`frontend/src/stores/projectStore.ts`:
```typescript
import { create } from 'zustand'
import { getProjects, createProject as apiCreate, updateProject as apiUpdate, deleteProject as apiDelete } from '../api/projects'
import type { Project, ProjectInput } from '../api/projects'

const CURRENT_KEY = 'current_project_id'

interface ProjectState {
  projects: Project[]
  currentProjectId: number | null
  isLoading: boolean
  error: string | null
  fetchProjects: () => Promise<void>
  setCurrentProject: (id: number) => void
  createProject: (data: ProjectInput) => Promise<Project>
  updateProject: (id: number, data: Partial<ProjectInput>) => Promise<void>
  removeProject: (id: number) => Promise<void>
  reset: () => void
}

function storedCurrent(): number | null {
  const raw = localStorage.getItem(CURRENT_KEY)
  return raw ? Number(raw) : null
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  projects: [],
  currentProjectId: storedCurrent(),
  isLoading: false,
  error: null,

  fetchProjects: async () => {
    set({ isLoading: true, error: null })
    try {
      const projects = await getProjects()
      let current = get().currentProjectId
      // 저장된 현재 프로젝트가 목록에 없으면(또는 없으면) personal 우선, 없으면 첫 프로젝트.
      if (!current || !projects.some((p) => p.id === current)) {
        current = (projects.find((p) => p.personal) ?? projects[0])?.id ?? null
        if (current) localStorage.setItem(CURRENT_KEY, String(current))
      }
      set({ projects, currentProjectId: current, isLoading: false })
    } catch {
      set({ error: '프로젝트를 불러오지 못했습니다.', isLoading: false })
    }
  },

  setCurrentProject: (id) => {
    localStorage.setItem(CURRENT_KEY, String(id))
    set({ currentProjectId: id })
  },

  createProject: async (data) => {
    const project = await apiCreate(data)
    await get().fetchProjects()
    get().setCurrentProject(project.id)
    return project
  },

  updateProject: async (id, data) => {
    await apiUpdate(id, data)
    await get().fetchProjects()
  },

  removeProject: async (id) => {
    await apiDelete(id)
    if (get().currentProjectId === id) localStorage.removeItem(CURRENT_KEY)
    await get().fetchProjects()
  },

  reset: () => set({ projects: [], currentProjectId: storedCurrent(), isLoading: false, error: null }),
}))
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npm run test -- projectStore`
Expected: PASS.

### Task 6.3: ProjectIcon 컴포넌트 (3타입 + 이니셜 폴백)

**Files:**
- Create: `frontend/src/components/project/ProjectIcon.tsx`
- Test: `frontend/src/components/project/ProjectIcon.test.tsx`

- [ ] **Step 1: 실패 테스트**

`frontend/src/components/project/ProjectIcon.test.tsx`:
```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProjectIcon from './ProjectIcon'

describe('ProjectIcon', () => {
  it('emoji 타입은 이모지를 렌더', () => {
    render(<ProjectIcon project={{ name: '마케팅', icon_type: 'emoji', icon_value: '📣', color: '#ec4899' }} />)
    expect(screen.getByText('📣')).toBeTruthy()
  })

  it('아이콘 미설정 시 이름 첫 글자 폴백', () => {
    render(<ProjectIcon project={{ name: '신제품', icon_type: null, icon_value: null, color: null }} />)
    expect(screen.getByText('신')).toBeTruthy()
  })
})
```

- [ ] **Step 2: 실패 확인 → 구현**

Run: `cd frontend && npm run test -- ProjectIcon` → FAIL

`frontend/src/components/project/ProjectIcon.tsx`:
```typescript
import * as Icons from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface ProjectIconShape {
  name: string
  icon_type: 'lucide' | 'emoji' | 'image' | null
  icon_value: string | null
  color: string | null
}

const DEFAULT_COLOR = '#6366f1'

export default function ProjectIcon({ project, size = 28 }: { project: ProjectIconShape; size?: number }) {
  const color = project.color || DEFAULT_COLOR
  const box = { width: size, height: size, borderRadius: Math.round(size / 4) }

  if (project.icon_type === 'image' && project.icon_value) {
    return <span style={{ ...box, backgroundImage: `url(${project.icon_value})`, backgroundSize: 'cover', backgroundPosition: 'center', display: 'inline-block' }} aria-label={project.name} />
  }
  if (project.icon_type === 'emoji' && project.icon_value) {
    return <span style={{ ...box, background: '#eef2f7', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.55 }} aria-label={project.name}>{project.icon_value}</span>
  }
  if (project.icon_type === 'lucide' && project.icon_value) {
    // lucide 아이콘명은 PascalCase 컴포넌트로 매핑(예: 'home'→Home). 안전 폴백 포함.
    const key = project.icon_value.replace(/(^\w|-\w)/g, (s) => s.replace('-', '').toUpperCase())
    const Cmp = (Icons as unknown as Record<string, LucideIcon>)[key] ?? Icons.Folder
    return <span style={{ ...box, background: color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} aria-label={project.name}><Cmp size={size * 0.55} color="#fff" /></span>
  }
  // 폴백: 색 + 이름 첫 글자
  return <span style={{ ...box, background: color, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: size * 0.42 }} aria-label={project.name}>{[...project.name][0] ?? '?'}</span>
}
```

- [ ] **Step 3: 통과 확인**

Run: `cd frontend && npm run test -- ProjectIcon`
Expected: PASS.

### Task 6.4: ProjectSwitcher (사이드바 드롭다운) + Sidebar 통합

**Files:**
- Create: `frontend/src/components/project/ProjectSwitcher.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: ProjectSwitcher 구현**

`frontend/src/components/project/ProjectSwitcher.tsx`:
```typescript
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Plus, LayoutGrid } from 'lucide-react'
import { useProjectStore } from '../../stores/projectStore'
import { useFolderStore } from '../../stores/folderStore'
import { useMeetingStore } from '../../stores/meetingStore'
import ProjectIcon from './ProjectIcon'

export default function ProjectSwitcher() {
  const projects = useProjectStore((s) => s.projects)
  const currentId = useProjectStore((s) => s.currentProjectId)
  const setCurrent = useProjectStore((s) => s.setCurrentProject)
  const fetchProjects = useProjectStore((s) => s.fetchProjects)
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { fetchProjects() }, [fetchProjects])
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const current = projects.find((p) => p.id === currentId) ?? null

  const switchTo = (id: number) => {
    setCurrent(id)
    setOpen(false)
    // 프로젝트 전환 시 폴더 선택 리셋 + 목록 갱신
    useFolderStore.getState().setSelectedFolder('all')
    useFolderStore.getState().fetchFolders()
    useMeetingStore.getState().setFolderId('all')
    useMeetingStore.getState().fetchMeetings(1)
    navigate('/meetings')
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-accent transition-colors">
        {current ? <ProjectIcon project={current} size={24} /> : <span className="w-6 h-6 rounded bg-muted" />}
        <span className="text-sm font-semibold truncate flex-1 text-left">{current?.name ?? '프로젝트'}</span>
        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 rounded-lg border border-border bg-popover shadow-lg p-1">
          <div className="max-h-64 overflow-y-auto">
            {projects.map((p) => (
              <button key={p.id} onClick={() => switchTo(p.id)} className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm text-left hover:bg-accent ${p.id === currentId ? 'bg-accent' : ''}`}>
                <ProjectIcon project={p} size={22} />
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-border mt-1 pt-1">
            <button onClick={() => { setOpen(false); navigate('/projects') }} className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm text-left hover:bg-accent text-muted-foreground">
              <LayoutGrid className="w-4 h-4" /> 전체 프로젝트
            </button>
            <button onClick={() => { setOpen(false); navigate('/projects?new=1') }} className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm text-left hover:bg-accent text-primary">
              <Plus className="w-4 h-4" /> 새 프로젝트
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Sidebar 제목 자리에 스위처 삽입**

`frontend/src/components/layout/Sidebar.tsx`의 헤더(`<span className="text-lg font-bold text-foreground">또박또박</span>` 줄)를 ProjectSwitcher로 교체:
```tsx
        <div className="flex-1 min-w-0 mr-2"><ProjectSwitcher /></div>
```
상단 import 추가: `import ProjectSwitcher from '../project/ProjectSwitcher'`.

- [ ] **Step 3: 컴파일 확인**

Run: `cd frontend && npx tsc --noEmit && npm run test -- ProjectIcon`
Expected: 타입 에러 없음.

### Task 6.5: 폴더·회의 스토어 프로젝트 스코핑

**Files:**
- Modify: `frontend/src/api/folders.ts`, `frontend/src/api/meetings.ts`, `frontend/src/stores/folderStore.ts`, `frontend/src/stores/meetingStore.ts`

- [ ] **Step 1: API에 project_id 파라미터**

`frontend/src/api/folders.ts`:
- `getFolderTree(projectId: number)` → `apiClient.get('folders', { searchParams: { project_id: projectId } })`
- `createFolder(data)` json에 `project_id` 포함(타입에 `project_id: number` 추가)

`frontend/src/api/meetings.ts`:
- `GetMeetingsParams`에 `project_id?: number` 추가, `getMeetings`에서 `if (params.project_id) searchParams.project_id = params.project_id`
- `createMeeting` 데이터에 `project_id: number` 추가

- [ ] **Step 2: store에서 현재 프로젝트 주입**

`frontend/src/stores/folderStore.ts` `fetchFolders`:
```typescript
  fetchFolders: async () => {
    const projectId = useProjectStore.getState().currentProjectId
    if (!projectId) { set({ folders: [] }); return }
    set({ isLoading: true, error: null })
    try {
      const folders = await getFolderTree(projectId)
      set({ folders, isLoading: false })
    } catch { set({ error: '폴더 목록을 불러오지 못했습니다.', isLoading: false }) }
  },
```
`createFolder`도 `project_id: projectId` 전달. (상단 `import { useProjectStore } from './projectStore'`.)

`frontend/src/stores/meetingStore.ts` `fetchMeetings`의 params 구성에:
```typescript
      const projectId = useProjectStore.getState().currentProjectId
      if (projectId) params.project_id = projectId
```
(상단 import 추가.)

- [ ] **Step 3: 회의 생성 경로에 project_id**

`createMeeting` 호출부(MeetingsPage 등)에서 `project_id: useProjectStore.getState().currentProjectId` 전달. grep으로 호출부 확인:
Run: `cd frontend && grep -rn "createMeeting(" src/`
각 호출에 project_id 추가.

- [ ] **Step 4: 기존 스토어 테스트 갱신 + 통과**

`folderStore.test.ts`/`meetingStore.test.ts`에서 projectStore mock 추가(`vi.mock('./projectStore', ...)` currentProjectId 반환). 
Run: `cd frontend && npm run test`
Expected: green.

### Task 6.6: IconPicker + ProjectDialog (생성/편집)

**Files:**
- Create: `frontend/src/components/project/IconPicker.tsx`
- Create: `frontend/src/components/project/ProjectDialog.tsx`

- [ ] **Step 1: IconPicker (3탭: 아이콘/이모지/업로드)**

`frontend/src/components/project/IconPicker.tsx` — 탭 3개. value = `{icon_type, icon_value, color}`, onChange로 상위에 전달.
- 아이콘 탭: 큐레이션 lucide 이름 배열(`['home','rocket','megaphone','users','calendar','star','folder','flask-conical','wrench','pen-tool','settings','sprout']`) 그리드 + 색상 스와치(`['#6366f1','#ec4899','#10b981','#f59e0b','#0ea5e9','#64748b']`).
- 이모지 탭: 이모지 배열 그리드(`['🚀','📣','🎯','💡','🏢','📊','🔬','🛠️','📝','🎨','⚙️','🌱']`).
- 업로드 탭: `<input type="file" accept="image/*">` → FileReader로 dataURL → 정사각 캔버스 크롭 → `icon_value`에 dataURL 저장(서버 저장은 Step에서 멀티파트 업로드로 대체 가능; MVP는 dataURL을 그대로 icon_value로 보낼 수 있으나 길이 제한 주의 — 권장: 별도 업로드 엔드포인트. 1차는 lucide/emoji 우선, 업로드는 dataURL 미리보기 + 추후 업로드 API).

> 업로드 저장 방식 결정: 1차 구현은 lucide/emoji 완전 동작 + 업로드 탭은 UI만(미리보기). 실제 파일 저장은 후속 작업으로 분리(스펙 §8의 별도 projects 경로 업로드 헬퍼). 플랜 실행 시 이 분리를 log로 남길 것.

`ProjectIcon`이 렌더하는 동일 `{icon_type,icon_value,color}` 형태를 value로 사용.

- [ ] **Step 2: ProjectDialog (Dialog 패턴 재사용)**

`frontend/src/components/project/ProjectDialog.tsx` — `CreateFolderDialog`/`Dialog` 패턴. props: `{ project?: Project; onClose; onSaved }`. 폼: 이름(input), 설명(textarea), IconPicker. 저장 시 `useProjectStore.createProject`/`updateProject`. 미리보기로 `<ProjectIcon>` 표시.

- [ ] **Step 3: 컴파일 확인**

Run: `cd frontend && npx tsc --noEmit`
Expected: 에러 없음.

### Task 6.7: ProjectsPage (그리드) + 멤버/초대 패널

**Files:**
- Create: `frontend/src/pages/ProjectsPage.tsx`
- Create: `frontend/src/components/project/ProjectMembersPanel.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: ProjectsPage 그리드**

`frontend/src/pages/ProjectsPage.tsx`:
- `useProjectStore` projects 그리드 카드(ProjectIcon + name + `멤버 N · 회의 M`). admin은 전체 표시(서버가 이미 필터).
- "+ 새 프로젝트" 카드 → ProjectDialog 오픈. `?new=1` 쿼리면 자동 오픈.
- 카드 클릭 → `setCurrentProject(id)` + `/meetings` 이동. 카드의 톱니/⋯ → 편집(ProjectDialog) / 멤버관리(ProjectMembersPanel) / 삭제(deletable일 때만; deleteProject, 409 시 토스트).

- [ ] **Step 2: ProjectMembersPanel (멤버 목록 + 초대코드)**

`frontend/src/components/project/ProjectMembersPanel.tsx`:
- `getProjectMembers` 목록(역할 배지, 제거 버튼 `removeProjectMember`).
- 초대: `createProjectInvite` → 코드/링크 표시(`${origin}/invite/${code}`) + 복사 버튼. 만료/최대횟수 입력. `getProjectInvites` 목록 + 폐기.

- [ ] **Step 3: 라우트 등록**

`frontend/src/App.tsx` GatedApp의 Routes에 추가:
```tsx
      <Route path="/projects" element={<AppLayout><Suspended><ProjectsPage /></Suspended></AppLayout>} />
```
상단 lazy import 추가: `const ProjectsPage = lazy(() => import('./pages/ProjectsPage'))` (기존 lazy 패턴 따름).

- [ ] **Step 4: 컴파일 + 테스트**

Run: `cd frontend && npx tsc --noEmit && npm run test`
Expected: green.

### Task 6.8: InviteRedeemPage (`/invite/:code`)

**Files:**
- Create: `frontend/src/pages/InviteRedeemPage.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: InviteRedeemPage**

`frontend/src/pages/InviteRedeemPage.tsx`:
- `useParams` code. mount 시 `getInvitePreview(code)` → 프로젝트명·아이콘 표시.
- 로그인 상태(`useAuthStore.isAuthenticated`)면 "합류" 버튼 → `redeemInvite(code)` → 성공 시 `setCurrentProject`(응답 project.id) + `/meetings`.
- 비로그인이면 가입 폼(name/email/password) → `redeemInvite(code, signup)` → 응답의 access/refresh 토큰을 `useAuthStore.setTokens` + `setUser` → `/meetings`.
- 무효/만료(410/404) → 에러 안내.

- [ ] **Step 2: 라우트 (게이트 밖 — 비로그인 진입 가능)**

`frontend/src/App.tsx`의 최상위 `<Routes>`(offline 라우트와 같은 레벨, GatedApp 밖)에 추가:
```tsx
      <Route path="/invite/:code" element={<Suspended><InviteRedeemPage /></Suspended>} />
```
`const InviteRedeemPage = lazy(() => import('./pages/InviteRedeemPage'))`.

- [ ] **Step 3: 컴파일 + 전체 테스트 + 빌드**

Run: `cd frontend && npx tsc --noEmit && npm run test && npm run build`
Expected: 전부 green, 빌드 성공.

- [ ] **Step 4: 커밋**

```bash
cd frontend && npm run test >/dev/null && npx tsc --noEmit && cd .. && \
git add frontend/ && \
git commit -m "feat(project): 프론트엔드(스위처·그리드·다이얼로그·아이콘 피커·멤버/초대·invite 리딤·스코핑)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# 롤아웃 & 검증 (구현 완료 후)

- [ ] 마이그레이션은 dev 서버 멈춘 상태에서 실행(또는 `db/migrate_pending` 패턴). 실행 전 **DB 백업**.
- [ ] 복사본 DB로 M1–M4 선행 테스트 → 행 수 보존·project_id null 0 확인.
- [ ] 백엔드 `bundle exec rspec` + 프론트 `npm run test` + `npm run build` 전부 green.
- [ ] 기기 E2E: 프로젝트 생성→전환→폴더·회의 격리 확인 / 초대코드 발급→다른 계정 로그인 합류 / 비로그인 초대 가입 / 개인 프로젝트 삭제 불가 / 전역 admin 전체 열람.
- [ ] 커밋은 명시 요청 시에만(no-auto-commit). 위 각 Phase 커밋 메시지는 제안값.

---

# Self-Review (작성자 점검 결과)

**1. Spec 커버리지 (D1–D11):**
- D1 엄격격리+admin override → Phase 4 (accessible_by/tree/meeting_lookup 멤버십 필터, admin=all) ✅
- D2 기본 프로젝트+전원 → Phase 3 BackfillProjects ✅
- D3 누구나 생성=admin → Phase 5 ProjectsController#create (생성자 admin 멤버십) ✅
- D4 초대코드(로그인 합류/비로그인 가입) → Phase 5 Invites#redeem ✅
- D5 통합 아이콘 → Phase 2 필드 + Phase 6 IconPicker/ProjectIcon ✅
- D6 드롭다운+그리드 → Phase 6 ProjectSwitcher + ProjectsPage ✅
- D7 Team→Project 리네임 → Phase 1 ✅
- D8 비어있을 때만 삭제·개인 불가 → Phase 2 deletable? + Phase 5 destroy 409 ✅
- D9 신규유저 개인만 → Phase 2 EnsurePersonalProject(콜백) ✅
- D10 admin 전체 열람(개인 포함) → Phase 4 admin=all, Phase 5 index admin→Project.all ✅
- D11 가입 게이트=유효 초대만 → Phase 5 Invites#redeem(공개 registrations 비활성 유지) ✅

**2. 플레이스홀더:** 업로드 저장은 1차 범위에서 "UI 미리보기 + 후속 업로드 API 분리"로 명시(스펙 §8 보류와 일관). 그 외 TBD 없음.

**3. 타입 정합성:** `{icon_type, icon_value, color}` 형태가 백엔드 컬럼·`Project` 타입·`ProjectIcon`·`IconPicker`에서 일관. `currentProjectId: number | null` 일관. 백엔드 `project_id` 파라미터명 = 프론트 searchParams 키 일치.

**4. 알려진 리스크:** SQLite 테이블/FK 리네임(Task 1.1) — 반드시 복사본 선행 테스트 + 스키마 diff 확인. 인덱스명이 옛 `*_team_id_*`로 남을 수 있음(기능 무해, 정리 원하면 별도 rename_index).
