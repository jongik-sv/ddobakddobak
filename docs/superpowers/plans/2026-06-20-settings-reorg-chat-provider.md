# 설정 개편 — 전역 챗 독립 프로바이더 + 탭 재구성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 전역 AI 챗이 요약과 독립된 프로바이더(키·base_url·모델)를 쓸 수 있게 하고, 설정 탭을 `개인설정 | LLM | 음성·인식 | 회의록 설정`으로 재구성한다.

**Architecture:** per-user `chat_llm_*` 컬럼 + `effective_chat_llm_config` 패턴을 전역(settings.yaml `llm.chat` sub-hash)으로 미러. ENV `CHAT_LLM_*`를 단일 소스(`sync_active_llm_to_env`)에서 방출하고, `User#effective_chat_llm_config`에 전역-챗 티어를 끼운다. 탭 재구성은 프론트 전용.

**Tech Stack:** Rails 7 (RSpec request/model specs), React + TypeScript (Vitest + Testing Library), settings.yaml(YAML) 저장, ENV 동기화.

## Global Constraints

- 브랜치: `feat/chat-streaming-model` (이어서 작업). 새 브랜치 생성 금지.
- 커밋: 사용자 명시 요청 전까지 자동 커밋·푸시 금지(`feedback_no_auto_commit`). 각 Task의 "Commit" 스텝은 **로컬 커밋만**(푸시 금지). 작업자는 커밋해도 무방하나 push 절대 금지.
- 백엔드 테스트: `cd backend && bundle exec rspec <path>`. 프론트: `cd frontend && npx vitest run <path>`.
- DB 마이그레이션 없음(전역 챗은 settings.yaml 저장, per-user 컬럼은 이미 존재).
- 리졸버 우선순위 확정: **1) 개인 챗 → 2) 개인 요약+모델override → 3) 전역 챗 → 4) 전역 요약+모델override**. 개인 요약 > 전역 챗.
- 챗 auth_token은 GET 응답에서 반드시 마스킹(`auth_token_masked`). 평문 노출 금지.
- `CHAT_LLM_*` ENV는 `sync_active_llm_to_env`에서만 방출(단일 소스). `update_llm`에 직접 쓰지 말 것.
- 레거시 `llm.chat_model`(모델만 override) 동작·기존 테스트 보존.
- 패널 컴포넌트 자체 로직은 이동만(Part B). 내부 변경은 Part A의 `LlmSettingsPanel`에 한정.

---

## File Structure

**백엔드 (Part A)**
- Modify `backend/app/models/user.rb` — `effective_chat_llm_config` 4티어 재작성 + `self.server_default_chat_llm_config` 신규.
- Modify `backend/app/controllers/api/v1/settings_controller.rb` — `update_llm` chat permit/persist/clear, `llm` GET chat 마스킹, `sync_active_llm_to_env` CHAT_LLM_* 방출.
- Test `backend/spec/models/user_chat_llm_config_spec.rb` — 티어 3/4 + 2-vs-3 경계 추가.
- Test `backend/spec/requests/api/v1/settings_spec.rb` — chat persist/clear/마스킹/ENV.

**프론트 (Part A)**
- Modify `frontend/src/api/settings.ts` — `LlmChatConfig`, `LlmSettings.chat`, `updateLlmSettings` chat param.
- Modify `frontend/src/components/settings/LlmSettingsPanel.tsx` — 독립 챗 섹션으로 교체.
- Test `frontend/src/components/settings/LlmSettingsPanel.test.tsx` — 챗 섹션 신규 동작으로 교체.

**프론트 (Part B)**
- Modify `frontend/src/components/settings/SettingsContent.tsx` — 4탭.
- Create `frontend/src/components/settings/VoiceSettingsTab.tsx` — STT·HF·화자분리·오디오청킹.
- Create `frontend/src/components/settings/MeetingSettingsTab.tsx` — 회의 템플릿·회의록 양식.
- Modify/삭제 `frontend/src/components/settings/GlobalSettingsTab.tsx` — 더 이상 사용 안 함(SettingsContent가 직접 LlmSettingsPanel/VoiceSettingsTab/MeetingSettingsTab 렌더). 테스트 mock 갱신 위해 파일은 남겨도 되나 import 제거.
- Test `frontend/src/components/settings/SettingsContent.test.tsx` — 4탭으로 교체.

---

## Task 1: 리졸버 — `User#effective_chat_llm_config` 4티어 + `server_default_chat_llm_config`

**Files:**
- Modify: `backend/app/models/user.rb:66-88` (effective_chat_llm_config + 신규 클래스 메서드)
- Test: `backend/spec/models/user_chat_llm_config_spec.rb`

**Interfaces:**
- Produces: `User#effective_chat_llm_config → Hash`(provider/auth_token/model/base_url, compact), `User.server_default_chat_llm_config → Hash`.
- Consumes: 기존 `chat_llm_configured?`, `llm_configured?`, `effective_llm_config`, `self.server_default_llm_config`.

- [ ] **Step 1: 실패 테스트 추가** — `backend/spec/models/user_chat_llm_config_spec.rb`의 `describe "#effective_chat_llm_config"` 안에 신규 context 추가. 기존 예제(티어 1·2)는 그대로 두고 아래를 append:

```ruby
    context "global chat tier (no personal LLM at all)" do
      # 전역 챗 ENV. CHAT_LLM_MODEL 외 키도 보존/복원.
      around do |example|
        keys = %w[CHAT_LLM_PROVIDER CHAT_LLM_AUTH_TOKEN CHAT_LLM_BASE_URL]
        prev = keys.index_with { |k| ENV[k] }
        example.run
        keys.each { |k| prev[k].nil? ? ENV.delete(k) : ENV[k] = prev[k] }
      end

      it "uses server_default_chat_llm_config when ENV[CHAT_LLM_PROVIDER] is set and user has no personal LLM" do
        ENV["CHAT_LLM_PROVIDER"]   = "openai"
        ENV["CHAT_LLM_AUTH_TOKEN"] = "global-chat-key"
        ENV["CHAT_LLM_BASE_URL"]   = "http://localhost:11434/v1"
        ENV["CHAT_LLM_MODEL"]      = "llama-3.1-8b"
        user = build(:user, llm_provider: nil, llm_api_key: nil)

        cfg = user.effective_chat_llm_config
        expect(cfg[:provider]).to eq("openai")
        expect(cfg[:auth_token]).to eq("global-chat-key")
        expect(cfg[:base_url]).to eq("http://localhost:11434/v1")
        expect(cfg[:model]).to eq("llama-3.1-8b")
      end

      it "personal summary wins over global chat tier (tier 2 before tier 3)" do
        ENV["CHAT_LLM_PROVIDER"]   = "openai"
        ENV["CHAT_LLM_AUTH_TOKEN"] = "global-chat-key"
        ENV["CHAT_LLM_MODEL"]      = "llama-3.1-8b"
        user = build(:user,
          llm_provider: "anthropic", llm_api_key: "sk-user", llm_model: "claude-sonnet-4-6", llm_enabled: true,
          chat_llm_model: nil
        )

        cfg = user.effective_chat_llm_config
        # 개인 요약 프로바이더를 따르고, 모델만 ENV override
        expect(cfg[:provider]).to eq("anthropic")
        expect(cfg[:auth_token]).to eq("sk-user")
        expect(cfg[:model]).to eq("llama-3.1-8b")
      end
    end

    describe ".server_default_chat_llm_config" do
      around do |example|
        keys = %w[CHAT_LLM_PROVIDER CHAT_LLM_AUTH_TOKEN CHAT_LLM_BASE_URL CHAT_LLM_MODEL]
        prev = keys.index_with { |k| ENV[k] }
        example.run
        keys.each { |k| prev[k].nil? ? ENV.delete(k) : ENV[k] = prev[k] }
      end

      it "builds a compact config from CHAT_LLM_* ENV" do
        ENV["CHAT_LLM_PROVIDER"]   = "openai"
        ENV["CHAT_LLM_AUTH_TOKEN"] = "k"
        ENV["CHAT_LLM_BASE_URL"]   = "http://x/v1"
        ENV["CHAT_LLM_MODEL"]      = "m"
        cfg = User.server_default_chat_llm_config
        expect(cfg).to eq(provider: "openai", auth_token: "k", base_url: "http://x/v1", model: "m")
      end
    end
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && bundle exec rspec spec/models/user_chat_llm_config_spec.rb`
Expected: 신규 예제 FAIL (`server_default_chat_llm_config` 미정의 / 티어 동작 불일치). 기존 예제는 PASS.

- [ ] **Step 3: 리졸버 재작성** — `backend/app/models/user.rb`의 `effective_chat_llm_config`(66-83행)를 아래로 교체하고, `chat_llm_configured?` 위/근처에 `server_default_chat_llm_config` 클래스 메서드 추가:

```ruby
  # AI Chat용 LLM 설정. 우선순위:
  #   1) 개인 챗 설정(chat_llm_*) → 완전 독립
  #   2) 개인 요약 있음 → 요약 config + (chat_llm_model || ENV["CHAT_LLM_MODEL"]) 모델 override
  #   3) 전역 챗 설정(ENV["CHAT_LLM_PROVIDER"]) → 전역 독립
  #   4) 전역 요약 + ENV["CHAT_LLM_MODEL"] 모델 override
  def effective_chat_llm_config
    if chat_llm_configured?
      return {
        provider: chat_llm_provider,
        auth_token: chat_llm_api_key,
        model: chat_llm_model,
        base_url: chat_llm_base_url
      }.compact
    end

    if llm_configured?
      cfg = effective_llm_config
      chat_model = chat_llm_model.presence || ENV["CHAT_LLM_MODEL"].presence
      return chat_model ? cfg.merge(model: chat_model) : cfg
    end

    return self.class.server_default_chat_llm_config if ENV["CHAT_LLM_PROVIDER"].present?

    cfg = self.class.server_default_llm_config
    return cfg if cfg.blank?
    chat_model = ENV["CHAT_LLM_MODEL"].presence
    chat_model ? cfg.merge(model: chat_model) : cfg
  end

  # 전역(서버 기본) 챗 독립 config. ENV["CHAT_LLM_PROVIDER"] 가 있을 때만 의미.
  def self.server_default_chat_llm_config
    {
      provider:   ENV["CHAT_LLM_PROVIDER"],
      auth_token: ENV["CHAT_LLM_AUTH_TOKEN"],
      model:      ENV["CHAT_LLM_MODEL"],
      base_url:   ENV["CHAT_LLM_BASE_URL"]
    }.compact
  end
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && bundle exec rspec spec/models/user_chat_llm_config_spec.rb spec/models/user_spec.rb`
Expected: 전부 PASS (기존 티어 1·2 예제 + 신규 티어 3·4 + 경계).

- [ ] **Step 5: 커밋 (로컬만, push 금지)**

```bash
cd backend && git add app/models/user.rb spec/models/user_chat_llm_config_spec.rb
git commit -m "feat(chat): effective_chat_llm_config 전역 챗 티어 추가(개인>전역)"
```

---

## Task 2: 컨트롤러 — `update_llm` chat 저장/클리어 + `llm` GET 마스킹

**Files:**
- Modify: `backend/app/controllers/api/v1/settings_controller.rb` (`llm` 79-98행, `update_llm` 100-134행)
- Test: `backend/spec/requests/api/v1/settings_spec.rb`

**Interfaces:**
- Consumes: `params[:chat]`(provider/auth_token/base_url/model/preset_id), `mask_token`(TokenMasking).
- Produces: GET `/settings/llm` JSON에 `chat`(마스킹된) 포함; `llm.chat` sub-hash 저장.

- [ ] **Step 1: 실패 테스트 추가** — `settings_spec.rb`의 `describe "global chat_model"` 아래에 신규 describe 추가:

```ruby
  describe "global chat (independent provider)" do
    before do
      allow_any_instance_of(ApplicationController).to receive(:server_mode?).and_return(true)
      allow_any_instance_of(ApplicationController).to receive(:authenticate_user!).and_return(true)
      login_as(admin)
    end

    around do |example|
      keys = %w[CHAT_LLM_PROVIDER CHAT_LLM_AUTH_TOKEN CHAT_LLM_BASE_URL CHAT_LLM_MODEL]
      prev = keys.index_with { |k| ENV[k] }
      example.run
      keys.each { |k| prev[k].nil? ? ENV.delete(k) : ENV[k] = prev[k] }
    end

    it "persists chat sub-hash under llm.chat" do
      written = nil
      allow(File).to receive(:write)
        .with(Api::V1::SettingsController::SETTINGS_PATH, anything) do |_p, content|
          written = YAML.safe_load(content)
          allow(File).to receive(:read).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(content)
          true
        end

      put "/api/v1/settings/llm", params: {
        chat: { preset_id: "ollama", provider: "openai", auth_token: "chat-key",
                base_url: "http://localhost:11434/v1", model: "llama-3.1-8b" }
      }, as: :json

      expect(response).to have_http_status(:ok)
      chat = written.dig("llm", "chat")
      expect(chat["provider"]).to eq("openai")
      expect(chat["auth_token"]).to eq("chat-key")
      expect(chat["base_url"]).to eq("http://localhost:11434/v1")
      expect(chat["model"]).to eq("llama-3.1-8b")
      expect(chat["preset_id"]).to eq("ollama")
    end

    it "does not overwrite stored auth_token when blank auth_token is sent" do
      allow(File).to receive(:read).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(YAML.dump({
        "llm" => { "active_preset" => "anthropic",
                   "presets" => { "anthropic" => { "provider" => "anthropic", "auth_token" => "sk-test" } },
                   "chat" => { "provider" => "openai", "auth_token" => "existing-key", "model" => "m1" } }
      }))
      written = nil
      allow(File).to receive(:write)
        .with(Api::V1::SettingsController::SETTINGS_PATH, anything) do |_p, content|
          written = YAML.safe_load(content); true
        end

      put "/api/v1/settings/llm", params: {
        chat: { provider: "openai", auth_token: "", model: "m2", base_url: "http://h/v1" }
      }, as: :json

      expect(written.dig("llm", "chat", "auth_token")).to eq("existing-key")
      expect(written.dig("llm", "chat", "model")).to eq("m2")
    end

    it "clears llm.chat when chat.provider is blank" do
      allow(File).to receive(:read).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(YAML.dump({
        "llm" => { "active_preset" => "anthropic",
                   "presets" => { "anthropic" => { "provider" => "anthropic", "auth_token" => "sk-test" } },
                   "chat" => { "provider" => "openai", "auth_token" => "k", "model" => "m" } }
      }))
      written = nil
      allow(File).to receive(:write)
        .with(Api::V1::SettingsController::SETTINGS_PATH, anything) do |_p, content|
          written = YAML.safe_load(content); true
        end

      put "/api/v1/settings/llm", params: { chat: { provider: "" }, chat_model: "fallback-model" }, as: :json

      expect(written.dig("llm", "chat")).to be_nil
      expect(written.dig("llm", "chat_model")).to eq("fallback-model")
    end

    it "GET /settings/llm masks chat.auth_token" do
      allow(File).to receive(:read).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(YAML.dump({
        "llm" => { "active_preset" => "anthropic",
                   "presets" => { "anthropic" => { "provider" => "anthropic", "auth_token" => "sk-test" } },
                   "chat" => { "provider" => "openai", "auth_token" => "sk-chat-secret-1234",
                               "base_url" => "http://h/v1", "model" => "m" } }
      }))

      get "/api/v1/settings/llm"

      expect(response).to have_http_status(:ok)
      chat = response.parsed_body["chat"]
      expect(chat["auth_token_masked"]).to be_present
      expect(chat).not_to have_key("auth_token")
      expect(chat["provider"]).to eq("openai")
      expect(chat["model"]).to eq("m")
    end
  end
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/settings_spec.rb -e "global chat (independent provider)"`
Expected: FAIL (chat permit/저장/마스킹 미구현).

- [ ] **Step 3: 컨트롤러 구현** — `llm`(GET) 액션의 render json에 chat 마스킹 추가, `update_llm`에 chat 분기 추가.

`llm` 액션(79-98행)의 `render json:` 직전에 chat 마스킹 블록 추가하고 render에 chat 포함:

```ruby
      def llm
        cfg = load_settings
        llm_cfg = cfg["llm"] || {}
        active = llm_cfg["active_preset"] || "anthropic"
        presets = llm_cfg["presets"] || {}

        masked_presets = {}
        presets.each do |id, preset|
          masked_presets[id] = preset.merge(
            "auth_token_masked" => mask_token(preset["auth_token"].to_s)
          ).except("auth_token")
        end

        chat = llm_cfg["chat"]
        masked_chat =
          if chat.present?
            chat.merge("auth_token_masked" => mask_token(chat["auth_token"].to_s)).except("auth_token")
          end

        render json: {
          active_preset: active,
          chat_model: llm_cfg["chat_model"],
          chat: masked_chat,
          presets: masked_presets
        }
      end
```

`update_llm`의 chat_model 블록(111-114행) 다음에 chat 분기 추가:

```ruby
        # 전역 AI Chat 독립 설정 (llm.chat sub-hash). provider 빈값이면 독립 해제(삭제).
        if params.key?(:chat)
          chat_params = params[:chat].respond_to?(:to_unsafe_h) ? params[:chat].to_unsafe_h : (params[:chat] || {})
          if chat_params["provider"].to_s.present?
            existing_chat = llm_cfg["chat"] || {}
            existing_chat["preset_id"] = chat_params["preset_id"] if chat_params.key?("preset_id")
            existing_chat["provider"]  = chat_params["provider"]
            existing_chat["base_url"]  = chat_params["base_url"] if chat_params.key?("base_url")
            existing_chat["model"]     = chat_params["model"] if chat_params.key?("model")
            # 마스킹된 값 재전송 방지: present일 때만 키 갱신
            existing_chat["auth_token"] = chat_params["auth_token"] if chat_params["auth_token"].to_s.present?
            llm_cfg["chat"] = existing_chat
          else
            llm_cfg.delete("chat")
          end
        end
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/settings_spec.rb`
Expected: 전부 PASS (기존 + 신규 chat).

- [ ] **Step 5: 커밋 (로컬만)**

```bash
cd backend && git add app/controllers/api/v1/settings_controller.rb spec/requests/api/v1/settings_spec.rb
git commit -m "feat(chat): settings/llm 전역 챗 독립설정 permit/저장/마스킹"
```

---

## Task 3: ENV 동기화 — `sync_active_llm_to_env` CHAT_LLM_* 방출

**Files:**
- Modify: `backend/app/controllers/api/v1/settings_controller.rb` (`sync_active_llm_to_env` 290-338행, chat_model 블록 305-310행 교체)
- Test: `backend/spec/requests/api/v1/settings_spec.rb`

**Interfaces:**
- Produces: ENV `CHAT_LLM_PROVIDER / CHAT_LLM_AUTH_TOKEN / CHAT_LLM_BASE_URL / CHAT_LLM_MODEL` (llm.chat 기준). chat 없으면 provider/key/base_url 삭제, 모델은 레거시 chat_model 따름.
- Consumes: `load_settings`.

- [ ] **Step 1: 실패 테스트 추가** — `settings_spec.rb`의 `describe "global chat (independent provider)"` 안에 ENV 검증 추가:

```ruby
    it "emits CHAT_LLM_* ENV from llm.chat on save" do
      allow(File).to receive(:write)
        .with(Api::V1::SettingsController::SETTINGS_PATH, anything) do |_p, content|
          allow(File).to receive(:read).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(content)
          true
        end

      put "/api/v1/settings/llm", params: {
        chat: { provider: "openai", auth_token: "chat-key",
                base_url: "http://localhost:11434/v1", model: "llama-3.1-8b" }
      }, as: :json

      expect(ENV["CHAT_LLM_PROVIDER"]).to eq("openai")
      expect(ENV["CHAT_LLM_AUTH_TOKEN"]).to eq("chat-key")
      expect(ENV["CHAT_LLM_BASE_URL"]).to eq("http://localhost:11434/v1")
      expect(ENV["CHAT_LLM_MODEL"]).to eq("llama-3.1-8b")
    end

    it "deletes CHAT_LLM_PROVIDER/AUTH/BASE when chat is cleared, keeping legacy chat_model" do
      ENV["CHAT_LLM_PROVIDER"]   = "openai"
      ENV["CHAT_LLM_AUTH_TOKEN"] = "old"
      ENV["CHAT_LLM_BASE_URL"]   = "http://old/v1"
      allow(File).to receive(:read).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(YAML.dump({
        "llm" => { "active_preset" => "anthropic",
                   "presets" => { "anthropic" => { "provider" => "anthropic", "auth_token" => "sk-test" } },
                   "chat" => { "provider" => "openai", "auth_token" => "old", "model" => "m" } }
      }))
      allow(File).to receive(:write)
        .with(Api::V1::SettingsController::SETTINGS_PATH, anything) do |_p, content|
          allow(File).to receive(:read).with(Api::V1::SettingsController::SETTINGS_PATH).and_return(content)
          true
        end

      put "/api/v1/settings/llm", params: { chat: { provider: "" }, chat_model: "legacy-m" }, as: :json

      expect(ENV.key?("CHAT_LLM_PROVIDER")).to be(false)
      expect(ENV.key?("CHAT_LLM_AUTH_TOKEN")).to be(false)
      expect(ENV.key?("CHAT_LLM_BASE_URL")).to be(false)
      expect(ENV["CHAT_LLM_MODEL"]).to eq("legacy-m")
    end
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/settings_spec.rb -e "global chat (independent provider)"`
Expected: 신규 ENV 예제 FAIL (CHAT_LLM_PROVIDER 미방출).

- [ ] **Step 3: sync 구현** — `sync_active_llm_to_env`의 chat_model 블록(305-310행)을 chat-우선 블록으로 교체:

```ruby
        # 전역 AI Chat. llm.chat(독립) 우선, 없으면 레거시 chat_model(모델만 override).
        chat = llm["chat"] || {}
        if chat["provider"].to_s.present?
          ENV["CHAT_LLM_PROVIDER"]   = chat["provider"].to_s
          ENV["CHAT_LLM_AUTH_TOKEN"] = chat["auth_token"].to_s
          ENV["CHAT_LLM_MODEL"]      = chat["model"].to_s
          if chat["base_url"].to_s.present?
            ENV["CHAT_LLM_BASE_URL"] = chat["base_url"].to_s
          else
            ENV.delete("CHAT_LLM_BASE_URL")
          end
        else
          ENV.delete("CHAT_LLM_PROVIDER")
          ENV.delete("CHAT_LLM_AUTH_TOKEN")
          ENV.delete("CHAT_LLM_BASE_URL")
          if llm["chat_model"].present?
            ENV["CHAT_LLM_MODEL"] = llm["chat_model"].to_s
          else
            ENV.delete("CHAT_LLM_MODEL")
          end
        end
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/settings_spec.rb`
Expected: 전부 PASS. (기존 "global chat_model" ENV 예제도 여전히 PASS — chat 없으면 레거시 경로.)

- [ ] **Step 5: 커밋 (로컬만)**

```bash
cd backend && git add app/controllers/api/v1/settings_controller.rb spec/requests/api/v1/settings_spec.rb
git commit -m "feat(chat): sync_active_llm_to_env CHAT_LLM_* 단일소스 방출"
```

---

## Task 4: 프론트 API 타입 + LlmSettingsPanel 독립 챗 섹션

**Files:**
- Modify: `frontend/src/api/settings.ts:46-81` (LlmPreset/LlmSettings/updateLlmSettings)
- Modify: `frontend/src/components/settings/LlmSettingsPanel.tsx` (챗 섹션 344-370행 교체 + 상태/저장/로드)
- Test: `frontend/src/components/settings/LlmSettingsPanel.test.tsx` (챗 describe 교체)

**Interfaces:**
- Consumes (백엔드): GET `/settings/llm` → `{ active_preset, chat_model, chat?: {preset_id, provider, auth_token_masked, base_url, model}, presets }`. PUT body `{ active_preset, preset_id, preset_data, chat_model?, chat?: {preset_id, provider, auth_token?, base_url, model} }`.
- Produces: 갱신된 `LlmSettings`/`updateLlmSettings` 시그니처.

- [ ] **Step 1: API 타입 추가** — `frontend/src/api/settings.ts`에 `LlmChatConfig` 추가, `LlmSettings`·`updateLlmSettings` 확장:

```ts
export interface LlmChatConfig {
  preset_id?: string
  provider?: string
  auth_token_masked?: string
  base_url?: string
  model?: string
}

export interface LlmSettings {
  active_preset: string
  chat_model?: string | null
  chat?: LlmChatConfig | null
  presets: Record<string, LlmPreset>
  offline?: boolean
  sidecar?: Record<string, unknown>
}
```

`updateLlmSettings` params 타입에 chat 추가:

```ts
export async function updateLlmSettings(params: {
  active_preset?: string
  chat_model?: string | null
  chat?: {
    preset_id?: string
    provider?: string
    auth_token?: string
    base_url?: string
    model?: string
  }
  preset_id?: string
  preset_data?: {
    provider?: string
    auth_token?: string
    base_url?: string
    model?: string
    max_input_tokens?: number
    max_output_tokens?: number
  }
}): Promise<LlmSettings> {
  return apiClient.put('settings/llm', { json: params }).json()
}
```

- [ ] **Step 2: 실패 테스트 작성** — `LlmSettingsPanel.test.tsx`의 `describe('LlmSettingsPanel - AI 챗 모델명', ...)` 전체를 아래 신규 describe로 **교체**(구 chat_model 단일 드롭다운 테스트는 제거):

```tsx
describe('LlmSettingsPanel - AI 챗 독립 섹션', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchOllamaModels.mockResolvedValue([])
  })

  it('기본(요약과 동일): 챗 서비스 select 첫 옵션 선택, 키/URL 숨김', async () => {
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('LLM 모델 설정'))

    const chatService = screen.getByLabelText('챗 서비스') as HTMLSelectElement
    expect(chatService.value).toBe('')
    expect(chatService.options[0].textContent).toBe('요약과 동일')
    // 키/URL 필드 미노출
    expect(screen.queryByLabelText('챗 API 키')).toBeNull()
    expect(screen.queryByLabelText('챗 base URL')).toBeNull()
  })

  it('챗 서비스=OpenAI 선택 시 키·base URL·모델 필드 노출', async () => {
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('LLM 모델 설정'))

    fireEvent.change(screen.getByLabelText('챗 서비스'), { target: { value: 'openai' } })
    expect(screen.getByLabelText('챗 API 키')).toBeInTheDocument()
    expect(screen.getByLabelText('챗 base URL')).toBeInTheDocument()
    expect(screen.getByLabelText('챗 모델')).toBeInTheDocument()
  })

  it('저장: 독립 챗 설정이면 chat 객체를 전송', async () => {
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    mockUpdateLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('LLM 모델 설정'))

    fireEvent.change(screen.getByLabelText('챗 서비스'), { target: { value: 'ollama' } })
    fireEvent.change(screen.getByLabelText('챗 base URL'), { target: { value: 'http://localhost:11434/v1' } })
    fireEvent.change(screen.getByLabelText('챗 모델'), { target: { value: 'llama-3.1-8b' } })

    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => {
      expect(mockUpdateLlmSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          chat: expect.objectContaining({
            preset_id: 'ollama',
            provider: 'openai',
            base_url: 'http://localhost:11434/v1',
            model: 'llama-3.1-8b',
          }),
        }),
      )
    })
  })

  it('저장: 요약과 동일이면 chat.provider 빈값 + 레거시 chat_model 전송', async () => {
    mockGetLlmSettings.mockResolvedValue(settingsResponse)
    mockUpdateLlmSettings.mockResolvedValue(settingsResponse)
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('LLM 모델 설정'))

    // 기본은 '요약과 동일'. 챗 모델만 입력
    fireEvent.change(screen.getByLabelText('챗 모델'), { target: { value: 'claude-haiku-4-5' } })
    fireEvent.click(screen.getByText('저장'))
    await waitFor(() => {
      expect(mockUpdateLlmSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          chat: expect.objectContaining({ provider: '' }),
          chat_model: 'claude-haiku-4-5',
        }),
      )
    })
  })

  it('로드: llm.chat 있으면 해당 서비스로 복원하고 마스킹 키 placeholder', async () => {
    mockGetLlmSettings.mockResolvedValue({
      ...settingsResponse,
      chat: { preset_id: 'openai', provider: 'openai', auth_token_masked: 'sk-c****9999',
              base_url: '', model: 'gpt-4o-mini' },
    })
    render(<LlmSettingsPanel />)
    await waitFor(() => screen.getByText('LLM 모델 설정'))

    const chatService = screen.getByLabelText('챗 서비스') as HTMLSelectElement
    await waitFor(() => expect(chatService.value).toBe('openai'))
    const keyInput = screen.getByLabelText('챗 API 키') as HTMLInputElement
    expect(keyInput.placeholder).toContain('sk-c****9999')
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd frontend && npx vitest run src/components/settings/LlmSettingsPanel.test.tsx`
Expected: FAIL (`챗 서비스` 라벨 없음 등).

- [ ] **Step 4: 패널 구현** — `LlmSettingsPanel.tsx` 수정.

(a) 챗 상태 추가(40행 `chatModel` 근처 교체):

```tsx
  const [chatPresetId, setChatPresetId] = useState('')      // '' = 요약과 동일
  const [chatAuthToken, setChatAuthToken] = useState('')
  const [chatBaseUrl, setChatBaseUrl] = useState('')
  const [chatModel, setChatModel] = useState('')
  const [chatMaskedToken, setChatMaskedToken] = useState('')
```

(b) 로드(useEffect 42-60행) 안 `setChatModel` 부분을 chat 복원으로 교체:

```tsx
      const chat = llm.chat
      if (chat && chat.provider) {
        setChatPresetId(chat.preset_id || '')
        setChatBaseUrl(chat.base_url || '')
        setChatModel(chat.model || '')
        setChatMaskedToken(chat.auth_token_masked || '')
      } else {
        setChatPresetId('')
        setChatModel(llm.chat_model || '')
        setChatMaskedToken('')
      }
      setChatAuthToken('')
```

(c) 챗 프리셋 파생값(currentPreset 근처 118행 이후 추가):

```tsx
  const chatPreset = SERVICE_PRESETS.find((p) => p.id === chatPresetId)
  const chatActualProvider = chatPreset?.provider ?? ''
  const chatIsCli = chatPresetId !== '' && CLI_PRESET_IDS.has(chatPresetId)
  const chatRequiresKey = chatPreset?.requiresApiKey ?? false
  const chatModelSuggestions = chatPreset?.suggestedModels ?? []

  const handleChatServiceSelect = (id: string) => {
    setChatPresetId(id)
    const def = SERVICE_PRESETS.find((p) => p.id === id)
    setChatBaseUrl(def?.defaultBaseUrl ?? '')
    setChatModel(def?.suggestedModels[0] ?? '')
    setChatAuthToken('')
    setChatMaskedToken('')
  }
```

(d) 저장 핸들러(`handleLlmSave` 150-181행)의 `updateLlmSettings` 호출을 chat 분기로 교체:

```tsx
      const chatPayload =
        chatPresetId === ''
          ? { provider: '' }
          : {
              preset_id: chatPresetId,
              provider: chatActualProvider,
              base_url: chatBaseUrl,
              model: chatModel,
              ...(chatAuthToken ? { auth_token: chatAuthToken } : {}),
            }

      const result = await updateLlmSettings({
        active_preset: selectedPreset,
        chat_model: chatPresetId === '' ? (chatModel.trim() || '') : '',
        chat: chatPayload,
        preset_id: selectedPreset,
        preset_data: presetData,
      })
      setLlmSettings(result)
      // 저장 응답으로 챗 폼 재초기화
      const rc = result.chat
      if (rc && rc.provider) {
        setChatPresetId(rc.preset_id || '')
        setChatBaseUrl(rc.base_url || '')
        setChatModel(rc.model || '')
        setChatMaskedToken(rc.auth_token_masked || '')
      } else {
        setChatPresetId('')
        setChatModel(result.chat_model || '')
        setChatMaskedToken('')
      }
      setChatAuthToken('')
      updateCurrentForm({ auth_token: '' })
      setLlmSuccess('AI 설정이 저장되었습니다.')
```

(e) 챗 섹션 JSX(344-370행 `{/* AI 챗 모델명 (전역 설정) */}` 블록 전체)를 교체:

```tsx
        {/* AI 챗 모델 (독립 섹션) */}
        <section className="mt-6 border-t border-gray-200 pt-4">
          <h3 className="text-sm font-semibold text-gray-800">AI 챗 모델 (독립)</h3>
          <p className="mb-2 text-xs text-gray-500">
            비우면(요약과 동일) 요약 모델을 사용합니다. 실시간 챗에 CLI(Claude Code·Antigravity·Codex)는 6~7초 지연으로 부적합합니다.
          </p>

          <label htmlFor="chat-service" className="block text-xs text-gray-600 mb-1">챗 서비스</label>
          <select
            id="chat-service"
            value={chatPresetId}
            onChange={(e) => handleChatServiceSelect(e.target.value)}
            className="mb-2 w-full rounded-md border px-3 py-2 text-sm bg-white min-h-[44px]"
          >
            <option value="">요약과 동일</option>
            {SERVICE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {chatPresetId !== '' && chatRequiresKey && (
            <div className="mb-2">
              <label htmlFor="chat-key" className="block text-xs text-gray-600 mb-1">챗 API 키</label>
              <input
                id="chat-key"
                type="password"
                value={chatAuthToken}
                onChange={(e) => setChatAuthToken(e.target.value)}
                placeholder={chatMaskedToken || '토큰을 입력하세요'}
                className="w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[44px]"
              />
              {chatMaskedToken && !chatAuthToken && (
                <p className="text-xs text-muted-foreground mt-1">현재: {chatMaskedToken}</p>
              )}
            </div>
          )}

          {chatPresetId !== '' && !chatIsCli && (
            <div className="mb-2">
              <label htmlFor="chat-base" className="block text-xs text-gray-600 mb-1">챗 base URL</label>
              <input
                id="chat-base"
                type="text"
                value={chatBaseUrl}
                onChange={(e) => setChatBaseUrl(e.target.value)}
                placeholder={chatPreset?.defaultBaseUrl || 'https://api.anthropic.com'}
                className="w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[44px]"
              />
            </div>
          )}

          <label htmlFor="chat-model" className="block text-xs text-gray-600 mb-1">챗 모델</label>
          {chatModelSuggestions.length > 0 ? (
            <select
              id="chat-model"
              value={chatModel}
              onChange={(e) => setChatModel(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm bg-white font-mono min-h-[44px]"
            >
              {(chatModel && !chatModelSuggestions.includes(chatModel)
                ? [...chatModelSuggestions, chatModel]
                : chatModelSuggestions
              ).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          ) : (
            <input
              id="chat-model"
              type="text"
              value={chatModel}
              onChange={(e) => setChatModel(e.target.value)}
              placeholder="모델명을 입력하세요 (비우면 요약 모델)"
              className="w-full rounded-md border px-3 py-2 text-sm font-mono min-h-[44px]"
            />
          )}
          <p className="text-xs text-muted-foreground mt-1">비우면 요약 모델을 사용합니다</p>
        </section>
```

(f) 구 `useCustomModel`/`chatModelOptions`/`chatModelSelectOptions` 잔재 중 챗 관련(122-128행)·구 챗 JSX는 (e)에서 제거됨. 요약 모델용 `useCustomModel`은 유지.

- [ ] **Step 5: 테스트 통과 + 빌드 확인**

Run: `cd frontend && npx vitest run src/components/settings/LlmSettingsPanel.test.tsx && npx tsc -b --noEmit`
Expected: 테스트 PASS, 타입 에러 없음.

- [ ] **Step 6: 커밋 (로컬만)**

```bash
cd frontend && git add src/api/settings.ts src/components/settings/LlmSettingsPanel.tsx src/components/settings/LlmSettingsPanel.test.tsx
git commit -m "feat(chat): 전역 LLM 패널 독립 챗 섹션(서비스·키·base_url·모델)"
```

---

## Task 5: 설정 탭 재구성 (개인 | LLM | 음성·인식 | 회의록 설정)

**Files:**
- Create: `frontend/src/components/settings/VoiceSettingsTab.tsx`
- Create: `frontend/src/components/settings/MeetingSettingsTab.tsx`
- Modify: `frontend/src/components/settings/SettingsContent.tsx`
- Test: `frontend/src/components/settings/SettingsContent.test.tsx`

**Interfaces:**
- Produces: `VoiceSettingsTab`(default export) = Stt+HF+Diarization+AudioChunking, `MeetingSettingsTab`(default export) = MeetingTemplate+PromptTemplate.
- Consumes: 기존 패널 컴포넌트들(이동만).

- [ ] **Step 1: VoiceSettingsTab 생성** — `frontend/src/components/settings/VoiceSettingsTab.tsx`:

```tsx
import { SttSettingsPanel } from './SttSettingsPanel'
import { AudioChunkingPanel } from './AudioChunkingPanel'
import { HuggingFacePanel } from './HuggingFacePanel'
import { DiarizationPanel } from './DiarizationPanel'

/** 음성·인식 탭: STT 모델 · HuggingFace · 화자분리 · 오디오 청킹 */
export default function VoiceSettingsTab() {
  return (
    <div className="max-w-2xl space-y-6">
      <SttSettingsPanel />
      <HuggingFacePanel />
      <DiarizationPanel />
      <AudioChunkingPanel />
    </div>
  )
}
```

- [ ] **Step 2: MeetingSettingsTab 생성** — `frontend/src/components/settings/MeetingSettingsTab.tsx`:

```tsx
import PromptTemplateManager from '../PromptTemplateManager'
import MeetingTemplateManager from './MeetingTemplateManager'

/** 회의록 설정 탭: 회의 템플릿 · 회의록 양식 */
export default function MeetingSettingsTab() {
  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-lg border bg-card p-6">
        <h2 className="text-lg font-semibold mb-1">회의 템플릿</h2>
        <p className="text-sm text-muted-foreground mb-4">
          반복 회의(스탠드업, 주간회의 등) 설정을 템플릿으로 저장하고 재사용합니다.
        </p>
        <MeetingTemplateManager />
      </div>
      <PromptTemplateManager />
    </div>
  )
}
```

- [ ] **Step 3: 실패 테스트 작성** — `SettingsContent.test.tsx`를 4탭 구조로 교체. 기존 `GlobalSettingsTab` mock을 신규 탭 mock으로 바꾸고 LlmSettingsPanel도 mock:

기존 mock 블록(22-30행)을 교체:

```tsx
vi.mock('./PersonalSettingsTab', () => ({
  default: () => <div data-testid="personal-tab">personal</div>,
}))
vi.mock('./LlmSettingsPanel', () => ({
  LlmSettingsPanel: () => <div data-testid="llm-tab">llm</div>,
}))
vi.mock('./VoiceSettingsTab', () => ({
  default: () => <div data-testid="voice-tab">voice</div>,
}))
vi.mock('./MeetingSettingsTab', () => ({
  default: () => <div data-testid="meeting-tab">meeting</div>,
}))
vi.mock('./UserSttSettings', () => ({
  default: () => <div data-testid="stt-settings">stt</div>,
}))
```

기존 admin/member/local/offline describe를 아래로 교체:

```tsx
describe('SettingsContent tabs', () => {
  beforeEach(() => {
    mockUser = { role: 'member', email: 'm@x.com' }
    mockMode = 'server'
  })

  it('member: 관리자 탭 없음, 개인 탭만 렌더', () => {
    render(<SettingsContent />)
    expect(screen.queryByRole('tab', { name: /LLM/ })).toBeNull()
    expect(screen.getByTestId('personal-tab')).toBeInTheDocument()
  })

  it('admin: 4개 탭(개인설정·LLM·음성·인식·회의록 설정) 존재', () => {
    mockUser = { role: 'admin', email: 'a@x.com' }
    render(<SettingsContent />)
    expect(screen.getByRole('tab', { name: /개인설정/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /LLM/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /음성.*인식/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /회의록 설정/ })).toBeInTheDocument()
  })

  it('admin: LLM 탭 클릭 시 LlmSettingsPanel 렌더', () => {
    mockUser = { role: 'admin', email: 'a@x.com' }
    render(<SettingsContent />)
    fireEvent.click(screen.getByRole('tab', { name: /LLM/ }))
    expect(screen.getByTestId('llm-tab')).toBeInTheDocument()
  })

  it('admin: 음성·인식 탭 클릭 시 VoiceSettingsTab 렌더', () => {
    mockUser = { role: 'admin', email: 'a@x.com' }
    render(<SettingsContent />)
    fireEvent.click(screen.getByRole('tab', { name: /음성.*인식/ }))
    expect(screen.getByTestId('voice-tab')).toBeInTheDocument()
  })

  it('admin: 회의록 설정 탭 클릭 시 MeetingSettingsTab 렌더', () => {
    mockUser = { role: 'admin', email: 'a@x.com' }
    render(<SettingsContent />)
    fireEvent.click(screen.getByRole('tab', { name: /회의록 설정/ }))
    expect(screen.getByTestId('meeting-tab')).toBeInTheDocument()
  })

  it('local mode: 비-admin도 관리자 탭 노출', () => {
    mockMode = 'local'
    render(<SettingsContent />)
    expect(screen.getByRole('tab', { name: /LLM/ })).toBeInTheDocument()
  })
})

describe('SettingsContent offline (클라전용)', () => {
  beforeEach(() => {
    mockUser = { role: 'admin', email: 'a@x.com' }
    mockMode = 'local'
  })

  it('offline=true: UserSttSettings만 렌더, 탭/서버패널 미렌더', () => {
    render(<SettingsContent offline />)
    expect(screen.getByTestId('stt-settings')).toBeInTheDocument()
    expect(screen.queryByTestId('personal-tab')).toBeNull()
    expect(screen.queryByTestId('llm-tab')).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
  })
})
```

`fireEvent` import 추가(2행): `import { render, screen, fireEvent } from '@testing-library/react'`

- [ ] **Step 4: 테스트 실패 확인**

Run: `cd frontend && npx vitest run src/components/settings/SettingsContent.test.tsx`
Expected: FAIL (LLM/음성 탭 미존재).

- [ ] **Step 5: SettingsContent 구현** — `SettingsContent.tsx` 수정.

import 교체(4-6행):

```tsx
import PersonalSettingsTab from './PersonalSettingsTab'
import { LlmSettingsPanel } from './LlmSettingsPanel'
import VoiceSettingsTab from './VoiceSettingsTab'
import MeetingSettingsTab from './MeetingSettingsTab'
import UserSttSettings from './UserSttSettings'
```

tab 상태 타입(25행) 교체:

```tsx
  const [tab, setTab] = useState<'personal' | 'llm' | 'voice' | 'meeting'>('personal')
```

탭바·본문(48-83행) 교체:

```tsx
  const TABS = [
    { id: 'personal', label: '개인설정' },
    { id: 'llm', label: 'LLM' },
    { id: 'voice', label: '음성·인식' },
    { id: 'meeting', label: '회의록 설정' },
  ] as const

  return (
    <div className="space-y-6">
      <div role="tablist" className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'personal' && <PersonalSettingsTab showPasswordSection={showPasswordSection} />}
      {tab === 'llm' && <div className="max-w-2xl"><LlmSettingsPanel /></div>}
      {tab === 'voice' && <VoiceSettingsTab />}
      {tab === 'meeting' && <MeetingSettingsTab />}
    </div>
  )
```

(주: 비관리자·offline 분기 44-46행, 29-41행은 그대로 유지. `GlobalSettingsTab` import 제거됨.)

- [ ] **Step 6: 테스트 통과 + 빌드 확인**

Run: `cd frontend && npx vitest run src/components/settings/SettingsContent.test.tsx && npx tsc -b --noEmit`
Expected: PASS, 타입 에러 없음.

- [ ] **Step 7: 커밋 (로컬만)**

```bash
cd frontend && git add src/components/settings/SettingsContent.tsx src/components/settings/SettingsContent.test.tsx src/components/settings/VoiceSettingsTab.tsx src/components/settings/MeetingSettingsTab.tsx
git commit -m "feat(settings): 설정 4탭 재구성(개인·LLM·음성인식·회의록)"
```

---

## Task 6: 통합 검증 (전체 스위트 + 빌드)

**Files:** 없음(검증만).

- [ ] **Step 1: 백엔드 전체 rspec**

Run: `cd backend && bundle exec rspec`
Expected: 회귀 0(green). 실패 시 해당 Task로 복귀.

- [ ] **Step 2: 프론트 전체 vitest + 빌드**

Run: `cd frontend && npx vitest run && npm run build`
Expected: 전부 PASS, 빌드 성공.

- [ ] **Step 3: 수동 E2E 체크리스트(기기/사용자)** — 코드 아님, 사용자 확인용:
  - 관리자 로그인 → 설정 4탭 전환, 패널 위치(개인/LLM/음성·인식/회의록) 확인.
  - LLM 탭: 챗 서비스=요약과 동일 → 챗 모델만. 챗 서비스=OpenAI/Ollama → 키·base URL·모델 노출·저장·재로드 복원.
  - ⚠️ 챗 서비스=Claude Code/Antigravity(CLI) 선택 후 실시간 챗 1회 — 키 없이 스트리밍, 한글 무절단·무크래시(최근 `baddee0` 바이트경계 이력).
  - A/B: 요약=anthropic, 챗=다른 프로바이더 → 챗 응답 + 모델명 헤더가 챗 모델로 표시되는지.
  - 개인 요약키만 설정한 비관리자 → 챗이 전역 챗이 아닌 본인 요약 프로바이더를 따르는지(우선순위 2>3).

---

## Self-Review (작성자 점검 결과)

- **Spec coverage:** A1 저장→Task2/3, A2 ENV→Task3, A3 리졸버→Task1, A4 컨트롤러→Task2, A5 타입→Task4, A6 패널→Task4, A7 검증→Task6. B1 탭→Task5, B2 분배→Task5, B3 검증→Task6. 전부 매핑됨.
- **Placeholder scan:** 모든 코드 스텝에 실제 코드 포함. "적절히 처리" 류 없음.
- **Type consistency:** `LlmChatConfig`(preset_id/provider/auth_token_masked/base_url/model) — 백엔드 GET 응답(Task2)·프론트 타입(Task4)·패널 로드(Task4) 일치. ENV 키명 `CHAT_LLM_PROVIDER/AUTH_TOKEN/BASE_URL/MODEL` — Task1 리졸버·Task3 sync 일치. PUT chat payload(preset_id/provider/auth_token/base_url/model) — 패널 저장(Task4)·컨트롤러 permit(Task2) 일치.
- **경계:** 리졸버 2-vs-3(개인 요약>전역 챗) Task1 테스트로 고정. 레거시 chat_model 동작 기존 테스트 보존.
