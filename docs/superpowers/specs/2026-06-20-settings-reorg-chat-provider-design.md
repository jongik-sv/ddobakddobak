# 설정 개편 — 전역 AI 챗 독립 프로바이더 + 탭 재구성

- 날짜: 2026-06-20
- 브랜치: `feat/chat-streaming-model` (이어서)
- 상태: 승인됨 (사용자 확정 2026-06-20)

## 배경

전역 "LLM 모델 설정"(`LlmSettingsPanel`)은 요약(회의록 작성)용 서비스 프리셋 하나를 고르고,
AI 챗은 그 프리셋 위에서 **모델명만** override(`chat_model` → ENV `CHAT_LLM_MODEL`)한다.
즉 전역 챗은 요약과 **다른 프로바이더를 쓸 수 없다**.

per-user 설정(`User#chat_llm_*` 컬럼 + `effective_chat_llm_config`)은 이미 챗 provider·키·base_url·모델까지
완전 독립을 지원한다. 이 검증된 백엔드 패턴을 **전역(settings.yaml) 한 단계 위로 미러**한다.

동시에 전역설정 탭이 7개 패널로 비대해 탭을 기능별로 재구성한다.

## 목표

1. **Part A** — 전역 AI 챗이 요약과 독립된 프로바이더(키·base_url·모델 포함)를 쓸 수 있게 한다.
2. **Part B** — 설정 탭을 `개인설정 | LLM | 음성·인식 | 회의록 설정`으로 재구성한다.

비목표: per-user 챗 설정 변경(현행 유지), 요약 프리셋 동작 변경, 모델 추가.

Part A와 Part B는 독립적이다(B는 프론트 전용·표현 변경). 각자 단독으로 빌드·검증·머지 가능.

---

## Part A — 전역 AI 챗 독립 프로바이더

### A1. 저장 (settings.yaml `llm` 하위)

per-user `chat_llm_*` 컬럼을 미러한 **독립 sub-hash**. 공유 프리셋 방식 안 씀.

```yaml
llm:
  active_preset: anthropic     # 요약 (현행)
  presets: { ... }             # 요약 프리셋들 (현행)
  chat:                        # ← 신규: 챗 독립 config (없으면 모델 override만)
    preset_id: ollama          # UI 복원용 — 어느 서비스 카드/드롭다운인지
    provider: openai           # 실제 provider (openai|anthropic)
    auth_token: "..."          # GET 시 마스킹. 빈/CLI면 생략
    base_url: "http://localhost:11434/v1"
    model: "llama-3.1-8b"
  chat_model: "..."            # 레거시 보존: chat 미설정 시 요약 위 모델만 override
```

**공유 프리셋(`chat_active_preset` → presets 맵 재사용)을 쓰지 않는 이유**: 패널은 프리셋을 편집·저장하면
그게 곧 요약 `active_preset`이 된다. 요약=클라우드/챗=로컬 Ollama 같은 핵심 시나리오에서 챗 전용
엔드포인트를 프리셋에 저장하는 순간 요약 프리셋이 오염됨. 독립 저장이 per-user 검증 리졸버와 일치하고 엉킴 없음.

### A2. ENV 동기화 (`SettingsController#sync_active_llm_to_env` 단일 소스)

`update_llm`이 아니라 모든 설정 저장에서 호출되는 `sync_active_llm_to_env`에서 방출(단일 소스):

```ruby
chat = llm["chat"] || {}
if chat["provider"].present?
  ENV["CHAT_LLM_PROVIDER"] = chat["provider"]
  ENV["CHAT_LLM_MODEL"]    = chat["model"].to_s         # chat 모델
  if chat["provider"] == "openai"
    ENV["CHAT_LLM_AUTH_TOKEN"] = chat["auth_token"].to_s
    chat["base_url"].present? ? ENV["CHAT_LLM_BASE_URL"] = chat["base_url"] : ENV.delete("CHAT_LLM_BASE_URL")
  else
    ENV["CHAT_LLM_AUTH_TOKEN"] = chat["auth_token"].to_s
    chat["base_url"].present? ? ENV["CHAT_LLM_BASE_URL"] = chat["base_url"] : ENV.delete("CHAT_LLM_BASE_URL")
  end
else
  ENV.delete("CHAT_LLM_PROVIDER"); ENV.delete("CHAT_LLM_AUTH_TOKEN"); ENV.delete("CHAT_LLM_BASE_URL")
  # 레거시 chat_model(모델만 override)은 현행대로 유지
  llm["chat_model"].present? ? ENV["CHAT_LLM_MODEL"] = llm["chat_model"].to_s : ENV.delete("CHAT_LLM_MODEL")
end
```

`CHAT_LLM_AUTH_TOKEN`은 provider 무관 단일 키(요약 ENV의 ANTHROPIC_AUTH_TOKEN/OPENAI_API_KEY 분기와 달리
챗은 자체 키이므로 단일 키명으로 단순화). 리졸버에서 그대로 auth_token에 매핑.

### A3. 리졸버 — `User#effective_chat_llm_config` 우선순위 (확정)

신규 `User.server_default_chat_llm_config`(클래스 메서드)를 추가하고 `effective_chat_llm_config`를 4티어로:

```
1. 개인 챗 설정(chat_llm_provider present)        → 개인 챗 독립        [현행 최상위, 유지]
2. 개인 요약 설정 있음(llm_configured?)            → 개인 요약 + (chat_llm_model||ENV CHAT_LLM_MODEL) 모델 override
3. 전역 챗 설정(ENV["CHAT_LLM_PROVIDER"] present)  → 전역 챗 독립        [신규 티어]
4. 그 외                                           → 전역 요약 + ENV CHAT_LLM_MODEL 모델 override
```

**확정: 개인 요약 > 전역 챗 (2가 3보다 먼저)** — 요약 리졸버(개인>전역)와 일관. 개인 요약키만 설정하고
챗 미설정 사용자는 본인 요약 프로바이더를 따른다. 관리자 전역 챗은 개인 설정이 전혀 없는 사용자에게만 적용.

```ruby
def effective_chat_llm_config
  return { provider: chat_llm_provider, auth_token: chat_llm_api_key,
           model: chat_llm_model, base_url: chat_llm_base_url }.compact if chat_llm_configured?       # 1

  if llm_configured?                                                                                   # 2
    cfg = effective_llm_config
    chat_model = chat_llm_model.presence || ENV["CHAT_LLM_MODEL"].presence
    return chat_model ? cfg.merge(model: chat_model) : cfg
  end

  return self.class.server_default_chat_llm_config if ENV["CHAT_LLM_PROVIDER"].present?                # 3

  cfg = self.class.server_default_llm_config                                                           # 4
  return cfg if cfg.blank?
  chat_model = ENV["CHAT_LLM_MODEL"].presence
  chat_model ? cfg.merge(model: chat_model) : cfg
end

def self.server_default_chat_llm_config
  {
    provider:   ENV["CHAT_LLM_PROVIDER"],
    auth_token: ENV["CHAT_LLM_AUTH_TOKEN"],
    model:      ENV["CHAT_LLM_MODEL"],
    base_url:   ENV["CHAT_LLM_BASE_URL"]
  }.compact
end
```

> 주의: 현행 코드의 fallback 분기는 `effective_llm_config`(개인이 있으면 개인, 없으면 전역)를 한 번에 처리했다.
> 신규는 개인/전역을 분리해 그 사이에 전역-챗 티어를 끼운다. 개인 요약 유무로 2 vs (3/4)가 갈린다.

### A4. 컨트롤러 (`Api::V1::SettingsController`)

- `update_llm`: `params[:chat]`(provider/auth_token/base_url/model/preset_id) permit·머지 저장.
  - `provider` 빈 문자열("요약과 동일") → `llm["chat"]` 삭제(독립 해제, 레거시 chat_model로 폴백).
  - `auth_token`은 present일 때만 덮어씀(마스킹된 값 재전송 방지, 요약 프리셋과 동일 규칙).
  - 기존 `chat_model`(레거시 모델 override) 파라미터는 chat 미사용 시에만 의미. UI가 chat을 보내면 무시 가능.
- `llm`(GET): `chat` 반환 시 `auth_token` → `auth_token_masked`로 마스킹(`except("auth_token")`).

### A5. API 타입 (`frontend/src/api/settings.ts`)

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
  chat_model?: string | null   // 레거시 보존
  chat?: LlmChatConfig         // 신규
  presets: Record<string, LlmPreset>
  offline?: boolean
}
// updateLlmSettings params에 chat?: { preset_id, provider, auth_token?, base_url, model } 추가
```

### A6. 프론트 챗 섹션 (`LlmSettingsPanel.tsx`)

기존 단일 `AI 챗 모델명` 드롭다운을 **독립 챗 섹션**으로 교체. 요약과 동일한 8개 프리셋 제공:

```
AI 챗 모델 (독립)
─────────────────────────────────
챗 서비스: [요약과 동일 ▾]   ← "요약과 동일" + SERVICE_PRESETS 8개
   · "요약과 동일" 선택: 챗 모델명만(레거시 chat_model). 아래 키/URL 숨김
챗 API 키:   [____]          ← 선택 프리셋 requiresApiKey일 때만
챗 base URL: [____]          ← 선택 프리셋 CLI 아닐 때만 (defaultBaseUrl placeholder)
챗 모델:     [____]          ← 프리셋 suggestedModels 드롭다운 / 직접입력 토글
· 비우면 요약 모델 사용
```

- 챗 상태: `chatPresetId`, `chatAuthToken`, `chatBaseUrl`, `chatModel`. 프리셋 선택 시 provider/defaultBaseUrl/
  suggestedModels[0] 자동 채움(요약 `handlePresetSelect`와 동일 로직).
- 저장: `chatPresetId === ''`(요약과 동일)이면 `chat: { provider: '' }`(독립 해제) + 레거시 `chat_model` 전송.
  아니면 `chat: { preset_id, provider, base_url, model, auth_token? }` 전송.
- 로드: `llm.chat`이 있으면 preset_id로 카드 복원·마스킹 키 placeholder. 없으면 "요약과 동일" + `chat_model`.
- CLI 프리셋(Claude Code/Antigravity/Codex)도 선택 가능하나 키/URL 불필요. **주의: 실시간 챗은 스트리밍
  경로이며 CLI는 6~7초 지연. 패널에 기존 CLI 안내(amber) 재사용 또는 챗 한정 경고 노출.**

### A7. 검증 (Part A)

- rspec `settings_spec`: chat permit/저장, 빈 provider→삭제, GET 마스킹, sync_active_llm_to_env가 CHAT_LLM_* 방출/삭제.
- rspec `user_spec`(또는 model spec): `effective_chat_llm_config` 4티어 전부 — 특히 2 vs 3 경계(개인 요약만 있는 사용자).
- 프론트 `LlmSettingsPanel.test.tsx`: 챗 서비스 선택→키/URL/모델 노출 토글, 저장 payload(chat vs 레거시), 로드 복원.
- **⚠️ CLI 챗 스트리밍 실측**: 챗 프리셋=Claude Code/Antigravity로 실시간 챗 1회 — 키 없이 스트리밍·무크래시
  (최근 `baddee0` UTF-8 바이트경계 크래시 이력) 확인.
- A/B 실측: 요약=anthropic, 챗=ollama(또는 다른 프로바이더)로 챗 응답 + 모델명 헤더 확인.

---

## Part B — 설정 탭 재구성 (프론트 전용)

### B1. 탭 구조 (`SettingsContent.tsx`)

관리자(admin/로컬) 탭을 2→4개로:

```
[ 개인설정 ] [ LLM ] [ 음성·인식 ] [ 회의록 설정 ]
```

- `tab` 상태 타입: `'personal' | 'llm' | 'voice' | 'meeting'`.
- 비관리자: 현행 그대로 탭바 없이 `PersonalSettingsTab`만.
- 오프라인 진입: 현행 그대로 `UserSttSettings` 단독.

### B2. 패널 분배

| 탭 | 패널 | 출처 |
|----|------|------|
| 개인설정 | 실행모드·회의언어·비밀번호·내 LLM·전사위치 | `PersonalSettingsTab` (현행 유지) |
| LLM | LLM 모델 설정(요약+챗 독립) | `LlmSettingsPanel` |
| 음성·인식 | STT 모델 · HuggingFace · 화자분리 · 오디오 청킹 | `SttSettingsPanel`·`HuggingFacePanel`·`DiarizationPanel`·`AudioChunkingPanel` |
| 회의록 설정 | 회의 템플릿 · 회의록 양식 | `MeetingTemplateManager`·`PromptTemplateManager` |

- 신규 컴포넌트 `LlmTab`(또는 `LlmSettingsPanel` 직접), `VoiceSettingsTab`, `MeetingSettingsTab`로 분리.
  기존 `GlobalSettingsTab`는 회의록 설정 탭으로 축소되거나 `MeetingSettingsTab`로 대체.
- 패널 컴포넌트 자체는 이동만, 내부 변경 없음(Part A 제외).

### B3. 검증 (Part B)

- 프론트 `SettingsContent.test.tsx`: 관리자 4탭 렌더·전환, 각 탭에 올바른 패널, 비관리자/오프라인 현행 유지.
- 수동: 관리자 로그인 → 4탭 클릭 전환, 패널 위치 확인.

---

## 리스크 / 주의

- **CLI 챗 + 스트리밍**: 가장 물릴 가능성 큼. CLI는 키 불요·고지연. 스트리밍 무크래시 실측 필수(A7).
- **마스킹 누락**: 챗 auth_token을 GET에서 평문 노출하면 키 유출. 요약 프리셋과 동일 마스킹 적용.
- **ENV 단일 소스**: CHAT_LLM_*를 `update_llm`에만 두면 다른 설정 저장 시 누락. `sync_active_llm_to_env`에서만 방출.
- **리졸버 경계(2 vs 3)**: 개인 요약만 있는 사용자 테스트로 회귀 고정.
- **레거시 chat_model**: 기존 사용자 설정 보존. chat 미설정 시 현행 모델-override 동작 유지.

## 산출물 파일

- 백엔드: `app/controllers/api/v1/settings_controller.rb`, `app/models/user.rb`
- 프론트: `frontend/src/api/settings.ts`, `frontend/src/components/settings/LlmSettingsPanel.tsx`,
  `SettingsContent.tsx`, `GlobalSettingsTab.tsx`(분해), 신규 `VoiceSettingsTab.tsx`·`MeetingSettingsTab.tsx`
- 테스트: `settings_spec.rb`, user model spec, `LlmSettingsPanel.test.tsx`, `SettingsContent.test.tsx`
