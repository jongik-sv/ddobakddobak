# AI Chat — 회의에 질문 (design)

날짜: 2026-06-16
altalt 대비 기능 ① — 특정 회의 내용에 대해 자연어로 질문/답변.

## 스코프 (v1)

- **단일 회의 한정.** 회의 read 권한자면 사용. 폴더/다중회의 횡단 질문은 비범위.
- 대화는 **질문자 본인에게만 보임**(private thread). 같은 회의라도 사용자마다 별도 대화.
- 답변은 **batch**(완료 후 일괄 표시). 스트리밍은 후속(구조는 업그레이드 가능하게).
- 컨텍스트는 **전체 주입(stuff-all)**: 회의록 요약 + 전사 전체를 프롬프트에 주입. 토큰 초과 시 fallback.

## 결정 요약

| 항목 | 선택 |
|---|---|
| UI 위치 | 우측 패널을 탭 컨테이너화 → `[메모][AI챗]` |
| 기록 | DB 저장 (회의별·사용자별) — 신규 `chat_messages` |
| 컨텍스트 | 전체 주입(요약+전사), 초과 시 요약+전사절단 fallback |
| 표시 | batch + 로딩(타이핑 인디케이터) |
| LLM 권위 | `meeting.creator.effective_llm_config` (요약과 동일) |

## 데이터 모델

신규 테이블 `chat_messages`:

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | integer PK | |
| meeting_id | integer FK→meetings | **on_delete: cascade** (#11 패턴) |
| user_id | integer FK→users | 질문자(소유자) |
| role | string | `user` \| `assistant` |
| content | text | 질문/답변 본문 |
| status | string | assistant 전용: `pending`\|`complete`\|`error` (user는 `complete`) |
| error_message | text null | 실패 사유 |
| created_at / updated_at | datetime | |

- index `(meeting_id, user_id, created_at)`.
- `Meeting has_many :chat_messages, dependent: :destroy`. `User has_many :chat_messages`.
- FTS 불필요(검색 대상 아님).

## 백엔드 흐름

```
[AI챗] 질문 → POST /api/v1/meetings/:meeting_id/chat_messages { content }
  → user ChatMessage(role:user) 저장
  → assistant ChatMessage(role:assistant, status:pending) 생성
  → MeetingChatJob(assistant_message_id) enqueue
  → 응답: { user_message, assistant_message(pending) }

MeetingChatJob:
  1. MeetingChatContext.build(meeting, user, question) → system_prompt, user_content
  2. LlmService(meeting.creator.effective_llm_config).answer_question(...) (batch)
  3. assistant_message.update(content:, status:complete) | 실패 시 status:error,error_message
  4. ActionCable broadcast → 프론트
```

### 컨트롤러
- `Api::V1::ChatMessagesController` (meetings 중첩, `MeetingLookup` 사용).
  - `index`: `authorize_meeting_read!` 후 `@meeting.chat_messages.where(user: current_user).order(:created_at)`.
  - `create`: `authorize_meeting_read!`, user 메시지+pending assistant 생성, Job enqueue.
- **함정**: `Api::V1::*`에서 bare `User`는 `Api::V1::User`로 해석 → 모델은 `::User` ([[reference_rails_user_namespace_trap]]).

### 컨텍스트 빌더 `MeetingChatContext`
- 입력: meeting, user, question.
- 조립(`parts.join("\n\n")`):
  - `회의 제목: #{title} (#{date})`
  - `회의록 요약:\n#{final summary.notes_markdown}` (있으면)
  - `회의 전사:\n#{format_transcripts}` — `[mm:ss] 화자: 내용` (started_at_ms→mm:ss)
  - `이전 대화:\n사용자: …\n어시스턴트: …` (최근 N=6턴, 있으면)
  - `질문: #{question}`
- **토큰 fallback**: 추정 길이 초과 시 요약은 전체 유지 + 전사 절단(`truncate_chars`) + "전사 일부 생략" 안내. (요약/agenda 압축의 하드 트렁케이트 패턴 재사용.)

### LLM
- `LlmService#answer_question(system_prompt, user_content)` → `call_llm_raw` (batch). 기존 `build_prompt`/`agenda_reference_block` 패턴 재사용.
- 시스템 프롬프트 = `LlmPrompts::MEETING_CHAT_SYSTEM_PROMPT` (아래).

### 시스템 프롬프트 `MEETING_CHAT_SYSTEM_PROMPT`
```
당신은 특정 회의의 내용을 근거로 사용자의 질문에 답하는 회의 어시스턴트입니다.
아래 제공된 "회의록 요약"과 "회의 전사(STT)"를 근거로 답하세요.

규칙:
- 제공된 회의 내용에 근거해 답합니다. 회의에 없는 내용을 지어내지 마세요.
- 회의 내용으로 답할 수 없으면 "회의 내용에서 확인되지 않습니다"라고 분명히 밝히세요.
  일반 상식으로 보충할 때는 "(회의 밖 일반 정보)"라고 표시해 구분하세요.
- 전사는 음성인식 결과라 오탈자·동음이의·환각이 섞일 수 있습니다.
  문맥으로 합리적으로 해석하되, 불확실하면 불확실하다고 말하세요.
- 답변은 한국어로 간결하게. 필요하면 Markdown(불릿·표)을 사용하세요.
- 근거가 되는 발언이 있으면 화자·시점을 함께 인용하세요 (예: "[12:34] 김부장: …").
- 결정사항·할 일을 물으면 회의에서 실제로 언급된 것만 정리하고, 없으면 없다고 하세요.
- 이전 대화가 있으면 맥락을 이어서 답하세요.
```

### 전송 (ActionCable)
- **전용 per-(meeting,user) stream** `meeting_<id>_chat_<user_id>`. 전사 stream 재사용 금지 — 챗은 private이라 같은 회의 다른 구독자에게 누출되면 안 됨.
- 메시지 `type: "chat_message_update"`, payload `{ id, role, content, status }`.
- 구독 authz: 해당 user 본인 + 회의 read 권한 확인.

## 프론트엔드

- 우측 패널을 **탭 컨테이너**로: `[메모][AI챗]` (데스크톱 패널 + 모바일 `buildMeetingDetailTabs`).
- `AiChatPanel.tsx`: 메시지 목록(질문 우측 버블 / 답변 좌측), 입력창+전송, pending=타이핑 인디케이터, error=재시도.
- `api/chat.ts`: `getChatMessages(meetingId)`, `sendChatMessage(meetingId, content)`.
- `chatStore`(zustand): messages, send, loading, ActionCable 구독으로 assistant 갱신 반영(echo guard).
- 색상: 명시 색(`bg-blue-600`, `bg-gray-50`, `text-gray-*`) — shadcn 시맨틱 토큰 미매핑([[project_tailwind_theme_tokens]]).

## 에러 처리

- LLM 실패 → assistant `status:error` + 재시도 버튼(같은 질문 재enqueue).
- 토큰 초과 → fallback 컨텍스트로 진행 + 답변 하단 안내.
- LLM 미설정(`effective_llm_config` 없음) → 친절 안내 메시지(요약 미설정과 동일 톤).
- 빈 질문/과도 길이 → 검증(컨트롤러).

## 테스트

- 모델: `ChatMessage` 검증(role/content presence, status enum), 연관/cascade.
- 컨트롤러: authz(read 권한 없으면 거부), **본인 스코프**(타인 메시지 안 보임), `::User` 트랩, create가 Job enqueue.
- Job: 컨텍스트 빌드 + LlmService stub + 성공/실패 상태전이 + broadcast.
- `MeetingChatContext`: 요약/전사/이전대화 조립, 토큰 초과 fallback 절단.
- 프론트: chatStore 송수신·pending·error, 탭 전환 렌더.

## 스트리밍 대비(후속)

- assistant 메시지에 점진 append 가능한 구조 유지.
- 업그레이드 시: `LlmService` batch→stream (claude_cli `--output-format stream-json` 파싱 / Anthropic·OpenAI API stream), 전송은 델타 broadcast, 프론트 증분 렌더. 모델·전송만 교체, API/데이터모델 불변.

## 비범위 (YAGNI)

- 다중회의/폴더 횡단 질문, RAG/임베딩, 답변 공유, 음성 입력, 자동 추천 질문.
