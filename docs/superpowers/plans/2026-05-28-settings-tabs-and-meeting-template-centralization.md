# 설정 탭 분리 + 회의 템플릿 중앙관리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회의 템플릿(`MeetingTemplate`)을 전역 공유 + 관리자 전용 CRUD로 전환하고, 설정 화면을 개인/전역 탭으로 분리한다.

**Architecture:** 백엔드는 `user_id` 컬럼 제거 마이그레이션 + 모델 연관 해제 + `require_admin!` 게이트. 프론트는 `SettingsContent`를 탭 셸로 축소하고 개인/전역 섹션을 두 컴포넌트로 추출, 전역 탭은 admin에만 노출.

**Tech Stack:** Rails 8.1 / RSpec / FactoryBot, React + TypeScript / Vitest + Testing Library, Zustand.

---

## 파일 구조

| 파일 | 책임 | 종류 |
|------|------|------|
| `backend/db/migrate/<ts>_centralize_meeting_templates.rb` | user_id/FK/index 제거 | 신규 |
| `backend/db/schema.rb` | 스키마 반영 | 자동수정 |
| `backend/app/models/meeting_template.rb` | belongs_to :user 제거 | 수정 |
| `backend/app/models/user.rb` | has_many :meeting_templates 제거 | 수정 |
| `backend/app/controllers/api/v1/meeting_templates_controller.rb` | 전역 조회 + admin 쓰기 | 수정 |
| `backend/spec/factories/meeting_templates.rb` | user 제거 | 수정 |
| `backend/spec/models/meeting_template_spec.rb` | 모델 spec 재작성 | 재작성 |
| `backend/spec/requests/api/v1/meeting_templates_spec.rb` | 전역+admin spec 재작성 | 재작성 |
| `frontend/src/components/settings/SettingsContent.tsx` | 탭 셸로 축소 | 수정 |
| `frontend/src/components/settings/PersonalSettingsTab.tsx` | 개인 설정 섹션 | 신규 |
| `frontend/src/components/settings/GlobalSettingsTab.tsx` | 전역 설정 섹션 | 신규 |
| `frontend/src/components/settings/SettingsContent.test.tsx` | 탭 가시성 테스트 | 신규 |
| `frontend/src/pages/MeetingLivePage.tsx` | 저장 버튼 admin 게이트 | 수정 |

---

## Phase A — 백엔드 회의 템플릿 중앙관리

### Task A1: 팩토리 + 모델 spec 재작성 (실패 확인)

**Files:**
- Modify: `backend/spec/factories/meeting_templates.rb`
- Rewrite: `backend/spec/models/meeting_template_spec.rb`

- [ ] **Step 1: 팩토리에서 user 제거**

`backend/spec/factories/meeting_templates.rb`:
```ruby
FactoryBot.define do
  factory :meeting_template do
    sequence(:name) { |n| "Template #{n}" }
    meeting_type { "general" }
    settings_json { { language: "ko", diarization: true } }
  end
end
```

- [ ] **Step 2: 모델 spec 재작성**

`backend/spec/models/meeting_template_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe MeetingTemplate, type: :model do
  describe "associations" do
    it { is_expected.to belong_to(:folder).optional }
    it { is_expected.not_to respond_to(:user) }
  end

  describe "validations" do
    it { is_expected.to validate_presence_of(:name) }
    it { is_expected.to validate_length_of(:name).is_at_most(100) }
  end

  describe "global scope" do
    it "creates a template without a user" do
      expect { create(:meeting_template) }.to change(MeetingTemplate, :count).by(1)
    end
  end
end
```

- [ ] **Step 3: 실패 확인**

Run: `cd backend && bundle exec rspec spec/models/meeting_template_spec.rb`
Expected: FAIL — `belong_to(:user)` 연관이 아직 존재하거나 user_id NOT NULL로 create 실패.

- [ ] **Step 4: Commit**
```bash
git add backend/spec/factories/meeting_templates.rb backend/spec/models/meeting_template_spec.rb
git commit -m "test(meeting-template): expect global (no user) model"
```

### Task A2: 마이그레이션 + 모델 연관 제거 (모델 spec 통과)

**Files:**
- Create: `backend/db/migrate/<ts>_centralize_meeting_templates.rb`
- Modify: `backend/app/models/meeting_template.rb`
- Modify: `backend/app/models/user.rb`

- [ ] **Step 1: 마이그레이션 생성**

`cd backend && bin/rails g migration CentralizeMeetingTemplates` 후 내용:
```ruby
class CentralizeMeetingTemplates < ActiveRecord::Migration[8.1]
  def up
    remove_foreign_key :meeting_templates, :users
    remove_index :meeting_templates, :user_id, if_exists: true
    remove_column :meeting_templates, :user_id
  end

  def down
    add_column :meeting_templates, :user_id, :integer
    add_index :meeting_templates, :user_id
    add_foreign_key :meeting_templates, :users
  end
end
```

- [ ] **Step 2: 모델 연관 제거**

`backend/app/models/meeting_template.rb`:
```ruby
class MeetingTemplate < ApplicationRecord
  belongs_to :folder, optional: true

  validates :name, presence: true, length: { maximum: 100 }
end
```

`backend/app/models/user.rb` — `has_many :meeting_templates, dependent: :destroy` 라인 삭제.

- [ ] **Step 3: 마이그레이션 실행**

Run: `cd backend && bin/rails db:migrate`
Expected: 성공, `db/schema.rb`에서 `meeting_templates`의 user_id/index/FK 제거됨.

- [ ] **Step 4: 모델 spec 통과 확인**

Run: `cd backend && bundle exec rspec spec/models/meeting_template_spec.rb`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add backend/db/migrate backend/db/schema.rb backend/app/models/meeting_template.rb backend/app/models/user.rb
git commit -m "feat(meeting-template): drop user ownership, make global"
```

### Task A3: 컨트롤러 spec 재작성 (실패 확인)

**Files:**
- Rewrite: `backend/spec/requests/api/v1/meeting_templates_spec.rb`

- [ ] **Step 1: request spec 재작성**

`backend/spec/requests/api/v1/meeting_templates_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe "Api::V1::MeetingTemplates", type: :request do
  let(:admin)  { create(:user, :admin) }
  let(:member) { create(:user) }

  describe "server mode" do
    before do
      allow_any_instance_of(ApplicationController).to receive(:server_mode?).and_return(true)
    end

    describe "GET /api/v1/meeting_templates (any user)" do
      it "returns all global templates" do
        create(:meeting_template, name: "A")
        create(:meeting_template, name: "B")
        login_as(member)

        get "/api/v1/meeting_templates"

        expect(response).to have_http_status(:ok)
        expect(response.parsed_body.length).to eq(2)
      end
    end

    describe "writes by member" do
      before { login_as(member) }

      it "POST returns 403" do
        post "/api/v1/meeting_templates", params: { name: "X" }, as: :json
        expect(response).to have_http_status(:forbidden)
      end

      it "PUT returns 403" do
        tpl = create(:meeting_template)
        put "/api/v1/meeting_templates/#{tpl.id}", params: { name: "X" }, as: :json
        expect(response).to have_http_status(:forbidden)
      end

      it "DELETE returns 403" do
        tpl = create(:meeting_template)
        delete "/api/v1/meeting_templates/#{tpl.id}"
        expect(response).to have_http_status(:forbidden)
      end
    end

    describe "writes by admin" do
      before { login_as(admin) }

      it "POST creates a template" do
        expect {
          post "/api/v1/meeting_templates",
               params: { name: "스탠드업", meeting_type: "standup", settings_json: { language: "ko" } },
               as: :json
        }.to change(MeetingTemplate, :count).by(1)
        expect(response).to have_http_status(:created)
        expect(response.parsed_body["name"]).to eq("스탠드업")
      end

      it "PUT updates a template" do
        tpl = create(:meeting_template, name: "Old")
        put "/api/v1/meeting_templates/#{tpl.id}", params: { name: "New" }, as: :json
        expect(response).to have_http_status(:ok)
        expect(response.parsed_body["name"]).to eq("New")
      end

      it "DELETE removes a template" do
        tpl = create(:meeting_template)
        expect { delete "/api/v1/meeting_templates/#{tpl.id}" }
          .to change(MeetingTemplate, :count).by(-1)
        expect(response).to have_http_status(:no_content)
      end

      it "POST with invalid params returns 422" do
        post "/api/v1/meeting_templates", params: { name: "" }, as: :json
        expect(response).to have_http_status(:unprocessable_entity)
      end
    end
  end

  describe "local mode (admin check bypassed)" do
    before do
      allow_any_instance_of(ApplicationController).to receive(:server_mode?).and_return(false)
      login_as(member)
    end

    it "member can create" do
      expect {
        post "/api/v1/meeting_templates", params: { name: "Y" }, as: :json
      }.to change(MeetingTemplate, :count).by(1)
      expect(response).to have_http_status(:created)
    end
  end
end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meeting_templates_spec.rb`
Expected: FAIL — member write가 아직 403 아님(201), index가 전역 아님.

- [ ] **Step 3: Commit**
```bash
git add backend/spec/requests/api/v1/meeting_templates_spec.rb
git commit -m "test(meeting-template): expect global read + admin-only writes"
```

### Task A4: 컨트롤러 구현 (spec 통과)

**Files:**
- Modify: `backend/app/controllers/api/v1/meeting_templates_controller.rb`

- [ ] **Step 1: 컨트롤러 수정**

`backend/app/controllers/api/v1/meeting_templates_controller.rb`:
```ruby
module Api
  module V1
    class MeetingTemplatesController < ApplicationController
      before_action :authenticate_user!
      # 회의 템플릿은 중앙 집중관리 — 조회는 모두, 변경은 관리자 전용.
      before_action :require_admin!, only: %i[create update destroy]
      before_action :set_template, only: %i[update destroy]

      def index
        templates = MeetingTemplate.order(updated_at: :desc)
        render json: templates.map { |t| template_json(t) }
      end

      def create
        template = MeetingTemplate.new(template_params)
        if template.save
          render json: template_json(template), status: :created
        else
          render json: { errors: template.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def update
        if @template.update(template_params)
          render json: template_json(@template)
        else
          render json: { errors: @template.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def destroy
        @template.destroy!
        head :no_content
      end

      private

      def set_template
        @template = MeetingTemplate.find(params[:id])
      end

      def template_params
        params.permit(:name, :meeting_type, :folder_id, settings_json: {})
      end

      def template_json(template)
        {
          id: template.id,
          name: template.name,
          meeting_type: template.meeting_type,
          folder_id: template.folder_id,
          settings_json: template.settings_json,
          created_at: template.created_at,
          updated_at: template.updated_at
        }
      end
    end
  end
end
```

- [ ] **Step 2: spec 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meeting_templates_spec.rb spec/models/meeting_template_spec.rb`
Expected: PASS

- [ ] **Step 3: Commit**
```bash
git add backend/app/controllers/api/v1/meeting_templates_controller.rb
git commit -m "feat(meeting-template): global read, admin-only writes"
```

---

## Phase B — 프론트엔드 설정 탭 분리

### Task B1: 개인 설정 탭 컴포넌트 추출

**Files:**
- Create: `frontend/src/components/settings/PersonalSettingsTab.tsx`

개인 섹션(실행 모드, 회의 언어, 비밀번호, 내 LLM)을 `SettingsContent.tsx`에서 그대로 옮긴다.
현재 `SettingsContent.tsx`의 해당 JSX·관련 상태/핸들러(실행 모드 토글 등)를 추출.

- [ ] **Step 1: PersonalSettingsTab 생성**

`SettingsContent.tsx`의 개인 섹션 JSX와 필요한 import/상태(실행 모드 관련)를 옮긴다.
`UserLanguageSettings`, `PasswordChangeSection`(조건 `showPasswordSection`), `UserLlmSettings` 렌더 포함. props로 `showPasswordSection: boolean` 전달.

```tsx
import UserLanguageSettings from './UserLanguageSettings'
import UserLlmSettings from './UserLlmSettings'
import PasswordChangeSection from './PasswordChangeSection'
// (실행 모드 섹션에 필요한 import는 SettingsContent에서 이동)

interface Props {
  showPasswordSection: boolean
}

export default function PersonalSettingsTab({ showPasswordSection }: Props) {
  return (
    <div className="space-y-6">
      {/* 실행 모드 (Tauri 전용) — SettingsContent에서 이동한 JSX */}
      <UserLanguageSettings />
      {showPasswordSection && <PasswordChangeSection />}
      <UserLlmSettings />
    </div>
  )
}
```

> 실행 모드 섹션은 상태/핸들러를 동반하므로, 추출 시 해당 로직도 이 컴포넌트로 이동(없으면 생략).

- [ ] **Step 2: 타입 체크**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (아직 SettingsContent에서 미사용이라 unused 경고 없음 — import만 추가하면 lint 걸릴 수 있으니 B3에서 연결)

- [ ] **Step 3: Commit**
```bash
git add frontend/src/components/settings/PersonalSettingsTab.tsx
git commit -m "feat(settings): extract PersonalSettingsTab"
```

### Task B2: 전역 설정 탭 컴포넌트 추출

**Files:**
- Create: `frontend/src/components/settings/GlobalSettingsTab.tsx`

전역 섹션(STT 모델, AI 요약 모델, 회의 템플릿, 회의록 양식, 음성 청킹, HuggingFace, 화자 분리)을 추출.
탭 자체가 admin 게이트되므로 내부 `showAdminSettings && (...)` 래퍼는 제거하고 항상 렌더.
AI 요약 모델 폼의 상태/핸들러(`currentForm`, `handleLlmSave`, `handleLlmTest`, `llm*` state)를 이 컴포넌트로 이동.

- [ ] **Step 1: GlobalSettingsTab 생성**

`SettingsContent.tsx`의 전역 섹션 JSX 전체 + AI 요약 LLM 폼 상태/핸들러를 이동.
`MeetingTemplateManager`, `PromptTemplateManager` 렌더 포함.

- [ ] **Step 2: 타입 체크**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**
```bash
git add frontend/src/components/settings/GlobalSettingsTab.tsx
git commit -m "feat(settings): extract GlobalSettingsTab"
```

### Task B3: 탭 가시성 테스트 작성 (실패 확인)

**Files:**
- Create: `frontend/src/components/settings/SettingsContent.test.tsx`

- [ ] **Step 1: 테스트 작성** (자식 탭/authStore mock)

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import SettingsContent from './SettingsContent'

let mockUser: { role?: string; email?: string } | null = { role: 'member', email: 'm@x.com' }
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ user: mockUser }),
}))
vi.mock('../../lib/mode', () => ({ getMode: () => 'server' }))
vi.mock('./PersonalSettingsTab', () => ({
  default: () => <div data-testid="personal-tab">personal</div>,
}))
vi.mock('./GlobalSettingsTab', () => ({
  default: () => <div data-testid="global-tab">global</div>,
}))

describe('SettingsContent tabs', () => {
  beforeEach(() => { mockUser = { role: 'member', email: 'm@x.com' } })

  it('member: 전역 탭 버튼 없음, 개인 탭만', () => {
    render(<SettingsContent />)
    expect(screen.queryByRole('tab', { name: /전역설정/ })).toBeNull()
    expect(screen.getByTestId('personal-tab')).toBeInTheDocument()
  })

  it('admin: 개인/전역 탭 둘 다 존재', () => {
    mockUser = { role: 'admin', email: 'a@x.com' }
    render(<SettingsContent />)
    expect(screen.getByRole('tab', { name: /개인설정/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /전역설정/ })).toBeInTheDocument()
  })
})
```

> `getMode`/`authStore`의 실제 import 경로는 `SettingsContent.tsx` 상단을 따라 맞춘다(현재 `useAuthStore` from `../../stores/authStore`, `getMode` from 해당 모듈). 경로 다르면 mock 경로 수정.

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/components/settings/SettingsContent.test.tsx`
Expected: FAIL — 아직 탭 구조 없음.

- [ ] **Step 3: Commit**
```bash
git add frontend/src/components/settings/SettingsContent.test.tsx
git commit -m "test(settings): tab visibility by role"
```

### Task B4: SettingsContent 탭 셸로 전환 (테스트 통과)

**Files:**
- Modify: `frontend/src/components/settings/SettingsContent.tsx`

- [ ] **Step 1: 탭 셸 구현**

`SettingsContent`를 탭 셸로 축소. 개인/전역 섹션 JSX는 추출된 컴포넌트로 대체.
```tsx
const [tab, setTab] = useState<'personal' | 'global'>('personal')
// showAdminSettings = isAdmin || isLocalMode (기존)
```
- 탭 버튼: `role="tab"`, 이름 "개인설정" 항상 / "전역설정" `showAdminSettings`일 때만.
- `showAdminSettings === false`이면 탭바 숨기고 `<PersonalSettingsTab .../>`만 렌더.
- `tab === 'personal'` → `<PersonalSettingsTab showPasswordSection={showPasswordSection} />`
- `tab === 'global'` → `<GlobalSettingsTab />` (admin일 때만 선택 가능)

- [ ] **Step 2: 테스트 통과 확인**

Run: `cd frontend && npx vitest run src/components/settings/SettingsContent.test.tsx`
Expected: PASS

- [ ] **Step 3: 전체 타입/빌드 검증**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: PASS (메모리: 변수 제거 시 vite build로 검증 필수)

- [ ] **Step 4: Commit**
```bash
git add frontend/src/components/settings/SettingsContent.tsx
git commit -m "feat(settings): split into personal/global tabs"
```

### Task B5: 라이브 화면 저장 버튼 admin 게이트

**Files:**
- Modify: `frontend/src/pages/MeetingLivePage.tsx`

- [ ] **Step 1: 저장 버튼 게이트**

`SaveTemplateDialog`를 여는 트리거 버튼을 `showAdminSettings` 동등 조건(authStore `user?.role === 'admin' || isLocalMode`)으로 감싼다. admin 판별 헬퍼가 없으면 인라인 계산.

- [ ] **Step 2: 타입/빌드 검증**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: PASS

- [ ] **Step 3: Commit**
```bash
git add frontend/src/pages/MeetingLivePage.tsx
git commit -m "feat(meeting): hide save-as-template for non-admins"
```

---

## Phase C — 통합 검증

### Task C1: 전체 테스트

- [ ] **Step 1: 백엔드 전체 (관련 스펙)**

Run: `cd backend && bundle exec rspec spec/models/meeting_template_spec.rb spec/requests/api/v1/meeting_templates_spec.rb`
Expected: PASS

- [ ] **Step 2: 프론트 전체**

Run: `cd frontend && npx vitest run && npm run build`
Expected: PASS (기존 무관 실패 스펙은 메모리 known gaps 참조)

- [ ] **Step 3: 최종 커밋 (필요 시)**

작업 트리 깨끗한지 `git status` 확인.

---

## 자가 검토 결과

- **Spec coverage:** 마이그레이션/모델/컨트롤러/탭 분리/저장 버튼/테스트 모두 Task로 매핑됨.
- **Placeholder:** `<ts>`(마이그레이션 타임스탬프), 실행 모드 추출 JSX는 원본 이동이라 코드 전량 미기재 — 기존 파일에서 그대로 옮기는 기계적 작업이라 허용.
- **Type consistency:** `showAdminSettings`, `showPasswordSection`, `PersonalSettingsTab`/`GlobalSettingsTab` props 일관.
- **주의:** B1/B2의 JSX/상태 이동은 원본 `SettingsContent.tsx` 내용을 직접 보고 옮겨야 하며, LLM 폼 상태 이동 시 회귀 위험 — tsc + build + 기존 테스트로 가드.
