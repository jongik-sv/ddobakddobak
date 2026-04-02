# TSK-03-01: User 모델 LLM 필드 추가 - 설계 문서

> User 모델에 개인 LLM 설정 필드를 추가하고, API 키를 암호화 저장한다.

**작성일:** 2026-04-02
**상태:** Design
**참조:** PRD 3.2 / PRD 4.1 / TRD 3.4

---

## 1. 현재 상태

### 1.1 users 테이블 (schema.rb 기준)

| 컬럼 | 타입 | 비고 |
|------|------|------|
| email | string | unique, not null |
| encrypted_password | string | Devise bcrypt |
| name | string | not null |
| jti | string | JWT revocation (JTIMatcher) |
| refresh_token_jti | string | Refresh Token 식별자 |
| created_at / updated_at | datetime | |

### 1.2 User 모델 (`backend/app/models/user.rb`)

- `Devise::JWT::RevocationStrategies::JTIMatcher` 포함
- `:database_authenticatable`, `:jwt_authenticatable` 모듈
- `has_many :team_memberships`, `has_many :teams`
- `validates :name, presence: true`
- `#generate_refresh_token_jti!`, `#revoke_refresh_token!` 메서드

### 1.3 LLM 설정 현황

현재 LLM 설정은 **서버 전체 공유** 방식:
- `settings.yaml` 파일의 `llm.active_preset` / `llm.presets` 구조
- `SettingsController#llm` / `#update_llm`이 settings.yaml을 읽고 씀
- `load_env.rb` 이니셜라이저가 settings.yaml에서 ENV 변수로 로드
- `SidecarClient#refine_notes`가 Sidecar에 LLM 호출을 위임 (현재 사용자별 키 전달 없음)
- `MeetingSummarizationJob`은 `SidecarClient.new.refine_notes(...)` 호출 시 LLM 설정을 전달하지 않음

---

## 2. 마이그레이션 설계

### 2.1 컬럼 추가 마이그레이션

**파일:** `db/migrate/YYYYMMDDHHMMSS_add_llm_fields_to_users.rb`

```ruby
class AddLlmFieldsToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :llm_provider, :string
    add_column :users, :encrypted_llm_api_key, :text
    add_column :users, :llm_model, :string
    add_column :users, :llm_base_url, :string
  end
end
```

### 2.2 컬럼 상세

| 컬럼 | DB 타입 | Ruby 접근 | 설명 |
|------|---------|-----------|------|
| `llm_provider` | string | `user.llm_provider` | `"anthropic"`, `"openai"` 등 |
| `encrypted_llm_api_key` | text | `user.llm_api_key` (encrypts) | Rails encrypted attributes로 암호화된 값 |
| `llm_model` | string | `user.llm_model` | `"claude-sonnet-4-6"`, `"gpt-4o"` 등 |
| `llm_base_url` | string | `user.llm_base_url` | Ollama 등 커스텀 엔드포인트 URL |

### 2.3 설계 근거

- `encrypted_llm_api_key`를 **text** 타입으로 생성: Rails `encrypts`가 암호화된 ciphertext를 저장하므로 string(255)보다 넉넉한 text가 적합
- `llm_provider`, `llm_model`, `llm_base_url`은 일반 string: 민감하지 않은 데이터이므로 암호화 불필요
- 모든 컬럼은 nullable: LLM 미설정 시 서버 기본값 폴백을 위해 NULL 허용

---

## 3. User 모델 변경사항

### 3.1 encrypted attributes 선언

```ruby
class User < ApplicationRecord
  # 기존 코드 유지 ...

  # ── LLM 설정 ──
  encrypts :llm_api_key
end
```

`encrypts :llm_api_key` 선언 시:
- DB 컬럼 `encrypted_llm_api_key`에 암호화된 값을 저장
- `user.llm_api_key`로 복호화된 평문 접근
- `user.llm_api_key = "sk-xxx"`로 할당하면 저장 시 자동 암호화

### 3.2 Rails encrypted attributes 사전 조건

`encrypts`를 사용하려면 `config/credentials.yml.enc`에 Active Record Encryption 키가 설정되어 있어야 한다.

**확인 필요 사항:**
- `config/credentials.yml.enc`는 이미 존재 (확인됨)
- `config/master.key`도 존재 (확인됨)
- credentials 내에 `active_record_encryption` 키가 설정되어 있는지 확인 필요

**credentials에 암호화 키가 없을 경우 설정 절차:**

```bash
# 암호화 키 3개 생성
bin/rails db:encryption:init

# 출력된 키를 credentials에 추가
EDITOR="vim" bin/rails credentials:edit
```

credentials에 추가할 내용:
```yaml
active_record_encryption:
  primary_key: <generated>
  deterministic_key: <generated>
  key_derivation_salt: <generated>
```

### 3.3 폴백 메서드

LLM 미설정 시 서버 기본값(settings.yaml의 활성 프리셋)으로 폴백하는 메서드를 추가한다.

```ruby
class User < ApplicationRecord
  # ...

  # ── LLM 설정 ──
  encrypts :llm_api_key

  # 사용자에게 개인 LLM 설정이 있는지 여부
  def llm_configured?
    llm_provider.present? && llm_api_key.present?
  end

  # 유효한 LLM 설정 해시 반환 (개인 설정 우선, 없으면 서버 기본값)
  def effective_llm_config
    if llm_configured?
      {
        provider: llm_provider,
        api_key: llm_api_key,
        model: llm_model,
        base_url: llm_base_url
      }.compact
    else
      self.class.server_default_llm_config
    end
  end

  # 서버 기본 LLM 설정 (settings.yaml → ENV)
  def self.server_default_llm_config
    provider = ENV.fetch("LLM_PROVIDER", "anthropic")
    {
      provider: provider,
      api_key: provider == "openai" ? ENV["OPENAI_API_KEY"] : ENV["ANTHROPIC_AUTH_TOKEN"],
      model: ENV["LLM_MODEL"],
      base_url: provider == "openai" ? ENV["OPENAI_BASE_URL"] : ENV["ANTHROPIC_BASE_URL"]
    }.compact
  end
end
```

### 3.4 설계 근거

- `llm_configured?`: provider와 api_key가 모두 있어야 유효한 설정으로 판단. model만 있고 key가 없으면 의미 없음
- `effective_llm_config`: 후속 태스크(TSK-03-02)에서 `SidecarClient`에 전달할 설정 해시를 한 곳에서 결정
- `server_default_llm_config`: 기존 `load_env.rb`가 settings.yaml을 ENV로 로드하는 구조를 그대로 활용. settings.yaml을 직접 파싱하지 않고 이미 로드된 ENV에서 읽음
- `compact`: nil 값 제거로 Sidecar에 불필요한 파라미터 전달 방지

---

## 4. 변경 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `db/migrate/YYYYMMDDHHMMSS_add_llm_fields_to_users.rb` | 신규 - 마이그레이션 |
| `app/models/user.rb` | `encrypts :llm_api_key`, `llm_configured?`, `effective_llm_config`, `server_default_llm_config` 추가 |
| `config/credentials.yml.enc` | (조건부) Active Record Encryption 키 추가 |

---

## 5. 테스트 전략

### 5.1 모델 스펙 (`spec/models/user_llm_spec.rb`)

기존 `spec/models/user_jwt_spec.rb`와 별도 파일로 분리하여 LLM 관련 스펙을 작성한다.

#### 5.1.1 encrypts 동작 검증

```ruby
describe "LLM API key encryption" do
  it "encrypts llm_api_key in the database" do
    user = create(:user, llm_api_key: "sk-test-secret-key")
    # DB에 직접 쿼리하여 암호화된 값 확인
    raw = User.connection.select_value(
      "SELECT encrypted_llm_api_key FROM users WHERE id = #{user.id}"
    )
    expect(raw).not_to eq("sk-test-secret-key")
    expect(raw).to be_present
  end

  it "decrypts llm_api_key when reading" do
    user = create(:user, llm_api_key: "sk-test-secret-key")
    expect(user.reload.llm_api_key).to eq("sk-test-secret-key")
  end

  it "allows nil llm_api_key" do
    user = create(:user, llm_api_key: nil)
    expect(user.llm_api_key).to be_nil
  end
end
```

#### 5.1.2 llm_configured? 검증

```ruby
describe "#llm_configured?" do
  it "returns true when provider and api_key are both present" do
    user = build(:user, llm_provider: "anthropic", llm_api_key: "sk-xxx")
    expect(user.llm_configured?).to be true
  end

  it "returns false when provider is missing" do
    user = build(:user, llm_provider: nil, llm_api_key: "sk-xxx")
    expect(user.llm_configured?).to be false
  end

  it "returns false when api_key is missing" do
    user = build(:user, llm_provider: "anthropic", llm_api_key: nil)
    expect(user.llm_configured?).to be false
  end

  it "returns false when both are missing" do
    user = build(:user)
    expect(user.llm_configured?).to be false
  end
end
```

#### 5.1.3 effective_llm_config 검증

```ruby
describe "#effective_llm_config" do
  context "when user has personal LLM config" do
    it "returns user's config" do
      user = build(:user,
        llm_provider: "openai",
        llm_api_key: "sk-user-key",
        llm_model: "gpt-4o",
        llm_base_url: nil
      )
      config = user.effective_llm_config
      expect(config[:provider]).to eq("openai")
      expect(config[:api_key]).to eq("sk-user-key")
      expect(config[:model]).to eq("gpt-4o")
      expect(config).not_to have_key(:base_url)
    end
  end

  context "when user has no LLM config" do
    it "falls back to server default" do
      user = build(:user, llm_provider: nil, llm_api_key: nil)
      allow(ENV).to receive(:fetch).with("LLM_PROVIDER", "anthropic").and_return("anthropic")
      allow(ENV).to receive(:[]).with("ANTHROPIC_AUTH_TOKEN").and_return("sk-server-key")
      allow(ENV).to receive(:[]).with("LLM_MODEL").and_return("claude-sonnet-4-6")
      allow(ENV).to receive(:[]).with("ANTHROPIC_BASE_URL").and_return(nil)

      config = user.effective_llm_config
      expect(config[:provider]).to eq("anthropic")
      expect(config[:api_key]).to eq("sk-server-key")
    end
  end
end
```

### 5.2 마이그레이션 검증

```ruby
describe "migration" do
  it "adds llm columns to users table" do
    columns = User.column_names
    expect(columns).to include("llm_provider")
    expect(columns).to include("encrypted_llm_api_key")
    expect(columns).to include("llm_model")
    expect(columns).to include("llm_base_url")
  end
end
```

### 5.3 팩토리 업데이트 (`spec/factories/users.rb`)

기존 User 팩토리에 LLM trait를 추가한다.

```ruby
FactoryBot.define do
  factory :user do
    # 기존 속성 ...

    trait :with_llm_config do
      llm_provider { "anthropic" }
      llm_api_key { "sk-ant-test-key-12345" }
      llm_model { "claude-sonnet-4-6" }
    end

    trait :with_openai_config do
      llm_provider { "openai" }
      llm_api_key { "sk-openai-test-key-12345" }
      llm_model { "gpt-4o" }
    end

    trait :with_custom_endpoint do
      llm_provider { "openai" }
      llm_api_key { "ollama" }
      llm_model { "qwen3.5:latest" }
      llm_base_url { "http://localhost:11434/v1" }
    end
  end
end
```

### 5.4 테스트 환경 암호화 키

테스트 환경에서 `encrypts`가 동작하려면 Active Record Encryption 키가 필요하다. 테스트용으로 `config/environments/test.rb`에 인라인 키를 설정하거나, test credentials를 별도 생성한다.

```ruby
# config/environments/test.rb (추가)
config.active_record.encryption.primary_key = "test-primary-key-for-ci"
config.active_record.encryption.deterministic_key = "test-deterministic-key-ci"
config.active_record.encryption.key_derivation_salt = "test-key-derivation-salt"
```

---

## 6. 후속 태스크 연결점

이 태스크(TSK-03-01)에서 추가한 필드와 메서드는 다음 태스크에서 활용된다:

| 후속 태스크 | 활용 내용 |
|------------|----------|
| **TSK-03-02** (사용자별 LLM API) | `effective_llm_config`을 `SidecarClient`에 전달하여 사용자별 LLM 호출 |
| **TSK-03-02** | `GET/PUT /user/llm_settings` API에서 LLM 필드 CRUD |
| **TSK-03-03** (LLM 설정 UI) | 프론트엔드에서 API를 통해 사용자별 LLM 설정 관리 |

---

## 7. 체크리스트

- [ ] `config/credentials.yml.enc`에 `active_record_encryption` 키 존재 여부 확인
  - 없으면 `bin/rails db:encryption:init` 실행 후 credentials에 추가
- [ ] 마이그레이션 작성 및 `bin/rails db:migrate` 실행
- [ ] User 모델에 `encrypts :llm_api_key` 및 폴백 메서드 추가
- [ ] 팩토리에 LLM trait 추가
- [ ] `spec/models/user_llm_spec.rb` 작성
- [ ] 테스트 환경 암호화 키 설정
- [ ] 전체 테스트 통과 확인 (`bundle exec rspec`)
