# LLM 설정 프리셋 프로필 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LLM 연결 설정을 이름 있는 "프로필"(서버 풀/개인 풀 완전 분리)로 저장·재사용하고, Google Gemini API 프리셋과 API 키 발급 링크를 추가한다. 설정 탭은 선택 전용 카드, 프로필 생성·편집은 팝업.

**Architecture:** 백엔드 = 새 `llm_profiles` 테이블 + CRUD API. 개인 선택은 `users.llm_profile_id`/`chat_llm_profile_id` 참조(FK 컬럼, DB 제약 없음 — SQLite 테이블 재생성 함정 회피), 서버 선택은 `settings.yaml`의 `active_profile_id` + 기존 `presets` 구조로 **실체화**(부팅 `load_env.rb` 무수정). CLI 3종은 프로필이 아니라 내장 항목으로 기존 컬럼 경로 유지. 프론트 = 선택 전용 `LlmSelector` + `LlmProfilesModal`(생성·편집·삭제), 기존 `LlmProviderCard`는 폼 로직을 `LlmProfileForm`으로 이식 후 삭제.

**Tech Stack:** Rails 8.1 + SQLite + RSpec(request) / React 19 + TS + vitest + ky. AR `encrypts`로 토큰 암호화.

**Spec:** `docs/superpowers/specs/2026-07-18-llm-preset-profiles-design.md` (승인됨)

## Global Constraints

- 작업 디렉토리: `/Users/jji/project/ddobakddobak/.claude/worktrees/feat+llm-preset-profiles` (워크트리, 브랜치 `feat/llm-preset-profiles`). 절대 원본 repo로 cd 금지.
- 추론 파이프라인(`LlmService`·`resolve_config`·`call_llm_raw`) 로직 무수정 — 설정 해석부만 프로필 경유로 교체.
- 토큰 원문은 API 응답에 절대 미포함. `TokenMasking#mask_token` 재사용, 응답 필드명 `auth_token_masked`.
- `users` 테이블에 DB-level FK 추가 금지(SQLite 재생성→CASCADE 유실 사고 이력). `add_column :bigint` + 모델 콜백 nullify만.
- 프론트 타입 게이트: `cd frontend && npx tsc -p tsconfig.app.json` — 기준선 사전존재 에러 ~24개, **내가 만든 신규 에러 0**. bare `tsc`는 거짓 green.
- 백엔드: `cd backend && bundle exec rspec <파일>` / 마이그레이션 `bin/rails db:migrate`.
- 프론트 테스트: `cd frontend && npx vitest run <파일>`.
- UI 문구 한국어. 코드 주석은 주변 밀도 따라 최소.
- 삭제 확인은 `window.confirm` 금지 — Tauri WKWebView에서 non-blocking. 저장소의 `confirmDialog` 헬퍼를 grep(`grep -rn "confirmDialog" frontend/src`)해서 재사용.
- 커밋은 이 feature 브랜치에만, 푸시 금지.
- 구현 서브에이전트 모델: sonnet.

## 확정 외부 사실 (웹 검증 완료, 출처: ai.google.dev/gemini-api/docs/openai 등)

- Gemini OpenAI 호환 base URL: `https://generativelanguage.googleapis.com/v1beta/openai` (chat/completions·models 목록 지원, `Authorization: Bearer <GEMINI_API_KEY>`)
- Gemini 추천 모델: `gemini-3.5-flash`(기본), `gemini-3.1-flash-lite`, `gemini-2.5-flash`
- 키 발급 URL: Google `https://aistudio.google.com/app/apikey` / Anthropic `https://console.anthropic.com/settings/keys` / OpenAI `https://platform.openai.com/api-keys` / Z.AI `https://z.ai/manage-apikey/apikey-list`

---

### Task 1: llm_profiles 테이블 + LlmProfile 모델

**Files:**
- Create: `backend/db/migrate/20260718000001_create_llm_profiles.rb`
- Create: `backend/db/migrate/20260718000002_add_llm_profile_refs_to_users.rb`
- Create: `backend/app/models/llm_profile.rb`
- Modify: `backend/app/models/user.rb` (has_many 선언부에 1줄)
- Test: `backend/spec/models/llm_profile_spec.rb`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `LlmProfile` 모델 — `LlmProfile.server_pool`(user_id nil scope), `LlmProfile.personal_for(user)`, `#to_llm_config → {provider:, auth_token:, model:, base_url:}.compact`, `#as_masked_json(masker) → Hash`, `LlmProfile.preset_id_for(provider, base_url) → String`(TS `presetIdFromUserConfig` 미러), `PROVIDERS = %w[anthropic openai]`. `users.llm_profile_id`/`chat_llm_profile_id` bigint 컬럼. 삭제 시 참조 유저 자동 nullify(`before_destroy`).

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/models/llm_profile_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe LlmProfile, type: :model do
  let(:user) { create(:user) }

  it "이름·프리셋·프로바이더 필수, provider는 anthropic/openai만" do
    p = LlmProfile.new(user: user, name: "", preset_id: "", provider: "claude_cli")
    expect(p).not_to be_valid
    expect(p.errors[:name]).to be_present
    expect(p.errors[:preset_id]).to be_present
    expect(p.errors[:provider]).to be_present
  end

  it "(user_id, name) 유니크 — 같은 유저 중복 이름 거부, 다른 유저는 허용" do
    LlmProfile.create!(user: user, name: "A", preset_id: "openai", provider: "openai")
    dup = LlmProfile.new(user: user, name: "A", preset_id: "anthropic", provider: "anthropic")
    expect(dup).not_to be_valid
    other = LlmProfile.new(user: create(:user), name: "A", preset_id: "openai", provider: "openai")
    expect(other).to be_valid
  end

  it "auth_token은 암호화 저장된다" do
    p = LlmProfile.create!(user: user, name: "K", preset_id: "openai", provider: "openai", auth_token: "sk-secret-1234567890")
    raw = LlmProfile.connection.select_value("SELECT auth_token FROM llm_profiles WHERE id = #{p.id}")
    expect(raw).not_to include("sk-secret")
    expect(p.reload.auth_token).to eq("sk-secret-1234567890")
  end

  it "scope: server_pool은 user_id nil만, personal_for는 해당 유저만" do
    server = LlmProfile.create!(user_id: nil, name: "S", preset_id: "anthropic", provider: "anthropic")
    mine = LlmProfile.create!(user: user, name: "M", preset_id: "openai", provider: "openai")
    expect(LlmProfile.server_pool).to contain_exactly(server)
    expect(LlmProfile.personal_for(user)).to contain_exactly(mine)
  end

  it "to_llm_config는 nil 필드를 제거해 LlmService 호환 해시를 만든다" do
    p = LlmProfile.new(name: "G", preset_id: "gemini", provider: "openai",
                       base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
                       model: "gemini-3.5-flash", auth_token: "AIza-x")
    expect(p.to_llm_config).to eq(
      provider: "openai", auth_token: "AIza-x", model: "gemini-3.5-flash",
      base_url: "https://generativelanguage.googleapis.com/v1beta/openai"
    )
    expect(LlmProfile.new(name: "O", preset_id: "ollama", provider: "openai", model: "m").to_llm_config)
      .to eq(provider: "openai", model: "m")
  end

  it "삭제 시 이 프로필을 참조하는 유저 컬럼을 nullify한다" do
    p = LlmProfile.create!(user: user, name: "P", preset_id: "openai", provider: "openai")
    user.update!(llm_profile_id: p.id, chat_llm_profile_id: p.id)
    p.destroy!
    user.reload
    expect(user.llm_profile_id).to be_nil
    expect(user.chat_llm_profile_id).to be_nil
  end

  it "유저 삭제 시 개인 프로필도 함께 삭제된다 (FK constraint 500 방지 — faf79d61 계열 버그 재발 금지)" do
    p = LlmProfile.create!(user: user, name: "P", preset_id: "openai", provider: "openai")
    server = LlmProfile.create!(user_id: nil, name: "S", preset_id: "openai", provider: "openai")
    expect { user.destroy! }.not_to raise_error
    expect(LlmProfile.exists?(p.id)).to be false
    expect(LlmProfile.exists?(server.id)).to be true
  end

  describe ".preset_id_for (TS presetIdFromUserConfig 미러)" do
    it "매핑 표" do
      expect(described_class.preset_id_for("anthropic", nil)).to eq("anthropic")
      expect(described_class.preset_id_for("anthropic", "https://api.z.ai/api/anthropic")).to eq("zai")
      expect(described_class.preset_id_for("openai", nil)).to eq("openai")
      expect(described_class.preset_id_for("openai", "http://localhost:11434/v1")).to eq("ollama")
      expect(described_class.preset_id_for("openai", "http://localhost:1234/v1")).to eq("lmstudio")
      expect(described_class.preset_id_for("openai", "https://generativelanguage.googleapis.com/v1beta/openai")).to eq("gemini")
      expect(described_class.preset_id_for("openai", "https://my.proxy/v1")).to eq("custom")
    end
  end
end
```

- [ ] **Step 2: 실행 → 실패 확인**

Run: `cd backend && bundle exec rspec spec/models/llm_profile_spec.rb`
Expected: FAIL — `uninitialized constant LlmProfile`

- [ ] **Step 3: 마이그레이션 2개 작성**

`backend/db/migrate/20260718000001_create_llm_profiles.rb`:
```ruby
class CreateLlmProfiles < ActiveRecord::Migration[8.1]
  def change
    create_table :llm_profiles do |t|
      t.references :user, null: true, foreign_key: true # nil = 서버 풀(admin 전용)
      t.string :name, null: false
      t.string :preset_id, null: false
      t.string :provider, null: false
      t.string :base_url
      t.string :model
      t.text :auth_token
      t.integer :max_input_tokens
      t.integer :max_output_tokens
      t.timestamps
    end
    add_index :llm_profiles, [ :user_id, :name ], unique: true
    # SQLite는 NULL user_id 중복을 unique로 못 막음 — 서버 풀 이름 중복은 모델 검증이 담당
  end
end
```

`backend/db/migrate/20260718000002_add_llm_profile_refs_to_users.rb` — **DB FK 없이** 컬럼만(Global Constraints 참조):
```ruby
class AddLlmProfileRefsToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :llm_profile_id, :bigint
    add_column :users, :chat_llm_profile_id, :bigint
    add_index :users, :llm_profile_id
    add_index :users, :chat_llm_profile_id
  end
end
```

- [ ] **Step 4: 모델 작성**

`backend/app/models/llm_profile.rb`:
```ruby
class LlmProfile < ApplicationRecord
  PROVIDERS = %w[anthropic openai].freeze

  belongs_to :user, optional: true

  encrypts :auth_token

  validates :name, presence: true, uniqueness: { scope: :user_id }
  validates :preset_id, presence: true
  validates :provider, presence: true, inclusion: { in: PROVIDERS }

  before_destroy :detach_user_references

  scope :server_pool, -> { where(user_id: nil) }
  scope :personal_for, ->(user) { where(user_id: user.id) }

  # LlmService.new(llm_config:) 호환 해시
  def to_llm_config
    {
      provider: provider,
      auth_token: auth_token.presence,
      model: model.presence,
      base_url: base_url.presence
    }.compact
  end

  # 응답 직렬화 — 토큰 원문 대신 마스킹(masker = TokenMasking#mask_token 바인딩)
  def as_masked_json(masker)
    {
      id: id, name: name, preset_id: preset_id, provider: provider,
      base_url: base_url, model: model,
      max_input_tokens: max_input_tokens, max_output_tokens: max_output_tokens,
      has_token: auth_token.present?,
      auth_token_masked: auth_token.present? ? masker.call(auth_token) : nil
    }
  end

  # frontend llmServicePresets.presetIdFromUserConfig 미러 — 레거시 컬럼 → preset_id 복원(이관용)
  def self.preset_id_for(provider, base_url)
    b = base_url.to_s
    if provider == "anthropic"
      return "zai" if b.include?("z.ai")
      "anthropic"
    elsif provider == "openai"
      return "ollama" if b.include?("11434")
      return "lmstudio" if b.include?("1234")
      return "gemini" if b.include?("generativelanguage")
      return "custom" if b.present?
      "openai"
    else
      "anthropic"
    end
  end

  private

  def detach_user_references
    ::User.where(llm_profile_id: id).update_all(llm_profile_id: nil)
    ::User.where(chat_llm_profile_id: id).update_all(chat_llm_profile_id: nil)
  end
end
```

- [ ] **Step 4b: User has_many 추가** — `backend/app/models/user.rb`의 has_many 선언부(User 모델엔 belongs_to 없음)에 1줄. `llm_profiles.user_id` FK 때문에 유저 삭제가 SQLite FOREIGN KEY 에러로 500 나는 것 방지(UserDeleter는 무수정 — destroy 콜백이 선처리):
```ruby
  has_many :llm_profiles, dependent: :destroy
```

- [ ] **Step 5: 마이그레이션 실행 + 테스트 통과 확인**

Run: `cd backend && bin/rails db:migrate && bundle exec rspec spec/models/llm_profile_spec.rb`
Expected: 마이그레이션 2개 적용, 테스트 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add backend/db/migrate/20260718000001_create_llm_profiles.rb backend/db/migrate/20260718000002_add_llm_profile_refs_to_users.rb backend/db/schema.rb backend/app/models/llm_profile.rb backend/spec/models/llm_profile_spec.rb
git commit -m "feat(llm-profiles): llm_profiles 테이블·모델 — 서버/개인 풀, 토큰 암호화, 참조 nullify"
```

---

### Task 2: LlmProfilesController CRUD + 라우트

**Files:**
- Create: `backend/app/controllers/api/v1/llm_profiles_controller.rb`
- Modify: `backend/config/routes.rb` (User-scoped settings 블록 근처, `namespace :user` 밖 api/v1 직속)
- Test: `backend/spec/requests/api/v1/llm_profiles_spec.rb`

**Interfaces:**
- Consumes: Task 1의 `LlmProfile`(scopes, `as_masked_json`, `PROVIDERS`)
- Produces: REST API —
  `GET /api/v1/llm_profiles?scope=personal|server` → `{ "profiles": [as_masked_json...] }` (scope 생략=personal)
  `POST /api/v1/llm_profiles?scope=...` body `{ "profile": { name, preset_id, provider, base_url, model, auth_token, max_input_tokens, max_output_tokens } }` → `{ "profile": {...} }` 201
  `PATCH /api/v1/llm_profiles/:id` body 동일(auth_token blank/미전송 = 기존 키 유지) → `{ "profile": {...} }`
  `DELETE /api/v1/llm_profiles/:id` → 204
  권한: server 풀 = `require_admin!`(server mode에서만 유효 — local 모드는 통과가 기존 규약), personal = 본인 소유만(타인 것 404). 서버 풀 프로필 변경 시 훅 `after_server_pool_change(profile)` 호출(Task 4에서 yaml 재실체화로 구현, 이 태스크에서는 no-op private 메서드로 둠).

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/requests/api/v1/llm_profiles_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe "Api::V1::LlmProfiles", type: :request do
  let(:user) { create(:user) }
  let(:admin) { create(:user, :admin) }

  describe "personal 풀" do
    before { login_as(user) }

    it "CRUD 왕복 + 토큰 마스킹 + blank 토큰 유지" do
      post "/api/v1/llm_profiles", params: { profile: {
        name: "Gemini · 무료키", preset_id: "gemini", provider: "openai",
        base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
        model: "gemini-3.5-flash", auth_token: "AIza-secret-1234567890"
      } }, as: :json
      expect(response).to have_http_status(:created)
      body = response.parsed_body["profile"]
      expect(body["auth_token_masked"]).to be_present
      expect(body.to_json).not_to include("AIza-secret")
      id = body["id"]

      get "/api/v1/llm_profiles"
      expect(response.parsed_body["profiles"].map { |p| p["id"] }).to include(id)

      patch "/api/v1/llm_profiles/#{id}", params: { profile: { model: "gemini-2.5-flash", auth_token: "" } }, as: :json
      expect(response).to have_http_status(:ok)
      expect(LlmProfile.find(id).auth_token).to eq("AIza-secret-1234567890") # blank = 유지
      expect(LlmProfile.find(id).model).to eq("gemini-2.5-flash")

      delete "/api/v1/llm_profiles/#{id}"
      expect(response).to have_http_status(:no_content)
      expect(LlmProfile.exists?(id)).to be false
    end

    it "타인 프로필은 404" do
      other = LlmProfile.create!(user: create(:user), name: "X", preset_id: "openai", provider: "openai")
      patch "/api/v1/llm_profiles/#{other.id}", params: { profile: { model: "m" } }, as: :json
      expect(response).to have_http_status(:not_found)
      delete "/api/v1/llm_profiles/#{other.id}"
      expect(response).to have_http_status(:not_found)
    end

    it "잘못된 provider는 422" do
      post "/api/v1/llm_profiles", params: { profile: { name: "C", preset_id: "claude_cli", provider: "claude_cli" } }, as: :json
      expect(response).to have_http_status(:unprocessable_entity)
    end
  end

  describe "server 풀 (server mode)" do
    before { allow_any_instance_of(ApplicationController).to receive(:server_mode?).and_return(true) }

    it "admin은 CRUD 가능, 풀은 user_id nil로 저장" do
      login_as(admin)
      post "/api/v1/llm_profiles?scope=server", params: { profile: { name: "S", preset_id: "anthropic", provider: "anthropic", auth_token: "sk-ant-xxxx-123456" } }, as: :json
      expect(response).to have_http_status(:created)
      expect(LlmProfile.last.user_id).to be_nil

      get "/api/v1/llm_profiles?scope=server"
      expect(response.parsed_body["profiles"].size).to eq(1)
    end

    it "비admin은 server 풀 접근 403" do
      login_as(user)
      get "/api/v1/llm_profiles?scope=server"
      expect(response).to have_http_status(:forbidden)
      post "/api/v1/llm_profiles?scope=server", params: { profile: { name: "S", preset_id: "openai", provider: "openai" } }, as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "비admin은 server 풀 프로필 수정·삭제도 403" do
      sp = LlmProfile.create!(user_id: nil, name: "S", preset_id: "openai", provider: "openai")
      login_as(user)
      patch "/api/v1/llm_profiles/#{sp.id}", params: { profile: { model: "m" } }, as: :json
      expect(response).to have_http_status(:forbidden)
      delete "/api/v1/llm_profiles/#{sp.id}"
      expect(response).to have_http_status(:forbidden)
    end
  end
end
```

- [ ] **Step 2: 실행 → 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/llm_profiles_spec.rb`
Expected: FAIL — 라우트 없음(404/RoutingError)

- [ ] **Step 3: 라우트 + 컨트롤러 작성**

`backend/config/routes.rb` — `# User-scoped settings` 블록 위에 추가:
```ruby
      # LLM 프로필 (서버 풀 scope=server / 개인 풀 scope=personal)
      resources :llm_profiles, only: %i[index create update destroy]
```

`backend/app/controllers/api/v1/llm_profiles_controller.rb`:
```ruby
module Api
  module V1
    class LlmProfilesController < ApplicationController
      include TokenMasking

      before_action :authenticate_user!
      before_action :require_admin_for_server_scope!, only: %i[index create]
      before_action :set_profile, only: %i[update destroy]

      def index
        render json: { profiles: pool_scope.order(:id).map { |p| masked(p) } }
      end

      def create
        profile = pool_scope.new(profile_params)
        profile.save!
        after_server_pool_change(profile) if profile.user_id.nil?
        render json: { profile: masked(profile) }, status: :created
      rescue ActiveRecord::RecordInvalid => e
        render json: { error: e.record.errors.full_messages.join(", ") }, status: :unprocessable_entity
      end

      def update
        attrs = profile_params
        attrs = attrs.except(:auth_token) if attrs[:auth_token].blank? # blank = 기존 키 유지
        @profile.update!(attrs)
        after_server_pool_change(@profile) if @profile.user_id.nil?
        render json: { profile: masked(@profile) }
      rescue ActiveRecord::RecordInvalid => e
        render json: { error: e.record.errors.full_messages.join(", ") }, status: :unprocessable_entity
      end

      def destroy
        @profile.destroy!
        after_server_pool_change(@profile) if @profile.user_id.nil?
        head :no_content
      end

      private

      def server_scope? = params[:scope] == "server"

      def require_admin_for_server_scope!
        require_admin! if server_scope?
      end

      def pool_scope
        server_scope? ? LlmProfile.server_pool : LlmProfile.personal_for(current_user)
      end

      # update/destroy는 레코드 소속으로 권한 판정(쿼리 파라미터 신뢰 안 함)
      def set_profile
        @profile = LlmProfile.find(params[:id])
        if @profile.user_id.nil?
          result = require_admin!
          return if performed? # require_admin!이 403 렌더한 경우
          result
        elsif @profile.user_id != current_user&.id
          raise ActiveRecord::RecordNotFound
        end
      end

      def profile_params
        params.require(:profile).permit(
          :name, :preset_id, :provider, :base_url, :model,
          :auth_token, :max_input_tokens, :max_output_tokens
        )
      end

      def masked(profile)
        profile.as_masked_json(method(:mask_token))
      end

      # 서버 풀 변경 훅 — Task 4에서 settings.yaml 재실체화로 구현. 지금은 no-op.
      def after_server_pool_change(_profile); end
    end
  end
end
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/llm_profiles_spec.rb`
Expected: 전부 PASS. (403 분기가 안 맞으면: `require_admin!`은 렌더만 하고 필터 체인을 끊지 않으므로 `set_profile`/`require_admin_for_server_scope!`에서 `performed?` 확인 후 return하는지 볼 것)

- [ ] **Step 5: 커밋**

```bash
git add backend/app/controllers/api/v1/llm_profiles_controller.rb backend/config/routes.rb backend/spec/requests/api/v1/llm_profiles_spec.rb
git commit -m "feat(llm-profiles): 프로필 CRUD API — 서버/개인 풀 권한 분리·토큰 마스킹"
```

---

### Task 3: User 참조 해석 + 개인 llm_settings API 확장

**Files:**
- Modify: `backend/app/models/user.rb` (`effective_llm_config` :75-86, `effective_chat_llm_config` :95-114, `llm_has_settings?` :70-73, `chat_llm_configured?` :145-151 인근)
- Modify: `backend/app/controllers/api/v1/user/llm_settings_controller.rb` (update, test, build_response)
- Test: `backend/spec/requests/api/v1/user/llm_settings_spec.rb` (기존 파일에 describe 추가), `backend/spec/models/user_spec.rb` (있으면 추가, 없으면 request spec만)

**Interfaces:**
- Consumes: Task 1 `LlmProfile#to_llm_config`, `users.llm_profile_id`/`chat_llm_profile_id`
- Produces:
  - `User#llm_profile` / `#chat_llm_profile` (belongs_to, optional, class_name: "LlmProfile")
  - 해석 순서(요약): `llm_profile_id` → 프로필 config / 없으면 기존 레거시 컬럼 경로(CLI 포함) / 미설정 → 서버 기본. `llm_enabled` 토글은 프로필 선택에도 동일 적용.
  - 해석 순서(챗): `chat_llm_provider == 'server'` 센티넬 최우선(현행) → `chat_llm_profile_id` → 레거시 chat 컬럼(CLI) → 요약 따라가기 카스케이드(현행).
  - PUT `user/llm_settings` 신규 파라미터: `llm_profile_id`(정수|null), `chat_llm_profile_id`(정수|null). `llm_profile_id` 세팅 시 레거시 요약 컬럼(provider/model/base_url/api_key) 클리어, CLI provider 세팅 시 `llm_profile_id` 클리어(상호배타). 타인/서버풀 프로필 id → 422.
  - `build_response`의 `llm_settings`에 `llm_profile_id`, `chat_llm_profile_id` 추가. 프로필 선택 시 `provider/model/base_url/api_key_masked`는 프로필 값으로 채워 반환(프론트 표시용).
  - POST `user/llm_settings/test`에 `profile_id` 파라미터 추가 — api_key 미전송 시 해당 프로필(본인 소유 또는 admin+서버풀)의 토큰 폴백.
  - 부수 버그 수정: `build_response`의 `server_default[:api_key]` → `[:auth_token]` (has_key 항상 false 버그).

- [ ] **Step 1: 실패 테스트 작성** — 기존 spec 파일 끝에 추가:

```ruby
  describe "프로필 참조 (llm_profile_id)" do
    let(:profile) do
      LlmProfile.create!(user: user, name: "P", preset_id: "gemini", provider: "openai",
                         base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
                         model: "gemini-3.5-flash", auth_token: "AIza-tok-123456789")
    end

    it "PUT llm_profile_id → 참조 저장 + 레거시 요약 컬럼 클리어 + 응답에 id 포함" do
      user.update!(llm_provider: "anthropic", llm_api_key: "sk-old-1234567890", llm_model: "old")
      put "/api/v1/user/llm_settings", params: { llm_settings: { llm_profile_id: profile.id } }, as: :json
      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.llm_profile_id).to eq(profile.id)
      expect(user.llm_provider).to be_nil
      expect(user.llm_api_key).to be_nil
      body = response.parsed_body["llm_settings"]
      expect(body["llm_profile_id"]).to eq(profile.id)
      expect(body["provider"]).to eq("openai")
      expect(body["model"]).to eq("gemini-3.5-flash")
      expect(body["configured"]).to be true
    end

    it "effective_llm_config가 프로필 값을 반환한다" do
      user.update!(llm_profile_id: profile.id)
      expect(user.effective_llm_config).to eq(profile.to_llm_config)
    end

    it "llm_enabled=false면 프로필이 있어도 서버 기본으로 폴백" do
      user.update!(llm_profile_id: profile.id, llm_enabled: false)
      expect(user.effective_llm_config).to eq(User.server_default_llm_config)
    end

    it "CLI provider 저장 시 llm_profile_id가 클리어된다(상호배타)" do
      user.update!(llm_profile_id: profile.id)
      put "/api/v1/user/llm_settings", params: { llm_settings: { provider: "claude_cli", model: "sonnet" } }, as: :json
      expect(response).to have_http_status(:ok)
      expect(user.reload.llm_profile_id).to be_nil
      expect(user.llm_provider).to eq("claude_cli")
    end

    it "타인/서버풀 프로필 id는 422" do
      other = LlmProfile.create!(user: create(:user), name: "O", preset_id: "openai", provider: "openai")
      server = LlmProfile.create!(user_id: nil, name: "S", preset_id: "openai", provider: "openai")
      [ other, server ].each do |p|
        put "/api/v1/user/llm_settings", params: { llm_settings: { llm_profile_id: p.id } }, as: :json
        expect(response).to have_http_status(:unprocessable_entity)
      end
      expect(user.reload.llm_profile_id).to be_nil
    end

    it "chat_llm_profile_id 참조 — 챗 해석이 챗 프로필 값을 쓴다" do
      put "/api/v1/user/llm_settings", params: { llm_settings: { chat_llm_profile_id: profile.id } }, as: :json
      expect(response).to have_http_status(:ok)
      expect(user.reload.chat_llm_profile_id).to eq(profile.id)
      expect(user.effective_chat_llm_config).to eq(profile.to_llm_config)
    end

    it "챗 'server' 센티넬은 챗 프로필보다 우선(현행 유지)" do
      user.update!(chat_llm_profile_id: profile.id, chat_llm_provider: "server")
      expect(user.effective_chat_llm_config).to eq(user.server_chat_llm_config)
    end

    it "test 액션 profile_id 토큰 폴백" do
      svc = instance_double(LlmService, test_connection: { "success" => true })
      expect(LlmService).to receive(:new).with(llm_config: hash_including(auth_token: "AIza-tok-123456789")).and_return(svc)
      post "/api/v1/user/llm_settings/test", params: { provider: "openai", model: "gemini-3.5-flash", profile_id: profile.id }, as: :json
      expect(response).to have_http_status(:ok)
    end

    it "llm_profile_id: null → 참조 해제(선택 안함)" do
      user.update!(llm_profile_id: profile.id)
      put "/api/v1/user/llm_settings", params: { llm_settings: { provider: "", llm_profile_id: nil } }, as: :json
      expect(response).to have_http_status(:ok)
      expect(user.reload.llm_profile_id).to be_nil
    end
  end
```

- [ ] **Step 2: 실행 → 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/user/llm_settings_spec.rb`
Expected: 신규 describe 전부 FAIL (기존 테스트는 PASS 유지 — 깨지면 즉시 중단하고 원인 파악)

- [ ] **Step 3: User 모델 수정**

`backend/app/models/user.rb` — 연관 추가(has_many 선언부 근처 — User 모델엔 belongs_to 없음):
```ruby
  belongs_to :llm_profile, class_name: "LlmProfile", optional: true
  belongs_to :chat_llm_profile, class_name: "LlmProfile", optional: true
```

`llm_has_settings?`(:70-73) 교체:
```ruby
  def llm_has_settings?
    llm_profile_id.present? ||
      (llm_provider.present? && (llm_api_key.present? || llm_provider_cli?))
  end
```

`effective_llm_config`(:75-86) 교체:
```ruby
  def effective_llm_config
    if llm_configured?
      return llm_profile.to_llm_config if llm_profile

      {
        provider: llm_provider,
        auth_token: llm_api_key,
        model: llm_model,
        base_url: llm_base_url
      }.compact
    else
      self.class.server_default_llm_config
    end
  end
```

`effective_chat_llm_config`(:95-114) — 센티넬 분기 바로 아래에 프로필 분기 삽입:
```ruby
  def effective_chat_llm_config
    return server_chat_llm_config if chat_llm_provider == CHAT_SERVER_SENTINEL
    return chat_llm_profile.to_llm_config if chat_llm_profile

    # ... 이하 기존 코드 그대로 (chat_llm_configured? 분기부터)
```

`chat_llm_configured?`(:145-151)는 무수정(레거시 chat 컬럼 판정 전용으로 남음). `sidecar_llm_config`(:155-164)도 프로필 반영:
```ruby
  def sidecar_llm_config
    return nil unless llm_configured?
    return llm_profile.to_llm_config if llm_profile

    # ... 기존 해시 그대로
```

- [ ] **Step 4: 컨트롤러 수정**

`backend/app/controllers/api/v1/user/llm_settings_controller.rb`:

(a) strong params(:137-141)에 프로필 id 추가:
```ruby
        p = params.require(:llm_settings).permit(
          :provider, :api_key, :model, :base_url, :llm_profile_id,
          :chat_provider, :chat_api_key, :chat_model, :chat_base_url, :chat_llm_profile_id
        )
```

(b) `update` 재구성 — **주의: 기존 코드는 `attrs[:llm_provider].blank?`면 무조건 '선택 안함/초기화' 분기로 빠져 `attrs`를 버린다.** 프로필만 담긴 페이로드(`{ llm_profile_id: N }` — provider 키 없음)가 저장되려면 분기 조건 자체를 바꿔야 한다.

소유 검증 헬퍼(private, 422 렌더 담당):
```ruby
      # 본인 소유 개인 프로필만 참조 가능. 그 외(타인·서버풀·없는 id)는 422 렌더.
      # blank(명시적 해제)는 nil 반환. 렌더 여부는 호출부에서 performed?로 판단.
      def own_profile_id!(raw)
        return nil if raw.blank?
        id = raw.to_i
        unless LlmProfile.personal_for(current_user).exists?(id)
          render json: { error: "유효하지 않은 프로필입니다" }, status: :unprocessable_entity
        end
        id
      end
```

`update` 액션 수정 — 4단계:
```ruby
      def update
        raw = params.require(:llm_settings)

        # 1) 프로필 참조 추출 (provider와 독립적으로 처리)
        profile_attrs = {}
        if raw.key?(:llm_profile_id)
          id = own_profile_id!(raw[:llm_profile_id])
          return if performed?
          profile_attrs[:llm_profile_id] = id
          profile_attrs.merge!(llm_provider: nil, llm_api_key: nil, llm_model: nil, llm_base_url: nil) if id
        end
        if raw.key?(:chat_llm_profile_id)
          id = own_profile_id!(raw[:chat_llm_profile_id])
          return if performed?
          profile_attrs[:chat_llm_profile_id] = id
          profile_attrs.merge!(chat_llm_provider: nil, chat_llm_api_key: nil, chat_llm_model: nil, chat_llm_base_url: nil) if id
        end

        attrs = normalize_params.merge(profile_attrs)

        # 2) 상호배타 — provider를 직접 지정(CLI 등)하면 반대편 참조 해제
        attrs[:llm_profile_id] = nil if raw[:provider].present? && !raw.key?(:llm_profile_id)
        attrs[:chat_llm_profile_id] = nil if raw.key?(:chat_provider) && !raw.key?(:chat_llm_profile_id)

        # 3) 기존 '선택 안함/초기화' 분기: 조건을 `attrs[:llm_provider].blank?` →
        #    `raw.key?(:provider) && raw[:provider].blank?` 로 좁힌다 (provider를 명시적으로
        #    비웠을 때만 초기화). 그 분기의 current_user.update!(base.merge(chat)) 해시에
        #    attrs.slice(:llm_profile_id, :chat_llm_profile_id)를 추가로 merge.
        # 4) 하단 공통 경로: VALID_PROVIDERS 검증을 `attrs[:llm_provider].present?`일 때만
        #    수행하도록 감싼다. 프로필-only 페이로드는 검증 없이 current_user.update!(attrs).
        ...
      end
```
(3·4는 기존 코드 :17-68을 직접 편집 — 삭제·재작성 말고 조건·머지만 손대서 기존 초기화/보존 시맨틱 유지.)

(c) `test`(:77-101) — api_key 폴백 체인에 profile_id 추가:
```ruby
        api_key = params[:api_key].presence
        if api_key.blank? && params[:profile_id].present?
          profile = LlmProfile.find_by(id: params[:profile_id])
          if profile && (profile.user_id == current_user.id || (profile.user_id.nil? && current_user&.admin?))
            api_key = profile.auth_token
          end
        end
        api_key ||= saved_api_key_for(provider)
```

(d) `build_response`(:201-228) — `llm_settings` 해시에 추가·수정:
```ruby
          llm_profile_id: current_user.llm_profile_id,
          chat_llm_profile_id: current_user.chat_llm_profile_id,
```
프로필 선택 시 표시 필드는 프로필 값 우선:
```ruby
        profile = current_user.llm_profile
        provider_for_display = profile&.provider || current_user.llm_provider
        model_for_display = profile&.model || current_user.llm_model
        base_url_for_display = profile&.base_url || current_user.llm_base_url
        masked = profile&.auth_token.present? ? mask_token(profile.auth_token) : (current_user.llm_api_key.present? ? mask_token(current_user.llm_api_key) : nil)
```
(기존 필드 자리에 대입. chat 쪽도 `current_user.chat_llm_profile` 동일 패턴.)

(e) 부수 버그 수정 — `server_default` 조립부(:225 인근): `User.server_default_llm_config[:api_key]` → `[:auth_token]`:
```ruby
        server_default: {
          provider: server_cfg[:provider], model: server_cfg[:model],
          has_key: server_cfg[:auth_token].present? || AppSettings::CLI_LLM_PROVIDERS.include?(server_cfg[:provider].to_s)
        }
```

- [ ] **Step 5: 테스트 통과 + 기존 회귀 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/user/llm_settings_spec.rb spec/models/llm_profile_spec.rb`
Expected: 전부 PASS (기존 테스트 포함 — 특히 초기화/reset_all/CLI 케이스)

- [ ] **Step 6: 커밋**

```bash
git add backend/app/models/user.rb backend/app/controllers/api/v1/user/llm_settings_controller.rb backend/spec/requests/api/v1/user/llm_settings_spec.rb
git commit -m "feat(llm-profiles): 개인 설정 프로필 참조 — 해석 카스케이드·API 확장·test 폴백"
```

---

### Task 4: 서버 설정 active_profile_id + settings.yaml 실체화

**Files:**
- Create: `backend/app/services/llm_profile_yaml_sync.rb`
- Modify: `backend/app/services/app_settings.rb` (ENV 동기화 이동 수용)
- Modify: `backend/app/controllers/api/v1/settings_controller.rb` (`#llm` :79-105, `#update_llm` :107-158, `#sync_active_llm_to_env` :314-362, `#test_llm` :160-185)
- Modify: `backend/app/controllers/api/v1/llm_profiles_controller.rb` (`after_server_pool_change` 구현)
- Test: `backend/spec/requests/api/v1/settings_spec.rb` (describe 추가), `backend/spec/requests/api/v1/llm_profiles_spec.rb` (yaml 스텁 추가), `backend/spec/services/llm_profile_yaml_sync_spec.rb`

**Interfaces:**
- Consumes: Task 1 `LlmProfile`, Task 2 컨트롤러의 `after_server_pool_change` 훅 자리
- Produces:
  - `LlmProfileYamlSync.apply!(cfg) → cfg` — `llm.active_profile_id`/`llm.chat_profile_id`가 가리키는 서버 풀 프로필을 기존 yaml 구조(`llm.active_preset`+`llm.presets[preset_id]`, `llm.chat`)로 **실체화**. 삭제된 프로필 id는 키 제거. `load_env.rb`는 무수정으로 동작.
  - `AppSettings.sync_env_from!(cfg)` — 기존 `SettingsController#sync_active_llm_to_env` 본문의 **그대로 이동**(verbatim move). 컨트롤러 메서드는 위임으로 축소.
  - `PUT settings/llm` 신규 파라미터: `active_profile_id`(정수|null), `chat_profile_id`(정수|null) — 서버 풀에 없는 id면 422. `GET settings/llm` 응답에 `active_profile_id`, `chat_profile_id` 추가.
  - `POST settings/llm/test`에 `profile_id` 토큰 폴백(서버 풀, admin 전제 — 기존 `require_admin!` 대상 액션).
  - 서버 풀 프로필 create/update/destroy 시(`after_server_pool_change`): yaml 재실체화 + `AppSettings.sync_env_from!` (활성 참조가 아니면 실질 no-op이지만 항상 안전하게 재적용).

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/services/llm_profile_yaml_sync_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe LlmProfileYamlSync do
  let!(:profile) do
    LlmProfile.create!(user_id: nil, name: "Gemini · 무료키", preset_id: "gemini", provider: "openai",
                       base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
                       model: "gemini-3.5-flash", auth_token: "AIza-tok-123456789",
                       max_input_tokens: 100_000, max_output_tokens: 8_000)
  end

  it "active_profile_id를 기존 presets 구조로 실체화한다 (load_env 호환)" do
    cfg = { "llm" => { "active_profile_id" => profile.id } }
    described_class.apply!(cfg)
    llm = cfg["llm"]
    expect(llm["active_preset"]).to eq("gemini")
    expect(llm["presets"]["gemini"]).to include(
      "provider" => "openai", "auth_token" => "AIza-tok-123456789",
      "model" => "gemini-3.5-flash", "max_input_tokens" => 100_000, "max_output_tokens" => 8_000
    )
  end

  it "chat_profile_id는 llm.chat으로 실체화한다" do
    cfg = { "llm" => { "chat_profile_id" => profile.id } }
    described_class.apply!(cfg)
    expect(cfg["llm"]["chat"]).to include("preset_id" => "gemini", "provider" => "openai", "auth_token" => "AIza-tok-123456789", "model" => "gemini-3.5-flash")
  end

  it "삭제된 프로필 id는 참조 키를 제거하고 실체화 값은 남긴다" do
    cfg = { "llm" => { "active_profile_id" => 999_999, "active_preset" => "anthropic", "presets" => { "anthropic" => { "provider" => "anthropic" } } } }
    described_class.apply!(cfg)
    expect(cfg["llm"]).not_to have_key("active_profile_id")
    expect(cfg["llm"]["active_preset"]).to eq("anthropic")
  end
end
```

`backend/spec/requests/api/v1/settings_spec.rb` — 기존 server-mode admin describe에 추가(파일의 기존 File I/O 스텁 패턴 재사용, `File.write` 인자 캡처):
```ruby
    it "PUT settings/llm active_profile_id → yaml에 실체화·응답에 id 포함" do
      profile = LlmProfile.create!(user_id: nil, name: "SP", preset_id: "openai", provider: "openai",
                                   model: "gpt-4o-mini", auth_token: "sk-xxxx-12345678")
      written = nil
      allow(File).to receive(:write).with(Api::V1::SettingsController::SETTINGS_PATH, anything) { |_, body| written = body; true }
      put "/api/v1/settings/llm", params: { active_profile_id: profile.id }, as: :json
      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["active_profile_id"]).to eq(profile.id)
      cfg = YAML.safe_load(written)
      expect(cfg["llm"]["active_preset"]).to eq("openai")
      expect(cfg["llm"]["presets"]["openai"]).to include("model" => "gpt-4o-mini", "auth_token" => "sk-xxxx-12345678")
    end

    it "서버 풀에 없는 active_profile_id는 422" do
      put "/api/v1/settings/llm", params: { active_profile_id: 424_242 }, as: :json
      expect(response).to have_http_status(:unprocessable_entity)
    end
```

`backend/spec/requests/api/v1/llm_profiles_spec.rb`의 server 풀 describe에 추가(같은 File 스텁 세팅 + 활성 프로필 편집 시 재실체화 검증):
```ruby
    it "활성 서버 프로필 편집 시 yaml 재실체화" do
      login_as(admin)
      sp = LlmProfile.create!(user_id: nil, name: "S", preset_id: "openai", provider: "openai", model: "old", auth_token: "sk-xxxx-12345678")
      allow(File).to receive(:exist?).and_call_original
      allow(File).to receive(:exist?).with(AppSettings::SETTINGS_PATH).and_return(true)
      allow(File).to receive(:read).with(AppSettings::SETTINGS_PATH).and_return(YAML.dump({ "llm" => { "active_profile_id" => sp.id } }))
      written = nil
      allow(File).to receive(:write).with(AppSettings::SETTINGS_PATH, anything) { |_, body| written = body; true }
      patch "/api/v1/llm_profiles/#{sp.id}", params: { profile: { model: "gpt-4o" } }, as: :json
      expect(response).to have_http_status(:ok)
      expect(YAML.safe_load(written)["llm"]["presets"]["openai"]["model"]).to eq("gpt-4o")
    end
```

- [ ] **Step 2: 실행 → 실패 확인**

Run: `cd backend && bundle exec rspec spec/services/llm_profile_yaml_sync_spec.rb spec/requests/api/v1/settings_spec.rb spec/requests/api/v1/llm_profiles_spec.rb`
Expected: 신규 케이스 FAIL(`uninitialized constant LlmProfileYamlSync` 등), 기존 PASS 유지

- [ ] **Step 3: 서비스 + ENV 동기화 이동 구현**

`backend/app/services/llm_profile_yaml_sync.rb`:
```ruby
# 서버 풀 프로필 참조(active_profile_id/chat_profile_id)를 settings.yaml의 기존 구조
# (active_preset + presets[preset_id] / chat)로 실체화한다. 부팅 load_env.rb가 DB 없이
# yaml만 읽어도 되게 하는 캐시 계층 — 참조 의미론(프로필 편집 즉시 반영)은
# after_server_pool_change 훅이 재실체화로 보장한다.
class LlmProfileYamlSync
  def self.apply!(cfg)
    llm = (cfg["llm"] ||= {})

    if (pid = llm["active_profile_id"]).present?
      if (profile = LlmProfile.server_pool.find_by(id: pid))
        llm["active_preset"] = profile.preset_id
        (llm["presets"] ||= {})[profile.preset_id] = materialize(profile)
      else
        llm.delete("active_profile_id")
      end
    end

    if (cid = llm["chat_profile_id"]).present?
      if (profile = LlmProfile.server_pool.find_by(id: cid))
        llm["chat"] = {
          "preset_id" => profile.preset_id,
          "provider" => profile.provider,
          "auth_token" => profile.auth_token.to_s,
          "base_url" => profile.base_url.to_s,
          "model" => profile.model.to_s
        }.reject { |_, v| v.blank? }
      else
        llm.delete("chat_profile_id")
      end
    end

    cfg
  end

  def self.materialize(profile)
    {
      "provider" => profile.provider,
      "auth_token" => profile.auth_token,
      "base_url" => profile.base_url,
      "model" => profile.model,
      "max_input_tokens" => profile.max_input_tokens || 200_000,
      "max_output_tokens" => profile.max_output_tokens || 10_000
    }.compact
  end
end
```

`backend/app/services/app_settings.rb` — `SettingsController#sync_active_llm_to_env`(:314-362) 본문을 `def self.sync_env_from!(cfg)`로 **그대로 이동**(cfg를 인자로 받도록만 변경; `load_settings` 호출부는 호출자가 cfg 전달). `SettingsController#sync_active_llm_to_env`는 `AppSettings.sync_env_from!(load_settings)` 한 줄 위임으로 축소.

- [ ] **Step 4: 컨트롤러 수정**

`settings_controller.rb#update_llm` — 프리셋 병합 처리 뒤·`save_settings(cfg)` 앞에 삽입:
```ruby
        # 프로필 참조(서버 풀) — 값 검증 후 참조 저장, 실체화는 LlmProfileYamlSync가 담당
        %w[active_profile_id chat_profile_id].each do |key|
          next unless params.key?(key)
          raw = params[key]
          if raw.present?
            unless LlmProfile.server_pool.exists?(raw.to_i)
              return render json: { error: "유효하지 않은 프로필입니다" }, status: :unprocessable_entity
            end
            llm_cfg[key] = raw.to_i
          else
            llm_cfg.delete(key)
          end
        end

        LlmProfileYamlSync.apply!(cfg)
```
`#llm` 응답에 추가: `active_profile_id: llm_cfg["active_profile_id"], chat_profile_id: llm_cfg["chat_profile_id"]`.
`#test_llm` — 저장 프리셋 폴백(:171-174) 앞에 profile_id 폴백 추가:
```ruby
        if auth_token.blank? && params[:profile_id].present?
          auth_token = LlmProfile.server_pool.find_by(id: params[:profile_id])&.auth_token
        end
```

`llm_profiles_controller.rb#after_server_pool_change` 구현부 교체:
```ruby
      # 서버 풀 변경 → yaml 재실체화 + ENV 재적용 (활성 참조 여부와 무관하게 항상 안전)
      def after_server_pool_change(_profile)
        cfg = AppSettings.load
        LlmProfileYamlSync.apply!(cfg)
        File.write(AppSettings::SETTINGS_PATH, YAML.dump(cfg.deep_stringify_keys))
        AppSettings.sync_env_from!(cfg)
      end
```
(파일 상단에 `require "yaml"` — settings_controller와 동일 패턴.)

- [ ] **Step 5: 테스트 통과 + 전체 백엔드 회귀**

Run: `cd backend && bundle exec rspec spec/services/llm_profile_yaml_sync_spec.rb spec/requests/api/v1/settings_spec.rb spec/requests/api/v1/llm_profiles_spec.rb spec/requests/api/v1/user/llm_settings_spec.rb`
Expected: 전부 PASS. sync 이동으로 기존 settings_spec가 깨지면 verbatim move 여부 재확인(동작 변경 금지).

- [ ] **Step 6: 커밋**

```bash
git add backend/app/services/llm_profile_yaml_sync.rb backend/app/services/app_settings.rb backend/app/controllers/api/v1/settings_controller.rb backend/app/controllers/api/v1/llm_profiles_controller.rb backend/spec
git commit -m "feat(llm-profiles): 서버 활성 프로필 참조+yaml 실체화 — 부팅 load_env 무수정"
```

---

### Task 5: 레거시 설정 → 프로필 이관 (importer + 데이터 마이그레이션)

**Files:**
- Create: `backend/app/services/llm_profile_legacy_importer.rb`
- Create: `backend/db/migrate/20260718000003_migrate_llm_settings_to_profiles.rb`
- Test: `backend/spec/services/llm_profile_legacy_importer_spec.rb`

**Interfaces:**
- Consumes: Task 1 `LlmProfile.preset_id_for`, Task 4 `LlmProfileYamlSync`
- Produces: `LlmProfileLegacyImporter.run!` — 멱등(idempotent) 이관:
  1. users: `llm_provider ∈ {anthropic, openai}`(CLI 제외)이고 키 또는 base_url 보유 → 개인 프로필 생성 + `llm_profile_id` 세팅 + 레거시 요약 컬럼 클리어. `chat_llm_provider` 동일(단 `'server'` 센티넬·CLI 제외).
  2. settings.yaml: `llm.presets`의 API 프리셋(provider anthropic/openai) → 서버 풀 프로필 생성(이름 = 프리셋 라벨). `active_preset`이 API면 `active_profile_id` 세팅, `llm.chat`이 API면 `chat_profile_id` 세팅. `LlmProfileYamlSync.apply!` 후 저장.
  - 멱등성: 레거시 컬럼을 클리어하므로 재실행 시 대상 없음. 서버 풀은 `find_or_create_by!(user_id: nil, name:)`.

- [ ] **Step 1: 실패 테스트 작성**

`backend/spec/services/llm_profile_legacy_importer_spec.rb`:
```ruby
require "rails_helper"

RSpec.describe LlmProfileLegacyImporter do
  before do
    allow(File).to receive(:exist?).and_call_original
    allow(File).to receive(:exist?).with(AppSettings::SETTINGS_PATH).and_return(true)
    allow(File).to receive(:read).with(AppSettings::SETTINGS_PATH).and_return(YAML.dump(yaml))
    allow(File).to receive(:write).with(AppSettings::SETTINGS_PATH, anything).and_return(true)
  end
  let(:yaml) { {} }

  describe "users 이관" do
    let(:yaml) { {} }

    it "API 설정 유저 → 프로필 생성+참조+레거시 클리어, CLI 유저는 그대로" do
      api_user = create(:user, llm_provider: "anthropic", llm_api_key: "sk-ant-123456789", llm_model: "claude-sonnet-5")
      cli_user = create(:user, llm_provider: "claude_cli", llm_model: "sonnet")
      zai_user = create(:user, llm_provider: "anthropic", llm_api_key: "zk-123456789", llm_base_url: "https://api.z.ai/api/anthropic", llm_model: "glm-5.2")

      described_class.run!

      api_user.reload
      expect(api_user.llm_profile).to be_present
      expect(api_user.llm_profile.preset_id).to eq("anthropic")
      expect(api_user.llm_profile.auth_token).to eq("sk-ant-123456789")
      expect(api_user.llm_provider).to be_nil

      expect(cli_user.reload.llm_provider).to eq("claude_cli")
      expect(cli_user.llm_profile_id).to be_nil

      expect(zai_user.reload.llm_profile.preset_id).to eq("zai")
    end

    it "챗 독립 설정도 챗 프로필로 이관, 'server' 센티넬은 보존" do
      chat_user = create(:user, chat_llm_provider: "openai", chat_llm_api_key: "sk-oa-123456789", chat_llm_model: "gpt-4o-mini")
      server_user = create(:user, chat_llm_provider: "server")

      described_class.run!

      expect(chat_user.reload.chat_llm_profile.preset_id).to eq("openai")
      expect(chat_user.chat_llm_provider).to be_nil
      expect(server_user.reload.chat_llm_provider).to eq("server")
    end

    it "멱등 — 두 번 실행해도 프로필이 늘지 않는다" do
      create(:user, llm_provider: "openai", llm_api_key: "sk-123456789", llm_model: "gpt-4o")
      described_class.run!
      expect { described_class.run! }.not_to change(LlmProfile, :count)
    end
  end

  describe "settings.yaml 이관" do
    let(:yaml) do
      { "llm" => {
        "active_preset" => "openai",
        "presets" => {
          "openai" => { "provider" => "openai", "auth_token" => "sk-server-123456789", "model" => "gpt-4o", "max_input_tokens" => 150_000 },
          "claude_cli" => { "provider" => "claude_cli", "model" => "sonnet" }
        },
        "chat" => { "preset_id" => "zai", "provider" => "anthropic", "auth_token" => "zk-9876543210", "base_url" => "https://api.z.ai/api/anthropic", "model" => "glm-5.2" }
      } }
    end

    it "API 프리셋만 서버 풀 프로필화, active/chat 참조 세팅, CLI 프리셋은 프로필 미생성" do
      written = nil
      allow(File).to receive(:write).with(AppSettings::SETTINGS_PATH, anything) { |_, body| written = body; true }

      described_class.run!

      pool = LlmProfile.server_pool
      expect(pool.pluck(:preset_id)).to contain_exactly("openai", "zai")
      openai_p = pool.find_by(preset_id: "openai")
      expect(openai_p.auth_token).to eq("sk-server-123456789")
      expect(openai_p.max_input_tokens).to eq(150_000)

      cfg = YAML.safe_load(written)
      expect(cfg["llm"]["active_profile_id"]).to eq(openai_p.id)
      expect(cfg["llm"]["chat_profile_id"]).to eq(pool.find_by(preset_id: "zai").id)
      expect(cfg["llm"]["active_preset"]).to eq("openai") # 실체화 유지
    end
  end
end
```

- [ ] **Step 2: 실행 → 실패 확인**

Run: `cd backend && bundle exec rspec spec/services/llm_profile_legacy_importer_spec.rb`
Expected: FAIL — `uninitialized constant LlmProfileLegacyImporter`

- [ ] **Step 3: importer 구현**

`backend/app/services/llm_profile_legacy_importer.rb`:
```ruby
# 레거시 LLM 설정(users 컬럼·settings.yaml presets)을 llm_profiles로 1회 이관.
# 멱등: users는 이관 시 레거시 컬럼을 클리어하므로 재실행 대상이 사라지고,
# 서버 풀은 (user_id: nil, name) find_or_create. CLI 설정은 프로필 대상이 아니므로 보존.
class LlmProfileLegacyImporter
  API_PROVIDERS = %w[anthropic openai].freeze
  PRESET_LABELS = {
    "anthropic" => "Anthropic", "zai" => "Z.AI", "openai" => "OpenAI",
    "gemini" => "Google Gemini", "ollama" => "Ollama", "lmstudio" => "LM Studio",
    "custom" => "직접 입력"
  }.freeze

  def self.run!
    import_users!
    import_server_yaml!
  end

  def self.import_users!
    ::User.where(llm_provider: API_PROVIDERS, llm_profile_id: nil).find_each do |u|
      next if u.llm_api_key.blank? && u.llm_base_url.blank?

      profile = create_personal!(u, u.llm_provider, u.llm_base_url, u.llm_model, u.llm_api_key)
      u.update!(llm_profile_id: profile.id, llm_provider: nil, llm_api_key: nil, llm_model: nil, llm_base_url: nil)
    end

    ::User.where(chat_llm_provider: API_PROVIDERS, chat_llm_profile_id: nil).find_each do |u|
      next if u.chat_llm_api_key.blank? && u.chat_llm_base_url.blank?

      profile = create_personal!(u, u.chat_llm_provider, u.chat_llm_base_url, u.chat_llm_model, u.chat_llm_api_key)
      u.update!(chat_llm_profile_id: profile.id, chat_llm_provider: nil, chat_llm_api_key: nil, chat_llm_model: nil, chat_llm_base_url: nil)
    end
  end

  def self.create_personal!(user, provider, base_url, model, token)
    preset = LlmProfile.preset_id_for(provider, base_url)
    base_name = [ PRESET_LABELS.fetch(preset, preset), model.presence ].compact.join(" · ")
    name = base_name
    n = 2
    while LlmProfile.exists?(user_id: user.id, name: name)
      name = "#{base_name} (#{n})"
      n += 1
    end
    LlmProfile.create!(
      user_id: user.id, name: name, preset_id: preset, provider: provider,
      base_url: base_url.presence, model: model.presence, auth_token: token.presence
    )
  end

  def self.import_server_yaml!
    cfg = AppSettings.load
    llm = cfg["llm"]
    return if llm.blank?

    presets = llm["presets"] || {}
    created = {}
    presets.each do |preset_id, data|
      provider = data["provider"].to_s
      next unless API_PROVIDERS.include?(provider)

      created[preset_id] = LlmProfile.find_or_create_by!(user_id: nil, name: PRESET_LABELS.fetch(preset_id, preset_id)) do |p|
        p.preset_id = preset_id
        p.provider = provider
        p.base_url = data["base_url"].presence
        p.model = data["model"].presence
        p.auth_token = data["auth_token"].presence
        p.max_input_tokens = data["max_input_tokens"]
        p.max_output_tokens = data["max_output_tokens"]
      end
    end

    active = llm["active_preset"].to_s
    llm["active_profile_id"] = created[active].id if created[active] && llm["active_profile_id"].blank?

    chat = llm["chat"] || {}
    if API_PROVIDERS.include?(chat["provider"].to_s) && llm["chat_profile_id"].blank?
      chat_preset = chat["preset_id"].presence || LlmProfile.preset_id_for(chat["provider"], chat["base_url"])
      chat_profile = created[chat_preset] || LlmProfile.find_or_create_by!(user_id: nil, name: "#{PRESET_LABELS.fetch(chat_preset, chat_preset)} (챗)") do |p|
        p.preset_id = chat_preset
        p.provider = chat["provider"]
        p.base_url = chat["base_url"].presence
        p.model = chat["model"].presence
        p.auth_token = chat["auth_token"].presence
      end
      llm["chat_profile_id"] = chat_profile.id
    end

    LlmProfileYamlSync.apply!(cfg)
    File.write(AppSettings::SETTINGS_PATH, YAML.dump(cfg.deep_stringify_keys))
  end
end
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && bundle exec rspec spec/services/llm_profile_legacy_importer_spec.rb`
Expected: 전부 PASS

- [ ] **Step 5: 데이터 마이그레이션 작성 + 실행**

`backend/db/migrate/20260718000003_migrate_llm_settings_to_profiles.rb`:
```ruby
class MigrateLlmSettingsToProfiles < ActiveRecord::Migration[8.1]
  # 데이터 이관만 수행(DDL 없음). 로직·멱등성은 LlmProfileLegacyImporter가 담당.
  def up
    ::User.reset_column_information
    LlmProfileLegacyImporter.run!
  end

  def down
    # 비파괴 이관(프로필이 레거시를 대체) — 롤백 없음
  end
end
```

Run: `cd backend && bin/rails db:migrate && bundle exec rspec spec`
Expected: 마이그레이션 적용 + **백엔드 전체 스위트** GREEN (여기서 한 번 전체 회귀)

- [ ] **Step 6: 커밋**

```bash
git add backend/app/services/llm_profile_legacy_importer.rb backend/db/migrate/20260718000003_migrate_llm_settings_to_profiles.rb backend/db/schema.rb backend/spec/services/llm_profile_legacy_importer_spec.rb
git commit -m "feat(llm-profiles): 레거시 설정 이관 — users 컬럼·settings.yaml → 프로필(멱등)"
```

---

### Task 6: 프리셋 데이터 확장 — Gemini·apiKeyUrl·PROFILE_PRESETS

**Files:**
- Modify: `frontend/src/components/settings/llmServicePresets.ts`
- Test: `frontend/src/components/settings/llmServicePresets.test.ts`

**Interfaces:**
- Consumes: 없음 (독립 — 백엔드와 병행 가능)
- Produces: `ServicePreset.apiKeyUrl?: string` / 신규 프리셋 `id: 'gemini'` / `PROFILE_PRESETS`(CLI 제외 목록), `CLI_PRESETS`(CLI만) named export / `presetIdFromUserConfig`가 `generativelanguage` URL → `'gemini'` 반환. 기존 export 전부 유지.

- [ ] **Step 1: 실패 테스트 작성** — `llmServicePresets.test.ts` 기존 id 배열 어설션을 gemini 포함으로 갱신 + 추가:

```ts
  it('gemini 프리셋 — OpenAI 호환·키 필요·발급 링크', () => {
    const g = SERVICE_PRESETS.find((p) => p.id === 'gemini')!
    expect(g.provider).toBe('openai')
    expect(g.defaultBaseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai')
    expect(g.requiresApiKey).toBe(true)
    expect(g.suggestedModels[0]).toBe('gemini-3.5-flash')
    expect(g.apiKeyUrl).toBe('https://aistudio.google.com/app/apikey')
  })

  it('키 필요 프리셋 4종은 apiKeyUrl 보유', () => {
    for (const id of ['anthropic', 'openai', 'gemini', 'zai']) {
      expect(SERVICE_PRESETS.find((p) => p.id === id)?.apiKeyUrl).toBeTruthy()
    }
  })

  it('presetIdFromUserConfig — generativelanguage URL은 gemini', () => {
    expect(presetIdFromUserConfig('openai', 'https://generativelanguage.googleapis.com/v1beta/openai')).toBe('gemini')
  })

  it('PROFILE_PRESETS는 CLI 제외, CLI_PRESETS는 CLI만', () => {
    expect(PROFILE_PRESETS.map((p) => p.id)).toEqual(['anthropic', 'zai', 'gemini', 'openai', 'ollama', 'lmstudio', 'custom'])
    expect(CLI_PRESETS.map((p) => p.id)).toEqual(['claude_cli', 'gemini_cli', 'codex_cli'])
  })
```
(기존 `SERVICE_PRESETS` id 목록 어설션은 `['claude_cli','gemini_cli','codex_cli','anthropic','zai','gemini','openai','ollama','lmstudio','custom']`로 갱신.)

- [ ] **Step 2: 실행 → 실패 확인**

Run: `cd frontend && npx vitest run src/components/settings/llmServicePresets.test.ts`
Expected: FAIL (gemini 없음, PROFILE_PRESETS 미export)

- [ ] **Step 3: 구현**

`llmServicePresets.ts` 수정:
```ts
export interface ServicePreset {
  id: string
  name: string
  provider: string
  defaultBaseUrl: string
  requiresApiKey: boolean
  suggestedModels: readonly string[]
  description: string
  /** API 키 발급 페이지 (있으면 폼에 "API 키 발급 ↗" 링크 노출) */
  apiKeyUrl?: string
}
```
`SERVICE_PRESETS` 항목 변경 — anthropic·zai·openai에 apiKeyUrl 추가, zai 다음에 gemini 삽입:
```ts
  { id: 'anthropic', ..., description: 'Claude API (키 필요)', apiKeyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'zai', ..., description: 'GLM 모델 (Anthropic 호환)', apiKeyUrl: 'https://z.ai/manage-apikey/apikey-list' },
  { id: 'gemini', name: 'Google Gemini', provider: 'openai', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', requiresApiKey: true, suggestedModels: ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'], description: 'Gemini API (키 필요, OpenAI 호환)', apiKeyUrl: 'https://aistudio.google.com/app/apikey' },
  { id: 'openai', ..., description: 'GPT 모델 (키 필요)', apiKeyUrl: 'https://platform.openai.com/api-keys' },
```
`presetIdFromUserConfig`의 openai 분기 — `11434`/`1234` 검사 뒤·`custom` 앞에:
```ts
    if (b.includes('generativelanguage')) return 'gemini'
```
파일 끝에 추가:
```ts
/** 프로필 폼용(팝업 프리셋 그리드) — CLI 제외. CLI는 선택 드롭다운의 내장 항목. */
export const PROFILE_PRESETS: readonly ServicePreset[] = SERVICE_PRESETS.filter((p) => !CLI_PRESET_IDS.has(p.id))
export const CLI_PRESETS: readonly ServicePreset[] = SERVICE_PRESETS.filter((p) => CLI_PRESET_IDS.has(p.id))
```

- [ ] **Step 4: 테스트 통과 + 파급 확인**

Run: `cd frontend && npx vitest run src/components/settings/llmServicePresets.test.ts src/components/settings/LlmProviderCard.test.tsx src/components/settings/UserLlmSettings.test.tsx src/components/settings/LlmSettingsPanel.test.tsx`
Expected: 전부 PASS (gemini는 isCloudListable=true로 자동 편입 — 기존 카드 테스트 영향 없음이 정상. 그리드 개수 어설션이 있으면 갱신)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/settings/llmServicePresets.ts frontend/src/components/settings/llmServicePresets.test.ts
git commit -m "feat(llm-profiles): Gemini API 프리셋+키 발급 링크+PROFILE/CLI 프리셋 분리"
```

---

### Task 7: 프로필 API 클라이언트 + openExternal 헬퍼

**Files:**
- Create: `frontend/src/api/llmProfiles.ts`
- Create: `frontend/src/lib/openExternal.ts` (`frontend/src/lib/`가 없으면 `frontend/src/utils/` 등 기존 헬퍼 디렉토리를 `ls frontend/src`로 확인해 그곳에 생성)
- Modify: `frontend/src/api/userLlmSettings.ts` (`UserLlmTestParams`에 `profile_id?: number` 추가)

**Interfaces:**
- Consumes: Task 2 백엔드 API, `frontend/src/api/client.ts`의 `apiClient`(prefixUrl에 `/api/v1` 포함 — 경로는 선행 슬래시 없이)
- Produces:
```ts
export interface LlmProfile {
  id: number; name: string; preset_id: string; provider: string
  base_url: string | null; model: string | null
  max_input_tokens: number | null; max_output_tokens: number | null
  has_token: boolean; auth_token_masked: string | null
}
export type LlmProfileScope = 'personal' | 'server'
export interface LlmProfileParams {
  name: string; preset_id: string; provider: string
  base_url?: string; model?: string; auth_token?: string
  max_input_tokens?: number; max_output_tokens?: number
}
export async function listLlmProfiles(scope?: LlmProfileScope): Promise<LlmProfile[]>
export async function createLlmProfile(scope: LlmProfileScope, params: LlmProfileParams): Promise<LlmProfile>
export async function updateLlmProfile(id: number, params: Partial<LlmProfileParams>): Promise<LlmProfile>
export async function deleteLlmProfile(id: number): Promise<void>
export async function openExternal(url: string): Promise<void>  // lib 쪽
```

- [ ] **Step 1: 구현** (얇은 래퍼 — 기존 api/* 모듈처럼 개별 유닛테스트 없음, 소비 컴포넌트 테스트가 커버)

`frontend/src/api/llmProfiles.ts`:
```ts
import apiClient from './client'

export interface LlmProfile {
  id: number
  name: string
  preset_id: string
  provider: string
  base_url: string | null
  model: string | null
  max_input_tokens: number | null
  max_output_tokens: number | null
  has_token: boolean
  auth_token_masked: string | null
}

export type LlmProfileScope = 'personal' | 'server'

export interface LlmProfileParams {
  name: string
  preset_id: string
  provider: string
  base_url?: string
  model?: string
  auth_token?: string
  max_input_tokens?: number
  max_output_tokens?: number
}

export async function listLlmProfiles(scope: LlmProfileScope = 'personal'): Promise<LlmProfile[]> {
  const res = await apiClient.get('llm_profiles', { searchParams: { scope } }).json<{ profiles: LlmProfile[] }>()
  return res.profiles
}

export async function createLlmProfile(scope: LlmProfileScope, params: LlmProfileParams): Promise<LlmProfile> {
  const res = await apiClient.post('llm_profiles', { searchParams: { scope }, json: { profile: params } }).json<{ profile: LlmProfile }>()
  return res.profile
}

export async function updateLlmProfile(id: number, params: Partial<LlmProfileParams>): Promise<LlmProfile> {
  const res = await apiClient.patch(`llm_profiles/${id}`, { json: { profile: params } }).json<{ profile: LlmProfile }>()
  return res.profile
}

export async function deleteLlmProfile(id: number): Promise<void> {
  await apiClient.delete(`llm_profiles/${id}`)
}
```

`frontend/src/lib/openExternal.ts` — Tauri는 기본 브라우저(plugin-shell, 이미 의존성), 웹은 window.open:
```ts
import { IS_TAURI } from '../config'

export async function openExternal(url: string): Promise<void> {
  if (IS_TAURI) {
    const { open } = await import('@tauri-apps/plugin-shell')
    await open(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
```

`frontend/src/api/userLlmSettings.ts` — `UserLlmTestParams`에 `profile_id?: number` 필드 추가.

- [ ] **Step 2: 타입 게이트**

Run: `cd frontend && npx tsc -p tsconfig.app.json 2>&1 | tail -5`
Expected: 에러 수 = 기준선(사전존재 ~24)과 동일, 신규 파일 관련 에러 0

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/api/llmProfiles.ts frontend/src/lib/openExternal.ts frontend/src/api/userLlmSettings.ts
git commit -m "feat(llm-profiles): 프로필 API 클라이언트+외부링크 헬퍼"
```

---

### Task 8: LlmProfileForm + LlmProfilesModal (프로필 관리 팝업)

**Files:**
- Create: `frontend/src/components/settings/LlmProfileForm.tsx`
- Create: `frontend/src/components/settings/LlmProfilesModal.tsx`
- Test: `frontend/src/components/settings/LlmProfilesModal.test.tsx`

**Interfaces:**
- Consumes: Task 6 `PROFILE_PRESETS`·`presetFormDefaults`·`isLocalListable`·`isCloudListable`·`LOCAL_MODEL_FETCHERS`, Task 7 `listLlmProfiles/createLlmProfile/updateLlmProfile/deleteLlmProfile/LlmProfile/openExternal`, `testUserLlmConnection`(연결 테스트 — 스코프 무관 범용), `fetchUserLlmModels`(클라우드 모델 목록 프록시)
- Produces:
```ts
// LlmProfileForm.tsx
export interface LlmProfileFormProps {
  scope: 'personal' | 'server'      // server면 최대 입출력 토큰 필드 노출
  initial: LlmProfile | null        // null = 새 프로필
  onSaved: (profile: LlmProfile) => void
  onCancel: () => void
}
export function LlmProfileForm(props: LlmProfileFormProps): JSX.Element

// LlmProfilesModal.tsx
export interface LlmProfilesModalProps {
  scope: 'personal' | 'server'
  open: boolean
  initialCreate?: boolean           // true면 열리자마자 새 프로필 폼
  onClose: () => void
  onChanged?: (profiles: LlmProfile[]) => void  // 생성·수정·삭제 후 최신 목록 통지
}
export default function LlmProfilesModal(props: LlmProfilesModalProps): JSX.Element | null
```

- [ ] **Step 1: 실패 테스트 작성**

`frontend/src/components/settings/LlmProfilesModal.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import LlmProfilesModal from './LlmProfilesModal'
import type { LlmProfile } from '../../api/llmProfiles'

vi.mock('../../api/llmProfiles', () => ({
  listLlmProfiles: vi.fn(),
  createLlmProfile: vi.fn(),
  updateLlmProfile: vi.fn(),
  deleteLlmProfile: vi.fn(),
}))
vi.mock('../../api/userLlmSettings', () => ({
  testUserLlmConnection: vi.fn(),
  fetchUserLlmModels: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../api/settings', () => ({
  fetchOllamaModels: vi.fn().mockResolvedValue([]),
  fetchLmStudioModels: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../lib/openExternal', () => ({ openExternal: vi.fn() }))
// confirmDialog 헬퍼 실제 경로를 grep으로 확인해 동일하게 mock (예: ../../lib/confirmDialog)
vi.mock('../../lib/confirmDialog', () => ({ confirmDialog: vi.fn().mockResolvedValue(true) }))

import { listLlmProfiles, createLlmProfile, deleteLlmProfile } from '../../api/llmProfiles'
import { openExternal } from '../../lib/openExternal'

const gemini: LlmProfile = {
  id: 1, name: 'Gemini · 무료키', preset_id: 'gemini', provider: 'openai',
  base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
  model: 'gemini-3.5-flash', max_input_tokens: null, max_output_tokens: null,
  has_token: true, auth_token_masked: 'AIza****z8kQ',
}

describe('LlmProfilesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(listLlmProfiles).mockResolvedValue([gemini])
  })

  it('open=false면 렌더 안 함', () => {
    render(<LlmProfilesModal scope="personal" open={false} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('열리면 목록 로드·행 표시(이름·마스킹키), 원문 키는 어디에도 없음', async () => {
    render(<LlmProfilesModal scope="personal" open onClose={() => {}} />)
    expect(await screen.findByText('Gemini · 무료키')).toBeInTheDocument()
    expect(screen.getByText(/AIza\*+z8kQ/)).toBeInTheDocument()
    expect(vi.mocked(listLlmProfiles)).toHaveBeenCalledWith('personal')
  })

  it('＋새 프로필 → 폼 노출(프리셋 그리드에 CLI 없음·Gemini 있음), 저장 시 createLlmProfile', async () => {
    vi.mocked(createLlmProfile).mockResolvedValue({ ...gemini, id: 2, name: 'OpenAI · gpt-4o' })
    render(<LlmProfilesModal scope="personal" open onClose={() => {}} />)
    fireEvent.click(await screen.findByText('＋ 새 프로필'))
    const grid = await screen.findByTestId('profile-preset-grid')
    expect(within(grid).queryByText('Claude Code')).toBeNull()
    expect(within(grid).getByText('Google Gemini')).toBeInTheDocument()
    fireEvent.click(screen.getByText('프로필 저장'))
    await waitFor(() => expect(vi.mocked(createLlmProfile)).toHaveBeenCalled())
    expect(vi.mocked(createLlmProfile).mock.calls[0][0]).toBe('personal')
  })

  it('API 키 발급 링크 → openExternal', async () => {
    render(<LlmProfilesModal scope="personal" open onClose={() => {}} />)
    fireEvent.click(await screen.findByText('＋ 새 프로필'))
    fireEvent.click(await screen.findByText(/API 키 발급/))
    expect(vi.mocked(openExternal)).toHaveBeenCalledWith('https://console.anthropic.com/settings/keys')
  })

  it('삭제 → confirm 후 deleteLlmProfile + 목록 갱신', async () => {
    vi.mocked(deleteLlmProfile).mockResolvedValue()
    render(<LlmProfilesModal scope="personal" open onClose={() => {}} />)
    fireEvent.click(await screen.findByLabelText('Gemini · 무료키 삭제'))
    await waitFor(() => expect(vi.mocked(deleteLlmProfile)).toHaveBeenCalledWith(1))
  })

  it('scope=server면 서버 풀 조회 + 토큰 한계 필드 노출', async () => {
    render(<LlmProfilesModal scope="server" open onClose={() => {}} />)
    await screen.findByText('Gemini · 무료키')
    expect(vi.mocked(listLlmProfiles)).toHaveBeenCalledWith('server')
    fireEvent.click(screen.getByText('＋ 새 프로필'))
    expect(await screen.findByLabelText('최대 입력 토큰')).toBeInTheDocument()
  })
})
```
(주의: 새 프로필 폼 기본 프리셋은 `anthropic` — 발급 링크 어설션이 Anthropic Console URL인 이유. `confirmDialog` 실경로는 구현 전 `grep -rn "confirmDialog" frontend/src`로 확인해 mock 경로·import를 맞출 것. 헬퍼가 없으면 이 태스크에서 `frontend/src/lib/confirmDialog.ts`로 신설: `IS_TAURI`면 `@tauri-apps/plugin-dialog`의 `confirm` await, 아니면 `window.confirm`.)

- [ ] **Step 2: 실행 → 실패 확인**

Run: `cd frontend && npx vitest run src/components/settings/LlmProfilesModal.test.tsx`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: LlmProfileForm 구현**

`LlmProfileForm.tsx` — **기존 `LlmProviderCard.tsx`(:35-247)의 폼 본문을 이식**하되: 특수옵션(noneOption)·CLI 분기 제거, 프리셋 소스 = `PROFILE_PRESETS`, 그리드 testid = `profile-preset-grid`, 필드 추가(프로필 이름·발급 링크·연결 테스트·저장/취소). 골격:
```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { PROFILE_PRESETS, LOCAL_MODEL_FETCHERS, isLocalListable, isCloudListable, presetFormDefaults } from './llmServicePresets'
import { createLlmProfile, updateLlmProfile, type LlmProfile } from '../../api/llmProfiles'
import { testUserLlmConnection, fetchUserLlmModels } from '../../api/userLlmSettings'
import { openExternal } from '../../lib/openExternal'
import { PasswordInput } from '../ui/PasswordInput'

export interface LlmProfileFormProps {
  scope: 'personal' | 'server'
  initial: LlmProfile | null
  onSaved: (profile: LlmProfile) => void
  onCancel: () => void
}

export function LlmProfileForm({ scope, initial, onSaved, onCancel }: LlmProfileFormProps) {
  const [presetId, setPresetId] = useState(initial?.preset_id ?? 'anthropic')
  const [form, setForm] = useState({
    base_url: initial?.base_url ?? presetFormDefaults(initial?.preset_id ?? 'anthropic').base_url,
    model: initial?.model ?? presetFormDefaults(initial?.preset_id ?? 'anthropic').model,
    auth_token: '',
    name: initial?.name ?? '',
    max_input_tokens: initial?.max_input_tokens ?? 200000,
    max_output_tokens: initial?.max_output_tokens ?? 10000,
  })
  // ... LlmProviderCard의 localModels/cloudModels/useCustomModel/loadGenRef 로직 그대로 이식
  //     (fetcher: LOCAL_MODEL_FETCHERS / onFetchModels 상당 = fetchUserLlmModels 직접 호출)
  const preset = PROFILE_PRESETS.find((p) => p.id === presetId)

  const autoName = () => {
    const base = preset?.name ?? presetId
    return form.model ? `${base} · ${form.model}` : base
  }

  const handleSave = async () => {
    const params = {
      name: form.name.trim() || autoName(),
      preset_id: presetId,
      provider: preset?.provider ?? 'openai',
      base_url: form.base_url || undefined,
      model: form.model || undefined,
      ...(form.auth_token ? { auth_token: form.auth_token } : {}),
      ...(scope === 'server' ? { max_input_tokens: form.max_input_tokens, max_output_tokens: form.max_output_tokens } : {}),
    }
    const saved = initial ? await updateLlmProfile(initial.id, params) : await createLlmProfile(scope, params)
    onSaved(saved)
  }

  const handleTest = async () => {
    // 편집 중 키 미입력이면 profile_id로 저장된 키 폴백(백엔드 Task 3/4)
    return testUserLlmConnection({
      provider: preset?.provider ?? 'openai', model: form.model,
      ...(form.auth_token ? { api_key: form.auth_token } : {}),
      ...(form.base_url ? { base_url: form.base_url } : {}),
      ...(!form.auth_token && initial ? { profile_id: initial.id } : {}),
    })
  }
  // 렌더: 프리셋 그리드(PROFILE_PRESETS, data-testid="profile-preset-grid", 선택 시 presetFormDefaults로 폼 리셋)
  //   → Base URL 입력 → API Key(PasswordInput, 라벨 오른쪽에 preset?.apiKeyUrl 있으면
  //     <button type="button" onClick={() => openExternal(preset.apiKeyUrl!)}>API 키 발급 ↗</button>,
  //     initial?.auth_token_masked 있으면 placeholder·"현재: {masked} — 비워두면 기존 키 유지" 힌트)
  //   → 모델명(select/직접입력/모델 새로고침 — LlmProviderCard 로직 이식)
  //   → scope==='server'면 최대 입력/출력 토큰 2필드(label "최대 입력 토큰"/"최대 출력 토큰")
  //   → 프로필 이름 입력(placeholder=autoName())
  //   → 하단 버튼: 취소 / 연결 테스트(결과 문구 표시) / 프로필 저장
}
```
스타일은 기존 카드 클래스 재사용(`rounded-lg border p-3`, 활성 `border-blue-500 bg-blue-50 ring-1`, 입력 `w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[44px]`).

- [ ] **Step 4: LlmProfilesModal 구현**

`LlmProfilesModal.tsx` — `SettingsModal.tsx` 골격(role="dialog"·ESC·CONTAINER_DESKTOP/MOBILE·닫기 버튼) 재사용, open 상태는 props:
```tsx
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { listLlmProfiles, deleteLlmProfile, type LlmProfile } from '../../api/llmProfiles'
import { LlmProfileForm } from './LlmProfileForm'
import { confirmDialog } from '../../lib/confirmDialog' // grep으로 실경로 확인
import { SERVICE_PRESETS } from './llmServicePresets'

export interface LlmProfilesModalProps {
  scope: 'personal' | 'server'
  open: boolean
  initialCreate?: boolean
  onClose: () => void
  onChanged?: (profiles: LlmProfile[]) => void
}

export default function LlmProfilesModal({ scope, open, initialCreate, onClose, onChanged }: LlmProfilesModalProps) {
  const [profiles, setProfiles] = useState<LlmProfile[]>([])
  const [editing, setEditing] = useState<LlmProfile | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = async () => {
    const list = await listLlmProfiles(scope)
    setProfiles(list)
    onChanged?.(list)
    return list
  }

  useEffect(() => {
    if (!open) return
    setEditing(initialCreate ? 'new' : null)
    reload().catch(() => setError('프로필 목록을 불러올 수 없습니다.'))
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope])

  if (!open) return null

  const handleDelete = async (p: LlmProfile) => {
    if (!(await confirmDialog(`'${p.name}' 프로필을 삭제할까요? 이 프로필을 쓰는 설정은 해제됩니다.`))) return
    await deleteLlmProfile(p.id)
    await reload()
  }
  // 렌더: 오버레이+컨테이너(SettingsModal과 동일 클래스) / 헤더 "LLM 프로필 관리" + X
  //   본문: 에러 배너 → 목록(행: 이름 · 프리셋 라벨 뱃지(SERVICE_PRESETS에서 name 조회) ·
  //     model · auth_token_masked · [편집] [삭제(aria-label=`${p.name} 삭제`)])
  //   → editing 없으면 [＋ 새 프로필] 버튼, 있으면 <LlmProfileForm scope={scope}
  //     initial={editing === 'new' ? null : editing}
  //     onSaved={async () => { setEditing(null); await reload() }} onCancel={() => setEditing(null)} />
}
```

- [ ] **Step 5: 테스트 통과 + 타입 게이트**

Run: `cd frontend && npx vitest run src/components/settings/LlmProfilesModal.test.tsx && npx tsc -p tsconfig.app.json 2>&1 | tail -3`
Expected: 테스트 전부 PASS, 신규 타입 에러 0

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/components/settings/LlmProfileForm.tsx frontend/src/components/settings/LlmProfilesModal.tsx frontend/src/components/settings/LlmProfilesModal.test.tsx frontend/src/lib
git commit -m "feat(llm-profiles): 프로필 관리 팝업 — 목록·생성·편집·삭제·연결테스트·키 발급 링크"
```

---

### Task 9: LlmSelector + UserLlmSettings 개편 (개인 선택 카드)

**Files:**
- Create: `frontend/src/components/settings/LlmSelector.tsx`
- Modify: `frontend/src/components/settings/UserLlmSettings.tsx` (LlmProviderCard 사용부 전면 교체)
- Modify: `frontend/src/api/userLlmSettings.ts` (응답·요청 타입에 프로필 id)
- Test: `frontend/src/components/settings/LlmSelector.test.tsx`, `frontend/src/components/settings/UserLlmSettings.test.tsx` (기존 갱신)

**Interfaces:**
- Consumes: Task 6 `CLI_PRESETS`·`CLI_PRESET_IDS`, Task 7 `LlmProfile`, Task 8 `LlmProfilesModal`, `getMode()`(CLI 게이트)
- Produces:
```ts
// LlmSelector.tsx — 표시 전용(dumb). 특수옵션 버튼줄 + 드롭다운(시스템 CLI/내 프로필 그룹) + CLI 모델 셀렉터
export type LlmSelectorValue =
  | { type: 'special'; id: string }
  | { type: 'cli'; presetId: string; model: string }
  | { type: 'profile'; profileId: number }
export interface LlmSelectorProps {
  title: string
  idPrefix: string
  specialOptions: readonly { id: string; label: string; description: string }[]
  profiles: readonly LlmProfile[]
  cliAllowed: boolean
  value: LlmSelectorValue
  onChange: (v: LlmSelectorValue) => void
  onManageProfiles: () => void      // "프로필 관리" 버튼
  onCreateProfile: () => void       // 드롭다운 "＋새 프로필 만들기…"
}
export function LlmSelector(props: LlmSelectorProps): JSX.Element
```
  - 백엔드 응답 ↔ 선택값 매핑(요약): `llm_profile_id` → `{type:'profile'}` / `provider`가 CLI → `{type:'cli'}` / 그 외 → `{type:'special', id:'none'}`. (챗): `chat_llm_profile_id` → profile / `chat_provider`==='server' → special 'server' / CLI → cli / null → special ''(요약과 동일).
  - 저장 페이로드(요약): profile → `{ llm_profile_id }` / cli → `{ provider: presetId, model }` / 'none' → `{ provider: '', llm_profile_id: null }`. (챗): profile → `{ chat_llm_profile_id }` / cli → `{ chat_provider: presetId, chat_model: model }` / 'server' → `{ chat_provider: 'server' }` / '' → `{ chat_provider: null, chat_llm_profile_id: null, chat_model: <레거시 오버라이드 입력값|null> }`.

- [ ] **Step 1: LlmSelector 실패 테스트 작성**

`frontend/src/components/settings/LlmSelector.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { LlmSelector, type LlmSelectorValue } from './LlmSelector'
import type { LlmProfile } from '../../api/llmProfiles'

const profiles: LlmProfile[] = [
  { id: 1, name: 'Gemini · 무료키', preset_id: 'gemini', provider: 'openai', base_url: null, model: 'gemini-3.5-flash', max_input_tokens: null, max_output_tokens: null, has_token: true, auth_token_masked: 'AIza****z8kQ' },
]
const special = [{ id: 'none', label: '선택 안함', description: '서버 기본값 사용' }] as const

function renderSel(value: LlmSelectorValue, over: Partial<React.ComponentProps<typeof LlmSelector>> = {}) {
  const onChange = vi.fn()
  render(<LlmSelector title="요약 LLM" idPrefix="sum" specialOptions={special} profiles={profiles}
    cliAllowed value={value} onChange={onChange} onManageProfiles={vi.fn()} onCreateProfile={vi.fn()} {...over} />)
  return onChange
}

describe('LlmSelector', () => {
  it('드롭다운에 시스템 CLI 그룹 + 내 프로필 그룹 + ＋새 프로필', () => {
    renderSel({ type: 'special', id: 'none' })
    const sel = screen.getByLabelText('요약 LLM 프로필') as HTMLSelectElement
    const groups = within(sel).getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('label'))).toEqual(['시스템 CLI', '내 프로필'])
    expect(within(sel).getByText('Claude Code')).toBeInTheDocument()
    expect(within(sel).getByText(/Gemini · 무료키/)).toBeInTheDocument()
    expect(within(sel).getByText('＋ 새 프로필 만들기…')).toBeInTheDocument()
  })

  it('cliAllowed=false면 시스템 CLI 그룹 숨김', () => {
    renderSel({ type: 'special', id: 'none' }, { cliAllowed: false })
    const sel = screen.getByLabelText('요약 LLM 프로필') as HTMLSelectElement
    expect(within(sel).queryByText('Claude Code')).toBeNull()
  })

  it('프로필 선택 → onChange({type:profile})', () => {
    const onChange = renderSel({ type: 'special', id: 'none' })
    fireEvent.change(screen.getByLabelText('요약 LLM 프로필'), { target: { value: 'profile:1' } })
    expect(onChange).toHaveBeenCalledWith({ type: 'profile', profileId: 1 })
  })

  it('CLI 선택 시 모델 셀렉터 노출, 모델 변경 전파', () => {
    const onChange = renderSel({ type: 'cli', presetId: 'claude_cli', model: 'sonnet' })
    const model = screen.getByLabelText('요약 LLM CLI 모델')
    expect(model).toBeInTheDocument()
    fireEvent.change(model, { target: { value: 'opus' } })
    expect(onChange).toHaveBeenCalledWith({ type: 'cli', presetId: 'claude_cli', model: 'opus' })
  })

  it('＋새 프로필 선택 → onCreateProfile, 값은 변경 안 함', () => {
    const onCreate = vi.fn()
    const onChange = renderSel({ type: 'special', id: 'none' }, { onCreateProfile: onCreate })
    fireEvent.change(screen.getByLabelText('요약 LLM 프로필'), { target: { value: '__new__' } })
    expect(onCreate).toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it("'직접 선택' 버튼 — special 상태에서 클릭 시 첫 프로필로 전환", () => {
    const onChange = renderSel({ type: 'special', id: 'none' })
    fireEvent.click(screen.getByText('직접 선택'))
    expect(onChange).toHaveBeenCalledWith({ type: 'profile', profileId: 1 })
  })

  it('특수옵션 버튼 클릭 → special 전파, 프로필 관리 버튼 → onManageProfiles', () => {
    const onManage = vi.fn()
    const onChange = renderSel({ type: 'profile', profileId: 1 }, { onManageProfiles: onManage })
    fireEvent.click(screen.getByText('선택 안함'))
    expect(onChange).toHaveBeenCalledWith({ type: 'special', id: 'none' })
    fireEvent.click(screen.getByText('프로필 관리'))
    expect(onManage).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 실행 → 실패 → LlmSelector 구현**

Run: `cd frontend && npx vitest run src/components/settings/LlmSelector.test.tsx` → FAIL 확인 후 구현:
```tsx
import { CLI_PRESETS } from './llmServicePresets'
import type { LlmProfile } from '../../api/llmProfiles'

export type LlmSelectorValue =
  | { type: 'special'; id: string }
  | { type: 'cli'; presetId: string; model: string }
  | { type: 'profile'; profileId: number }

export interface LlmSelectorProps {
  title: string
  idPrefix: string
  specialOptions: readonly { id: string; label: string; description: string }[]
  profiles: readonly LlmProfile[]
  cliAllowed: boolean
  value: LlmSelectorValue
  onChange: (v: LlmSelectorValue) => void
  onManageProfiles: () => void
  onCreateProfile: () => void
}

const optCls = (active: boolean) =>
  `rounded-lg border p-3 text-left transition-all ${active ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-border hover:border-blue-300 hover:bg-accent'}`

export function LlmSelector({ title, idPrefix, specialOptions, profiles, cliAllowed, value, onChange, onManageProfiles, onCreateProfile }: LlmSelectorProps) {
  const selectValue =
    value.type === 'profile' ? `profile:${value.profileId}` :
    value.type === 'cli' ? `cli:${value.presetId}` : ''
  const cliPreset = value.type === 'cli' ? CLI_PRESETS.find((p) => p.id === value.presetId) : undefined

  const handleSelect = (raw: string) => {
    if (raw === '__new__') { onCreateProfile(); return }
    if (raw.startsWith('profile:')) { onChange({ type: 'profile', profileId: Number(raw.slice(8)) }); return }
    if (raw.startsWith('cli:')) {
      const presetId = raw.slice(4)
      const preset = CLI_PRESETS.find((p) => p.id === presetId)
      onChange({ type: 'cli', presetId, model: preset?.suggestedModels[0] ?? '' })
    }
  }

  return (
    <div className="rounded-lg border bg-card p-4" data-testid={`${idPrefix}-selector`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <button type="button" onClick={onManageProfiles}
          className="text-xs font-semibold text-blue-600 border rounded-md px-3 py-1 hover:bg-blue-50">프로필 관리</button>
      </div>
      <div className="flex gap-2 flex-wrap mb-3">
        {specialOptions.map((opt) => {
          const active = value.type === 'special' && value.id === opt.id
          return (
            <button key={opt.id || '__none__'} type="button" aria-pressed={active} onClick={() => onChange({ type: 'special', id: opt.id })} className={optCls(active)}>
              <p className="text-sm font-medium">{opt.label}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{opt.description}</p>
            </button>
          )
        })}
        <button type="button" aria-pressed={value.type !== 'special'}
          onClick={() => { if (value.type === 'special') handleSelect(profiles[0] ? `profile:${profiles[0].id}` : (cliAllowed && CLI_PRESETS[0] ? `cli:${CLI_PRESETS[0].id}` : '__new__')) }}
          className={optCls(value.type !== 'special')}>
          <p className="text-sm font-medium">직접 선택</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">CLI·내 프로필에서 선택</p>
        </button>
      </div>
      {value.type !== 'special' && (<>
        <label htmlFor={`${idPrefix}-profile-select`} className="block text-xs font-semibold text-muted-foreground mb-1">프로필</label>
        <select id={`${idPrefix}-profile-select`} aria-label={`${title} 프로필`} value={selectValue} onChange={(e) => handleSelect(e.target.value)}
          className="w-full rounded-md border px-3 py-2 text-sm bg-card min-h-[44px]">
          {selectValue === '' && <option value="">선택하세요</option>}
          {cliAllowed && (
            <optgroup label="시스템 CLI">
              {CLI_PRESETS.map((p) => <option key={p.id} value={`cli:${p.id}`}>{p.name}</option>)}
            </optgroup>
          )}
          <optgroup label="내 프로필">
            {profiles.map((p) => <option key={p.id} value={`profile:${p.id}`}>{p.name}{p.model ? ` — ${p.model}` : ''}</option>)}
          </optgroup>
          <option value="__new__">＋ 새 프로필 만들기…</option>
        </select>
        {value.type === 'cli' && cliPreset && (
          <div className="mt-3">
            <label htmlFor={`${idPrefix}-cli-model`} className="block text-sm font-medium mb-1">CLI 모델</label>
            <select id={`${idPrefix}-cli-model`} aria-label={`${title} CLI 모델`} value={value.model}
              onChange={(e) => onChange({ type: 'cli', presetId: value.presetId, model: e.target.value })}
              className="w-full rounded-md border px-3 py-2 text-sm bg-card font-mono min-h-[44px]">
              {(value.model && !cliPreset.suggestedModels.includes(value.model)
                ? [ ...cliPreset.suggestedModels, value.model ] : cliPreset.suggestedModels).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <p className="text-xs text-muted-foreground mt-1">CLI는 키·URL이 필요 없어 프로필 없이 바로 사용합니다.</p>
          </div>
        )}
      </>)}
    </div>
  )
}
```
Run: 같은 명령 → PASS.

- [ ] **Step 3: userLlmSettings.ts 타입 확장**

`UserLlmSettingsResponse.llm_settings`에 `llm_profile_id?: number | null`, `chat_llm_profile_id?: number | null` 추가. `UserLlmSettingsUpdateParams.llm_settings`에 `llm_profile_id?: number | null`, `chat_llm_profile_id?: number | null` 추가, `provider`를 `provider?: string`로 완화(프로필만 저장하는 페이로드 허용).

- [ ] **Step 4: UserLlmSettings.tsx 개편**

교체 내용(기존 :17-401 구조 유지, 카드부만 교체):
- 상태: `summaryForm/chatForm/presetId` 4종 제거 → `summarySel: LlmSelectorValue`, `chatSel: LlmSelectorValue`, `chatFollowModel: string`(요약과 동일일 때 레거시 모델 오버라이드), `profiles: LlmProfile[]`, `profilesModal: { open: boolean; create: boolean }`.
- 로드: `getUserLlmSettings()` + `listLlmProfiles('personal')` 병렬(`Promise.all`). 응답→선택 매핑은 Interfaces 표 그대로 구현 (`initFromSettings(ls)`):
```ts
const toSummarySel = (ls: UserLlmSettingsResponse['llm_settings']): LlmSelectorValue => {
  if (ls.llm_profile_id) return { type: 'profile', profileId: ls.llm_profile_id }
  if (ls.provider && CLI_PRESET_IDS.has(ls.provider)) return { type: 'cli', presetId: ls.provider, model: ls.model ?? '' }
  return { type: 'special', id: 'none' }
}
const toChatSel = (ls: UserLlmSettingsResponse['llm_settings']): LlmSelectorValue => {
  if (ls.chat_llm_profile_id) return { type: 'profile', profileId: ls.chat_llm_profile_id }
  if (ls.chat_provider === 'server') return { type: 'special', id: 'server' }
  if (ls.chat_provider && CLI_PRESET_IDS.has(ls.chat_provider)) return { type: 'cli', presetId: ls.chat_provider, model: ls.chat_model ?? '' }
  return { type: 'special', id: '' }
}
```
- 저장 `handleSave`: Interfaces의 페이로드 매핑 그대로:
```ts
const summaryPayload =
  summarySel.type === 'profile' ? { llm_profile_id: summarySel.profileId } :
  summarySel.type === 'cli' ? { provider: summarySel.presetId, model: summarySel.model } :
  { provider: '', llm_profile_id: null }
const chatPayload =
  chatSel.type === 'profile' ? { chat_llm_profile_id: chatSel.profileId } :
  chatSel.type === 'cli' ? { chat_provider: chatSel.presetId, chat_model: chatSel.model } :
  chatSel.id === 'server' ? { chat_provider: 'server' as const } :
  { chat_provider: null, chat_llm_profile_id: null, chat_model: chatFollowModel || null }
await updateUserLlmSettings({ llm_settings: { ...summaryPayload, ...chatPayload } })
```
- 카드 렌더: `LlmSelector` 2개 — 요약(`specialOptions=[{id:'none',...서버 기본}]`), 챗(`[{id:'',요약과 동일},{id:'server',선택 안함/서버 기본 챗}]`). `cliAllowed = getMode() === 'local'`(개인 설정 — admin OR 없음, 기존 규약). `onManageProfiles/onCreateProfile` → `setProfilesModal({open:true, create:false|true})`.
- `chatSel`이 special ''일 때만 기존 레거시 챗 모델 입력(`user-chat-legacy-model`) 유지(`chatFollowModel`).
- 모달 마운트: `<LlmProfilesModal scope="personal" open={profilesModal.open} initialCreate={profilesModal.create} onClose={...} onChanged={setProfiles} />`.
- 배너·토글·초기화(reset_all)·저장 성공/에러 문구는 현행 유지. `handleTest`는 요약 선택 기준: profile → `{provider: p.provider, model: p.model ?? '', profile_id: p.id}` / cli → 기존 CLI 즉시성공 경로.
- 제거: `LlmProviderCard` import, `presetIdFromUserConfig`/`presetFormDefaults`/폼 캐시 로직.

- [ ] **Step 5: UserLlmSettings.test.tsx 갱신**

기존 mock 세트 유지 + `vi.mock('../../api/llmProfiles', ...)` 추가(`listLlmProfiles` → 픽스처 1개). 기존 케이스를 새 UI로 재작성:
- 로드: `llm_profile_id: 1` 응답 → 요약 셀렉터가 `profile:1` 선택 상태.
- 저장(프로필): 드롭다운 `profile:1` 선택 후 저장 → `updateUserLlmSettings` 페이로드 `{ llm_settings: { llm_profile_id: 1, ... } }`.
- 저장(선택 안함): `{ provider: '', llm_profile_id: null }` 포함.
- 저장(CLI): `cli:claude_cli` + 모델 sonnet → `{ provider: 'claude_cli', model: 'sonnet' }`.
- 챗 'server' / ''(요약과 동일 + 레거시 모델 입력 노출) 분기.
- '프로필 관리' 클릭 → 모달 열림(`screen.getByRole('dialog')`).

Run: `cd frontend && npx vitest run src/components/settings/UserLlmSettings.test.tsx src/components/settings/LlmSelector.test.tsx`
Expected: 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/components/settings/LlmSelector.tsx frontend/src/components/settings/LlmSelector.test.tsx frontend/src/components/settings/UserLlmSettings.tsx frontend/src/components/settings/UserLlmSettings.test.tsx frontend/src/api/userLlmSettings.ts
git commit -m "feat(llm-profiles): 개인 설정 선택 카드 개편 — 셀렉터+내장 CLI+프로필 참조 저장"
```

---

### Task 10: LlmSettingsPanel 개편 (서버 선택 카드)

**Files:**
- Modify: `frontend/src/components/settings/LlmSettingsPanel.tsx`
- Modify: `frontend/src/api/settings.ts` (`LlmSettings`·`updateLlmSettings` 타입)
- Test: `frontend/src/components/settings/LlmSettingsPanel.test.tsx` (갱신)

**Interfaces:**
- Consumes: Task 4 백엔드(`active_profile_id`/`chat_profile_id`), Task 8 `LlmProfilesModal`, Task 9 `LlmSelector`
- Produces: 서버 설정 화면 — 요약 셀렉터(특수옵션 없음: CLI 또는 서버 풀 프로필 필수 선택), 챗 셀렉터(특수옵션 `''`=요약과 동일), "프로필 관리" → `scope="server"` 모달. `cliAllowed = getMode() === 'local' || isAdmin`(기존 규약 유지).
  - `settings.ts` 타입: `LlmSettings`에 `active_profile_id?: number | null`, `chat_profile_id?: number | null`; `updateLlmSettings` params에 동일 2필드.
  - 저장 페이로드: 요약 profile → `{ active_profile_id }` / 요약 cli → `{ active_preset: presetId, preset_id: presetId, preset_data: { provider: presetId, model }, active_profile_id: null }` (CLI는 provider==preset_id — 기존 yaml 스키마 그대로) / 챗 profile → `{ chat_profile_id }` / 챗 cli → `{ chat: { preset_id, provider: preset_id, model }, chat_profile_id: null }` / 챗 '' → `{ chat: { provider: '' }, chat_model: <레거시 입력|''>, chat_profile_id: null }`.
  - 응답→선택 매핑(코드로 고정):
```ts
const toSummarySel = (s: LlmSettings): LlmSelectorValue => {
  if (s.active_profile_id) return { type: 'profile', profileId: s.active_profile_id }
  if (s.active_preset && CLI_PRESET_IDS.has(s.active_preset))
    return { type: 'cli', presetId: s.active_preset, model: s.presets?.[s.active_preset]?.model ?? 'sonnet' }
  // 레거시 API 프리셋인데 프로필 미참조(이관 전·yaml 수동 편집 등) — 안전 폴백
  return { type: 'cli', presetId: 'claude_cli', model: 'sonnet' }
}
const toChatSel = (s: LlmSettings): LlmSelectorValue => {
  if (s.chat_profile_id) return { type: 'profile', profileId: s.chat_profile_id }
  if (s.chat?.preset_id && CLI_PRESET_IDS.has(s.chat.preset_id))
    return { type: 'cli', presetId: s.chat.preset_id, model: s.chat.model ?? 'sonnet' }
  return { type: 'special', id: '' }
}
```
  - `testLlmConnection` params에 `profile_id?: number` 추가(서버 풀 토큰 폴백 — Task 4 백엔드).
  - max_input/output_tokens 필드는 이 패널에서 제거(서버 프로필 폼으로 이동 완료 — Task 8).

- [ ] **Step 1: 테스트 갱신(실패 먼저)** — 기존 `LlmSettingsPanel.test.tsx`를 새 UI 기준으로 재작성:
  - mock: `getLlmSettings`/`updateLlmSettings`/`testLlmConnection`(기존) + `listLlmProfiles`(server 픽스처) + `LlmProfilesModal` 경유 mock들(Task 8 테스트와 동일 세트).
  - 케이스: ①로드 — `active_profile_id: 5` 응답 → 요약 셀렉터 `profile:5`. ②저장(프로필) → `updateLlmSettings({ active_profile_id: 5, ... })`. ③저장(CLI claude_cli/sonnet) → `{ active_preset: 'claude_cli', preset_id: 'claude_cli', preset_data: { provider: 'claude_cli', model: 'sonnet' }, active_profile_id: null }`. ④챗 '요약과 동일' → `{ chat: { provider: '' } }` 포함. ⑤비admin+server 모드(getMode='server') → 시스템 CLI 그룹 숨김, admin이면 노출. ⑥'프로필 관리' → dialog + `listLlmProfiles`가 `'server'`로 호출. ⑦레거시 폴백 — `active_profile_id` 없음+`active_preset: 'anthropic'`(API, 프로필 미참조) 응답 → 요약 셀렉터가 `cli:claude_cli`/sonnet 폴백 표시(크래시·빈 화면 금지). 셀렉터 접근성 라벨은 `${title} 프로필`/`${title} CLI 모델` 형식(요약·챗 카드 동시 마운트 충돌 방지).

Run: `cd frontend && npx vitest run src/components/settings/LlmSettingsPanel.test.tsx` → FAIL 확인

- [ ] **Step 2: settings.ts 타입 + 패널 구현**

`LlmSettings`/`updateLlmSettings`에 `active_profile_id?: number | null`, `chat_profile_id?: number | null` 추가. 패널은 Task 9의 UserLlmSettings와 동일 패턴(상태 = `summarySel`/`chatSel`/`chatFollowModel`/`profiles`/`profilesModal`, 로드 = `getLlmSettings()`+`listLlmProfiles('server')`, `cliAllowed = getMode() === 'local' || isAdmin`). PresetFormState·presetCache·프리셋 그리드·max tokens 필드 제거. `handleLlmTest`: profile → `testLlmConnection({ provider: p.provider, model: p.model ?? '', base_url: p.base_url ?? undefined, profile_id: p.id })`(`testLlmConnection` params에 `profile_id?: number` 추가 — Task 4 백엔드 폴백) / cli → 기존 즉시성공.

- [ ] **Step 3: 테스트 통과 + 타입 게이트**

Run: `cd frontend && npx vitest run src/components/settings/LlmSettingsPanel.test.tsx && npx tsc -p tsconfig.app.json 2>&1 | tail -3`
Expected: PASS, 신규 타입 에러 0

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/components/settings/LlmSettingsPanel.tsx frontend/src/components/settings/LlmSettingsPanel.test.tsx frontend/src/api/settings.ts
git commit -m "feat(llm-profiles): 서버 설정 선택 카드 개편 — active_profile_id·내장 CLI"
```

---

### Task 11: LlmProviderCard 제거 + 전체 게이트

**Files:**
- Delete: `frontend/src/components/settings/LlmProviderCard.tsx`, `frontend/src/components/settings/LlmProviderCard.test.tsx`
- Modify: (grep 결과에 따라 잔존 import 정리)

**Interfaces:**
- Consumes: Task 9·10 완료(사용처 0 전제)
- Produces: 죽은 코드 없는 최종 상태 + 전 스위트 GREEN

- [ ] **Step 1: 사용처 전수 확인 후 삭제** (feedback: 전수 grep + 빌드 검증 필수)

```bash
cd frontend && grep -rn "LlmProviderCard" src --include='*.ts*'
```
Expected: 자기 자신(파일 2개)만. 그 외가 나오면 삭제 전에 해당 사용처를 Task 9/10 방식으로 정리.
```bash
git rm frontend/src/components/settings/LlmProviderCard.tsx frontend/src/components/settings/LlmProviderCard.test.tsx
```

- [ ] **Step 2: 프론트 전체 게이트**

```bash
cd frontend && npx vitest run && npx tsc -p tsconfig.app.json 2>&1 | tail -3 && npm run build
```
Expected: vitest 전체 GREEN / tsc 에러 = 기준선(신규 0) / build 성공 (build는 `tsc -b` 포함이라 기준선 에러로 실패하면 `npx vite build`로 번들만 검증 — 기존 관행)

- [ ] **Step 3: 백엔드 전체 게이트**

```bash
cd backend && bundle exec rspec
```
Expected: 전체 GREEN

- [ ] **Step 4: 수동 검증 체크리스트** (구현자는 실행하지 않고 보고서에 포함 — 사용자 기기 확인용)

- [ ] 설정 › LLM 프로필 관리 팝업: 생성(Gemini 실키)·연결 테스트·편집·삭제
- [ ] 요약 LLM: 프로필 선택→저장→회의록 재생성으로 실동작 / CLI 선택→저장
- [ ] AI 챗: '요약과 동일'/'서버 모델'/프로필 3분기
- [ ] 서버 설정(admin): 서버 풀 프로필 + active 선택 → rails 재시작 후에도 유지(yaml 실체화 확인)
- [ ] 기존 사용자 설정이 프로필로 이관되어 그대로 동작(마이그레이션)
- [ ] API 키 발급 링크가 Tauri=기본 브라우저/웹=새 탭으로 열림

- [ ] **Step 5: 커밋**

```bash
git add -A frontend/src/components/settings
git commit -m "refactor(llm-profiles): LlmProviderCard 제거 — 폼은 프로필 팝업으로 이관 완료"
```

---

## 실행 메모 (오케스트레이터용)

- 태스크별 서브에이전트 model: **sonnet** (메모리 feedback-model-tiering). 능력 부족으로 실패·반복 반려 시 한 단계 위 모델로 승급 재시도(환경 문제는 원인 수정 후 같은 모델).
- 순서: 1→2→3→4→5는 직렬(백엔드 의존 체인). 6·7은 1~5와 병행 가능. 8은 6·7 뒤, 9는 3·8 뒤, 10은 4·8·9 뒤, 11은 마지막.
- dev 서버가 원본 repo에서 돌고 있어도 워크트리 DB/마이그레이션은 무관(별도 체크아웃). 단 **원본 repo에 마이그 파일을 복사하지 말 것**(PendingMigrationError 함정).
- 푸시·머지는 사용자 승인 후(superpowers:finishing-a-development-branch).
