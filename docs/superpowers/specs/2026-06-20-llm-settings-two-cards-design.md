# LLM 설정 2카드 통합 (요약 모델 / AI 챗 모델) — 설계

## 목표

전역 설정(`LlmSettingsPanel`)과 개인 설정(`UserLlmSettings`, "내 LLM")의 LLM UI를
**동일한 2카드 구조**로 통일한다.

- **요약 모델 카드** (위) + **AI 챗 모델 카드** (아래)
- 두 카드 모두 동일한 **8서비스 프리셋 카드** 선택 UI (claude_cli·gemini_cli·codex_cli·anthropic·zai[glm-5.2]·openai·ollama·lmstudio·custom)
- 개인 설정도 전역과 동일한 프리셋 카드 UI를 쓴다 (CLI 포함).

## 결정 사항 (사용자 확정)

1. 개인 설정 = 전역과 **동일한 8서비스 프리셋** (CLI 포함).
2. **전역 요약 카드엔 "선택 안함" 미포함** (전역 요약 = 서버 기본 자체라 폴백 없음).
3. `zai` 프리셋(glm-5.2/5.1/5-turbo/5v-turbo/4.7/4.5-air) 유지.

### "선택 안함" 배치

| 카드 | "선택 안함" |
|------|-----------|
| 전역 요약 | ❌ 없음 |
| 전역 챗 | "요약과 동일"(none) — 기존 |
| 개인 요약 | "선택 안함(서버 기본 LLM)" — 기존 none 유지 |
| 개인 챗 | "요약과 동일"(none) — 기존 |

## 아키텍처

### 공유 컴포넌트 `LlmProviderCard`

서비스 프리셋 선택 + 입력 필드 한 단위를 **presentation 컴포넌트**로 추출. 4곳 재사용
(전역요약·전역챗·개인요약·개인챗). 영속(persistence)은 부모 패널이 담당 — 카드는 controlled.

**Props (개략)**
- `title` (예 "요약 모델" / "AI 챗 모델")
- `presets: ServicePreset[]` (공유 SERVICE_PRESETS)
- `noneOption?: { id, label, description }` — 있으면 프리셋 앞에 노출 ("선택 안함" 또는 "요약과 동일")
- `value: { presetId, base_url, model, auth_token, max_input_tokens?, max_output_tokens? }`
- `onChange(partial)`
- `maskedToken?: string` (저장된 키 표시용)
- `showTokenLimits?: boolean` (전역 요약만 true)
- `onTest?`, `testResult?` (연결 테스트 — 카드별)

**카드 내부 책임**: 서비스 그리드 렌더, CLI 안내 배너, base URL(비CLI), API Key(requiresApiKey),
모델 select/직접입력 토글, **로컬 모델 자동 fetch**(ollama/lmstudio — 기존 `fetchOllamaModels`/`fetchLmStudioModels` 재사용), 토큰 제한(showTokenLimits).

### 공유 모듈 `llmServicePresets.ts`

`SERVICE_PRESETS`(현재 `LlmSettingsPanel.tsx` 내부 상수)를 별도 모듈로 추출 →
전역·개인 양쪽 카드가 import. `LOCAL_MODEL_FETCHERS`, `CLI_PRESET_IDS`, `isLocalListable`도 동반 이동.

### 패널별 배선 (영속 모델은 기존 유지)

- **전역 `LlmSettingsPanel`**: 요약 카드 = 기존 active_preset + presetCache + preset_data 저장(서비스별 값 기억 유지). 챗 카드 = 기존 `chat` sub-hash. 한 카드(+섹션)였던 것을 **2개 `LlmProviderCard`로 분리**.
- **개인 `UserLlmSettings`**: 요약 카드 = User `llm_*` 컬럼(provider/api_key/model/base_url), 프리셋→actualProvider+base_url 매핑(zai=anthropic+base, ollama/lmstudio=openai+base). 챗 카드 = `chat_llm_*` 컬럼. 기존 ProviderRadioGroup/단일 챗 섹션을 **2개 `LlmProviderCard`로 교체**. 토글(활성/비활성)·상태배너 유지.

## 백엔드

영속 스키마 변경 없음. 단 개인 설정이 8서비스(특히 CLI: claude_cli/gemini_cli/codex_cli)를
받도록 확인:
- `Api::V1::User::LlmSettingsController` permit/저장이 provider=CLI값·base_url 허용하는지 점검(필요시 허용).
- 개인 테스트 엔드포인트(`testUserLlmConnection`)가 CLI 프로바이더는 연결테스트 skip(전역 `test_llm`의 `CLI_PROVIDERS` 분기와 동일 처리) 하도록 정렬.
- `User#effective_llm_config`/`sidecar_llm_config`는 provider 통과만 하므로 변경 불요(확인).

CLI 개인 설정 의미: 개인이 gemini_cli 선택 시에도 서버의 CLI 인증을 공유(키 불요) — 기존 전역 CLI와 동일 동작.

## 데이터 흐름

프리셋 선택 → 카드가 `{presetId, base_url(기본값), model(첫 제안)}` onChange → 부모 state →
저장 시 부모가 actualProvider/base_url/model/key를 백엔드 형식으로 매핑(전역=preset_data·chat, 개인=llm_*·chat_llm_*).

## 에러 처리

기존 패턴 유지: 저장 실패/테스트 실패 메시지, 로딩/오프라인(sidecar) 상태. 카드별 로컬모델 fetch 실패 = 경고만(직접입력 폴백).

## 테스트

- `llmServicePresets.ts`: 프리셋 목록·매핑 단위 테스트(이동 후 회귀).
- `LlmProviderCard`: 프리셋 선택→필드 갱신, none 옵션 렌더, CLI 배너/키 숨김, 로컬 fetch 버튼(모킹), 토큰제한 표시 토글.
- `LlmSettingsPanel`: 2카드 렌더, 요약/챗 저장 payload 동일 유지(기존 테스트 갱신).
- `UserLlmSettings`: 2카드 렌더, 8프리셋 선택, 선택안함(요약)·요약과동일(챗) 저장, CLI 선택 시 키 숨김+테스트 skip.
- 백엔드 rspec: 개인 LLM이 CLI provider 저장·CLI 테스트 skip 동작(추가/갱신).

## 범위 밖 (YAGNI)

- 클라우드(z.ai) 실시간 모델 목록 fetch (별건, 보류).
- 백엔드 영속 스키마 변경.
- 마커/요약/탭 등 무관 영역.

## 구현 단위 (plan 분해 예정)

1. `llmServicePresets.ts` 추출 + 전역 패널이 import (회귀 0).
2. `LlmProviderCard` 공유 컴포넌트 + 단위 테스트.
3. 전역 `LlmSettingsPanel` 2카드로 재구성(요약/챗 각각 카드).
4. 개인 `UserLlmSettings` 2카드 + 8프리셋 채택(선택안함/요약과동일).
5. 백엔드: 개인 CLI provider 저장·테스트 skip 정렬 + rspec.
6. 통합 검증(vitest 풀 + tsc + 수동 E2E 4영역).
