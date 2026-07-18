# LLM 설정 프리셋 개선 (idea.md #28) — 설계

날짜: 2026-07-18 · 브랜치: `feat/llm-preset-profiles` · 목업: claude.ai/code/artifact/939a80c3 (v2 분리안)

## 요구사항 → 설계 매핑

| idea.md #28 | 설계 |
|---|---|
| 프리셋이 입력값 항목만 제공 | 프리셋에 API 키 발급 링크·안내 추가, 프로필로 값 보관 |
| Google Gemini(API 전용) 없음 | Gemini 프리셋 신설 (OpenAI 호환 엔드포인트) |
| API 발급 링크 | `ServicePreset.apiKeyUrl` + 폼에 "API 키 발급 ↗" 외부 링크 |
| 저장 시 새로운 서버/개인 설정값 저장 | `llm_profiles` 테이블 + 프로필 관리/선택 분리 UI |

## 확정된 결정 (사용자 승인)

1. **프로필 목록 + 전환** 방식 (프리셋별 마지막 값 기억 아님).
2. **스코프별 공유 풀**: 서버 풀 1개(admin 전용) + 개인 풀 1개(유저별). 개인 풀은 요약 LLM·AI 챗 카드가 공유.
3. **저장소 = 새 `llm_profiles` 테이블** (localStorage·JSON 컬럼 기각).
4. **UI 팝업안(v3)**: 설정 탭엔 선택 카드만(요약·AI 챗). 프로필 생성·편집·삭제는 "프로필 관리" 버튼 → **모달 팝업** 전담.
5. **연결 = 참조(FK)**: 프로필 편집이 사용처에 즉시 반영.
6. **풀 완전 분리**: 서버 풀(admin)과 개인 풀은 서로 안 보임·교차 참조 불가.
7. **CLI = 내장 항목**: Claude Code·Antigravity·Codex는 프로필 생성 없이 드롭다운 "시스템 CLI" 그룹으로 상시 제공(로컬 모드/admin 게이트 종전대로). 프로필은 API·로컬서버 연결값 전용.

## 아키텍처

### 데이터 모델

```
llm_profiles
├ id
├ user_id          NULL = 서버 풀(admin 전용), 값 있으면 개인 풀
├ name             예: "Gemini · 무료키" (자동 생성, 수정 가능; (user_id, name) 유니크)
├ preset_id        'gemini' | 'anthropic' | 'openai' | 'zai' | 'ollama' | ... (명시 저장 — URL 역매핑 불필요. CLI 프리셋은 프로필 불가)
├ provider         'anthropic' | 'openai'  (CLI는 프로필이 아니라 내장 항목 — 아래 참조)
├ base_url / model
├ auth_token       원문은 서버만 보관. API 응답은 항상 마스킹(TokenMasking)
├ max_input_tokens / max_output_tokens   (서버 풀 프로필만 UI 노출)
└ timestamps
```

선택(참조) 저장:
- **개인**: `users.llm_profile_id`, `users.chat_llm_profile_id` (nullable FK, `on_delete: :nullify`).
  기존 센티넬 유지 — 요약: NULL=선택 안함(서버 기본) / 챗: NULL=요약과 동일, `chat_llm_provider='server'` 센티넬=서버 모델(현행 그대로).
- **CLI 선택(내장)**: 프로필 행 없음. 기존 `users.llm_provider`+`llm_model`(·`chat_llm_*`) 컬럼 경로 그대로 사용 — CLI는 현재도 이 경로로 동작. CLI 선택 시 카드에 모델 셀렉터만 노출.
  해석 순서: `llm_profile_id` 있음 → 프로필 / 없고 `llm_provider`가 CLI → CLI 설정 / 둘 다 없음 → 센티넬 의미.
- **서버**: `settings.yaml`의 `llm.active_profile_id`(요약)·`llm.chat_profile_id`(전역 챗). CLI 활성은 기존 `presets` 실체화 경로 유지.

### 참조 해석 경로

- **개인**: `User#effective_llm_config` / `#effective_chat_llm_config`가 FK 프로필 값을 반환.
  기존 `users.llm_*`·`chat_llm_*` 컬럼은 읽기 경로에서 제거(권위 = 프로필). 컬럼 자체는 유지(제거는 후속 리팩토링 — SQLite 테이블 재생성 함정 회피).
- **서버(부팅 함정 대응)**: 부팅 시 `load_env.rb`는 DB를 못 읽으므로, 서버-활성 프로필 값은 저장 시점에 settings.yaml에 **실체화(materialize)** 해 캐시한다.
  - `update_llm`(활성 선택 변경) 또는 서버 풀 프로필 편집 시: 해당 프로필이 active면 yaml의 실체화 값 재기록 + `sync_active_llm_to_env`.
  - 부팅은 지금처럼 yaml만 읽음 → `load_env.rb` 무수정 또는 최소 수정.
  - 참조 의미론은 유지(프로필 편집 → active면 즉시 yaml 재실체화 → ENV 반영).

### API

- `GET/POST/PATCH/DELETE /api/v1/llm_profiles` — `?scope=personal|server`.
  개인=본인 것만, 서버 풀=`require_admin`. 응답 auth_token은 `auth_token_masked`만.
  PATCH에서 auth_token blank = 기존 키 유지(현행 패턴 동일).
- 연결 테스트: 기존 `test_llm` 재사용 + `profile_id` 토큰 폴백 추가.
- 선택 저장: 기존 user settings 엔드포인트에 `llm_profile_id`/`chat_llm_profile_id` 추가, 서버는 `update_llm`에 `active_profile_id`/`chat_profile_id` 추가.

### 프리셋 데이터 (`llmServicePresets.ts`)

- `ServicePreset`에 `apiKeyUrl?: string` 추가:
  Anthropic Console / OpenAI Platform / Google AI Studio / Z.AI (정확 URL은 구현 시 웹 검증).
- **Gemini 프리셋 신설**: `id:'gemini'`, `provider:'openai'`, `defaultBaseUrl:'https://generativelanguage.googleapis.com/v1beta/openai'`, `requiresApiKey:true`. 백엔드 추론 경로 무수정, 클라우드 모델 목록(`isCloudListable`) 그대로 동작. 추천 모델은 구현 시 웹 검증(키 입력 후 실목록 조회가 실소스).
- `presetIdFromUserConfig` 역매핑은 레거시 이관 마이그레이션에서만 사용(프로필은 preset_id 명시 저장). gemini URL 매핑 1줄 추가.

### UI (프론트)

- **프로필 관리 모달**(신설, 개인·서버 각각 자기 풀만): 선택 카드 헤더의 "프로필 관리" 버튼으로 열림. 목록(이름·프리셋 태그·모델·마스킹키·편집/삭제) + "＋새 프로필" → 폼 펼침. 폼 = 기존 LlmProviderCard의 프리셋 그리드/URL/키/모델 UI 이동 + 발급 링크 + 이름 + 연결 테스트. 프리셋 그리드는 API·로컬서버 프리셋만(CLI 3종 제외). 기존 모달 패턴(UserManagementModal 류) 재사용.
- **요약 LLM 카드**: 특수옵션(선택 안함) + 드롭다운(그룹: 시스템 CLI 내장 + 내 프로필). 입력 폼 제거. CLI 선택 시 모델 셀렉터 노출.
- **AI 챗 카드**: 특수옵션(요약과 동일·서버 모델) + 동일 드롭다운.
- 드롭다운 마지막 항목 "＋새 프로필 만들기…" → 프로필 관리 모달이 생성 폼 상태로 열림.
- 시스템 CLI 그룹 노출 게이트 = 기존 CLI 게이트(getMode()==='local' || admin) 그대로.
- 외부 링크는 Tauri에서 기본 브라우저로 열리는 기존 패턴 확인 후 적용.

### 레거시 이관 (마이그레이션 + 시드)

- 기존 `users.llm_*` 설정 보유 유저(API 프로바이더만) → 개인 프로필 1개 자동 생성(+FK 세팅). `chat_llm_*` 독립 설정 유저 동일. 이름 자동("Anthropic · claude-sonnet-5" 식), preset_id는 `presetIdFromUserConfig` 로직으로 복원. **CLI 사용 유저는 이관 제외**(컬럼 경로 그대로 유효).
- `settings.yaml llm.presets` 저장값 중 API 프리셋 → 서버 풀 프로필로 이관. `active_preset`이 API면 `active_profile_id` 세팅, CLI면 현행 유지. yaml 실체화 값 유지.
- 이관은 재실행 안전(idempotent)하게.

### 보안

- 토큰 원문은 응답에 절대 미포함(TokenMasking 재사용). 목록·편집 폼 = 마스킹 표시.
- 서버 풀 CRUD·선택 = admin 전용. 개인 프로필 = 소유자만(IDOR 가드, 타 유저 profile_id 참조 시도 403/404).
- 개인 카드에서 서버 풀 프로필 참조 불가(스코프 분리).

### 테스트

- 프론트: presets 유닛(gemini·apiKeyUrl·CLI 제외 목록), 프로필 관리 모달(목록/생성/편집/삭제/폼 접힘·CLI 프리셋 미노출), 선택 카드(드롭다운 그룹·시스템 CLI 게이트·CLI 모델 셀렉터·센티넬·＋새 프로필 진입).
- 백엔드 rspec: CRUD 권한(비admin 서버풀 403·타인 프로필 차단·교차 스코프 참조 거부), 마스킹, blank 키 유지, FK nullify(삭제 시 선택 해제), 이관 마이그레이션(왕복), yaml 실체화·ENV 동기화, test_llm profile_id 폴백.
- 검증 게이트: `tsc -p tsconfig.app.json` 신규 에러 0 + vite build + vitest + rspec.

### 명시적 비범위

- 활성 추론 파이프라인(LlmService 등) 로직 변경 없음 — 설정 해석부만 프로필 경유로 교체.
- 기존 `users.llm_*` 컬럼 물리 삭제(후속 리팩토링).
- pgvector 등 무관 항목.
