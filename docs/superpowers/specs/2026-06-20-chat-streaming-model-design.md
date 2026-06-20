# AI 챗 실시간 스트리밍 + 모델명 표시 — 설계

- 날짜: 2026-06-20
- 브랜치: `feat/chat-streaming-model` (off main)
- 범위: 회의/폴더/프로젝트 AI 챗 공통

## 1. 목표

1. **모델명 표시**: 답변하는 LLM의 친절한 모델명을 assistant 버블 헤더에 봇 아바타와 함께 표시.
2. **실시간 스트리밍**: 답변이 완성되기를 기다리지 않고 토큰이 도착하는 대로 출력. 전 provider(anthropic/openai SDK, claude/agy/codex CLI) 균일 지원.

비목표(YAGNI): user 메시지 아바타/이름(현행 우측 파란 버블 유지), provider별 색상 아바타, 마커 실시간 파싱.

## 2. 핵심 결정 (확정)

| 항목 | 결정 |
|------|------|
| 스트리밍 전송 | 기존 ActionCable `ChatChannel` 재사용(새 인프라 0). A안. |
| 마커/후속질문 | **평문 스트림 → 완료 시 1회 포맷**. streaming 동안 raw 텍스트, complete 시 `ChatMarkdown`(인용 마커·배지)+후속질문 스왑. |
| 모델명 저장 | `chat_messages.model_name` 컬럼(답변 시점 모델 영구보존). |
| 모델명 형식 | 친절한 이름(`Claude Sonnet 4`). 신규 `LlmModelName.humanize`. |
| 아바타 | 봇 아이콘 단일 통일. provider 무관. |
| provider 범위 | 전 provider. CLI는 stdout 청크, SDK는 native stream. |

## 3. 데이터 흐름

```
POST create → user_msg + assistant_msg(status:"pending") → Job enqueue → 즉시 응답(현행 불변)

Job(perform):
  ctx = 컨텍스트 빌드(현행)
  config = effective_chat_llm_config
  model_name = LlmModelName.humanize(config[:model])
  full = LlmService.new(llm_config: config).answer_question(sys, user) do |delta|
           buffer << delta
           if 스로틀 경계(150ms 경과 OR 누적 80자):
             answer.update_column(:content, buffer)
             broadcast(answer, status:"streaming", model_name:)
         end
  content, suggestions = split_followups(full)
  answer.update!(content:, suggestions:, model_name:, status:"complete")
ensure:
  broadcast(answer)  # 최종 권위 — status:complete + model_name

프론트 ChatChannel.received:
  type:"chat_message_update" → store.applyUpdate(msg)  # 이미 id로 부분머지
  status:"streaming" → 평문(whitespace-pre-wrap) 렌더
  status:"complete"  → ChatMarkdown 포맷 + 후속질문 + 모델명 헤더
```

**스로틀 규약**: 시간(150ms) OR 누적 글자(80자) 중 먼저 도달 시 flush. 마지막 델타는 무조건 flush(ensure의 최종 broadcast가 보장). streaming 중 DB 쓰기는 `update_column`(검증·콜백·updated_at 건드리지 않는 경량 경로), 완료 시 `update!`.

## 4. 컴포넌트

### 4.1 백엔드

**마이그레이션** `add_model_name_to_chat_messages`
- `add_column :chat_messages, :model_name, :string` (nullable, 기본 nil). 단순 add → `disable_ddl_transaction!` 불필요.

**`app/services/llm_model_name.rb`** (순수 함수)
- `LlmModelName.humanize(model_id) -> String`
- 매핑 규칙:
  - `claude-opus-*` → `Claude Opus N`, `claude-sonnet-*` → `Claude Sonnet N`, `claude-haiku-*` → `Claude Haiku N` (버전 숫자 추출)
  - `gpt-4*`/`gpt-5*` → `GPT-4`/`GPT-5` 계열 prettify
  - 이미 친절한 CLI 표시명(공백/괄호 포함, 예 `Gemini 3.5 Flash (Medium)`)은 그대로
  - 미매핑 → 폴백: 끝의 날짜(`-YYYYMMDD`)·해시 strip, 하이픈→공백, titlecase
  - nil/blank → `"AI"`

**`app/services/llm_service.rb`**
- `answer_question(system, user, &block)` — 블록 주면 스트리밍, 없으면 현행 동기(하위호환).
- `call_llm_raw(system, user, max_tokens:, &block)` — provider 분기에 스트리밍 경로 추가:
  - anthropic: `@client.messages.stream(...) { |ev| block.call(ev.text 델타) }`, 전체 텍스트 반환
  - openai: `@client.chat(parameters: { stream: proc { |chunk| block.call(델타) }, ... })`
  - CLI(claude/agy/codex): `run_cli`에 `&block` 추가 — `Open3.popen3` stdout를 `readpartial(4096)` 루프로 읽어 청크마다 `block.call(chunk)`, 누적 반환. 타임아웃·종료코드 처리 현행 유지.
- 블록 없을 때 기존 경로 100% 보존(요약·안건압축 등 타 호출부 무회귀).

**`app/jobs/concerns/chat_streaming.rb`** (신규 concern — 두 잡 공통화)
- 스트리밍 콜백 + 스로틀 + broadcast 로직 추출.
- `stream_answer(answer, config, system_prompt, user_content)` → full text 반환, 내부에서 throttled broadcast.
- `broadcast_chat(answer, model_name:)` — payload 빌드(현행 필드 + `model_name`).
- `MeetingChatJob`/`FolderChatJob`가 include, 각자 broadcast 채널 토픽만 override(`broadcast_topic(answer)`).

**`MeetingChatJob` / `FolderChatJob`**
- `ChatStreaming` include, ctx 빌드 후 `stream_answer` 호출, split_followups + model_name + complete 저장.
- broadcast payload에 `model_name` 추가.

### 4.2 프론트

**`api/chat.ts`**
- `ChatStatus`에 `'streaming'` 추가.
- `ChatMessage`에 `model_name?: string | null` 추가.

**`stores/chatStore.ts`**
- 변경 없음(`applyUpdate`가 이미 id 부분머지). streaming 부분 content/status 그대로 반영.

**`components/meeting/AiChatPanel.tsx`**
- assistant 메시지 위에 헤더: `<ModelBadge/> {model_name ?? 'AI'}` (봇 아이콘 + 모델명).
- 렌더 분기:
  - `status==='streaming'` → 평문 `whitespace-pre-wrap`(+ 커서/타이핑 표시 선택)
  - `status==='complete' && role==='assistant'` → `ChatMarkdown`(현행)
  - `pending` → 현행 `…답변 작성 중`
- user 버블 현행 유지.

**`ModelBadge`** — 인라인 작은 원형 봇 아이콘(SVG/lucide `Bot`). 별도 파일 불요 시 AiChatPanel 내 인라인.

## 5. 에러 처리

- 스트림 중 예외 → 기존 `rescue`, `status:"error"`, 부분 content 폐기(error_message 표시). ensure broadcast가 error 상태 전달.
- CLI 타임아웃 → 현행 `CLI_TIMEOUT` 전체 한도 유지(스트리밍이어도 동일).
- cable 끊김/유실 → 최종 broadcast(complete)가 권위. 재구독 시 `load()`로 DB 정합 회복.
- model_name 변환 실패 → `"AI"` 폴백(절대 raise 안 함).

## 6. 테스트 (TDD)

**백엔드**
- `spec/services/llm_model_name_spec.rb` — opus/sonnet/haiku/gpt/CLI친절명/미매핑폴백/nil.
- `spec/services/llm_service_spec.rb` — 블록 주면 델타 누적=전체 반환(fake provider stub), 블록 없으면 현행 동기 무회귀.
- `spec/jobs/meeting_chat_job_spec.rb` / `folder_chat_job_spec.rb` — streaming→complete 전이, 스로틀 broadcast(≥1회 streaming + 1회 complete), model_name 저장, error 경로.

**프론트**
- `AiChatPanel.test.tsx` — streaming시 평문 렌더(ChatMarkdown 미사용), complete시 포맷 스왑, assistant 헤더에 model_name 표시, model_name 없으면 'AI'.

## 7. 하위호환·무회귀

- `answer_question` 블록 없는 호출(요약·안건압축·test_connection 등) 전부 현행 동기 경로 유지.
- 기존 status 값(pending/complete/error) 불변, streaming만 추가.
- 마이그레이션 nullable → 기존 행 영향 0.
- 머지 전 풀 백엔드 rspec + 프론트 vitest green 필수.
