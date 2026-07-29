# 추가 가능한 에이전틱 기능 후보 — 2026-07-27

> **기준**: main `0b3f11c4`. 이 문서의 모든 "있다/없다"는 HEAD 코드 실측이며, 앵커(`file:line`)는 작성 시점에 존재를 확인했다.
> **선행 문서**: `docs/archive/competitor-gap-2026-06-18.md` §10(갭별 구현 방안), `docs/기능-인벤토리.md` §미구현·로드맵 메모, `idea.md`.
> **상위 문서**: `docs/competitor-gap.md` — 신규 개발 대상 통합 목록(경쟁 갭 A~U + 이 문서의 B-1~B-7). 우선순위는 거기서 본다. 이 문서는 에이전틱 후보의 **설계 근거·앵커 원본**.
> **범위**: 후보 발굴까지. 설계·구현 미착수.

## 목차
- [1. 요약 — 한 장](#1-요약--한-장)
- [2. "에이전틱"의 정의 (선별 필터)](#2-에이전틱의-정의-선별-필터)
- [3. 공통 인에이블러 — 툴 루프](#3-공통-인에이블러--툴-루프)
- [4. 신규 후보 7](#4-신규-후보-7)
- [5. 기존 등재 항목 — HEAD 델타](#5-기존-등재-항목--head-델타)
- [6. 문서 정정 필요 2건](#6-문서-정정-필요-2건)
- [7. 착수 순서와 설계 원칙](#7-착수-순서와-설계-원칙)
- [부록 A. 실측 앵커 모음](#부록-a-실측-앵커-모음)

---

## 1. 요약 — 한 장

기존 두 문서에 이미 등재된 에이전틱 항목(라이브 어시·에이전트 워크플로·다이제스트·웹훅)은 **전부 여전히 미구현**이며 §5에 델타만 적었다. 아래 7개는 **양 문서 어디에도 없는 신규 후보**다.

| # | 후보 | 무엇을 자율로 하나 | effort | 선행조건 | 핵심 재사용 |
|---|---|---|---|---|---|
| **B-1** | 액션아이템 생애주기 | 후속 회의 전사를 증거 삼아 미결 항목 완료/차단 판정 → 제안 | M | gap §10 ③(hint 배선) | 임베딩 검색 · previous_meeting 체인 · 인용 점프 |
| **B-2** | 예약 사전 브리핑 | T-30/T-10에 이전 미결·결정·안건 모아 브리프+알림 | M | 없음 | 1분 스케줄 크론 · Tauri 알림 |
| **B-3** | 회의 자동 파일링 | 폴더·회의유형·태그·이전회의 연결 제안 | S~M | 없음 | transcript_embeddings · tags · PromptTemplate |
| **B-4** | 요약 자기검증(critic) | 근거 없는 문장·누락 결정 검출 → 플래그/재생성 | M | 없음 | 발화근거 마커(ms) · call_llm_json |
| **B-5** | 에이전틱 챗(툴 루프) | 다중 홉 질문을 계획→도구실행→관찰로 해결 | L | §3 인에이블러 | 검색·벡터·쿼리확장 서비스 전부 기존 |
| **B-6** | MCP 서버 노출 | 외부 에이전트가 회의를 pull 조회 | M~L | B-5 ToolRegistry | 동일 도구 정의 · accessible_by 인가 |
| **B-7** | 글로사리 자가학습 | 반복 수정 패턴 감지 → 사전 항목 제안 | M | **편집 diff 캡처 부재** | GlossaryResolver · apply_all! 재적용 |

**한 문장 결론**: 가장 싼 것은 B-3, 가장 값진 것은 B-1, 가장 큰 도약은 B-5+B-6(도구 레지스트리 1회 투자 → 두 표면). B-7만 선행 인프라가 없어 지금 착수 불가.

---

## 2. "에이전틱"의 정의 (선별 필터)

아래 4개를 **모두** 만족해야 이 문서에 실었다.

1. **사용자 프롬프트 없이 트리거** — 크론·이벤트·상태변화가 시작점
2. **다단계** — 프롬프트→텍스트 1회가 아니라 관찰→판단→행동이 2회 이상
3. **상태·도구를 읽고 쓴다** — DB 레코드 생성/갱신, 도구 호출, 알림 발송
4. **시스템이 판단한다** — 무엇을 할지 LLM/규칙이 정하고 사람은 승인만

**필터 탈락**(유용하지만 에이전틱 아님, gap §10 Tier 목록에 그대로 둠): 자동 챕터/토픽 분할 · 번역 · 다포맷 재구성 · 발언 점유율 — 전부 단발 추론이거나 순수 후처리.

---

## 3. 공통 인에이블러 — 툴 루프

B-1·B-4·B-5·B-6이 공유하는 기반이라 개별 항목에서 빼 앞으로 옮긴다.

**현황**: `LlmService`에 도구 호출 개념이 전혀 없다. 모든 공개 경로가 `call_llm_raw`(`llm_service.rb:347`) 한 곳으로 모이고, 여기서 프로바이더 분기 후 **텍스트 1회 왕복**으로 끝난다.

**native function calling은 선택지가 아니다**: 분기에 `claude_cli`·`gemini_cli`(agy)·`codex_cli`가 있고 이들은 텍스트 in/out 전용. anthropic/openai만 지원하는 방식을 고르면 프로바이더 자유도(제품의 차별점)를 깬다.

**대안 — JSON 플래너 루프 (프로바이더 무관)**:
```
계획(JSON) → 실행기가 도구 호출 → 관찰 결과를 다음 프롬프트에 주입 → 반복 → 최종 답변
```
이미 검증된 재료로 성립한다: `call_llm_json`(`llm_service.rb:638`) + `TextFormatter.extract_json`(`llm_service/text_formatter.rb:30`)이 **summarize · summarize_action_items · extract_domain_terms 3곳에서 전 프로바이더 실사용 중**.

**⚠️ 알려진 함정**: `extract_json`은 코드펜스만 벗긴다. 앞뒤에 산문이 섞이면 `JSON::ParserError` → `nil` 반환(`llm_service.rb:641-642`). 단발 호출에선 빈 결과로 끝나지만 루프에선 스텝 낭비가 된다 → **재프롬프트 1회 + 단발 RAG 폴백**을 루프 설계에 처음부터 넣어야 한다.

**예산 가드**: 로컬 CLI 프로바이더는 스텝당 수 초~수십 초. 최대 스텝 수와 누적 토큰 상한 없이 배포하면 안 된다.

---

## 4. 신규 후보 7

### B-1. 액션아이템 생애주기 에이전트 · effort M
**gap §10 ③과 다른 것**: ③은 버려지는 hint를 배선하는 *배관*. 이건 항목이 만들어진 **이후**를 자율로 굴린다.

- **동작**: 회의 finalize 후 → 같은 폴더/이전 회의 체인의 미결(`status != done`) 항목을 현재 전사와 대조 → "완료됐다/막혔다/기한 밀렸다" 판정 → **상태 변경 제안** + 근거 전사 구간(transcript_id + ms) 첨부. 사용자는 1클릭 승인.
- **재사용**: `transcript_vector_search.rb`(임베딩) + FTS, `meetings.previous_meeting_id` 체인, 인용 마커(`⟦t:…⟧` → `__ddobakSeek`)가 이미 있어 근거 클릭 점프가 공짜.
- **추가**: `ActionItemLifecycleJob`, `action_items.suggested_status`·`evidence_json`, 승인 엔드포인트, 미결 교차회의 뷰(`GET /action_items/my_open`).
- **⚠️ 체이닝 지점 주의**: finalize 진입점이 **4갈래**다. `meeting.rb:350`·`meetings_controller.rb:405,555`는 `MeetingFinalizerJob.perform_later`지만 `file_transcription_job.rb:56`은 **서비스 직접 동기 호출**. job에만 후속을 붙이면 업로드 경로가 통째로 누락된다 → `MeetingFinalizerService` 말미 체이닝이 안전.
- **판단 필요**: 자동 확정을 어디까지 허용할지. 권고는 전면 제안 큐(자동 확정 0).

### B-2. 예약 기반 사전 브리핑 에이전트 · effort M
idea.md 13·14·15는 "사용자 소망"으로만 적혀 있고 에이전트로 설계된 적이 없다.

- **동작**: 예약 회의 T-30/T-10에 크론이 깨어나 → 이전 회의 미결 액션 + 최근 결정 + 첨부 안건(`agenda_reference`)을 모아 브리프 생성 → 데스크톱/모바일 알림 + 회의 진입 시 상단 카드.
- **재사용**: `ScheduleRolloverJob`이 이미 매분 도는 스케줄 크론(`config/recurring.yml`), `meetings.scheduled_start_time`·`recurrence_rule`, `agenda_reference_job.rb`(안건 반영 파이프), `tauri-plugin-notification`(`frontend/src-tauri/Cargo.toml:32`).
- **추가**: `MeetingPrepJob`(T-N 윈도우 스캔, 멱등 가드는 rollover 패턴 복사), `meetings.prep_brief_markdown`·`prep_notified_at`, 알림 배선.
- **주의**: 알림은 클라이언트가 살아 있어야 뜬다 — 데스크톱 백그라운드 실행(idea 12 완료)에 의존. 서버만 도는 상태에선 브리프가 생성돼도 전달되지 않는다.

### B-3. 회의 자동 파일링 에이전트 · effort S~M
- **동작**: 회의 종료 직후 내용 기반으로 ① 폴더 ② `meeting_type` ③ 태그 ④ 일회성 회의의 `previous_meeting_id` 연결을 제안. ①②③은 현재 전부 수동.
- **④ 범위 정정(실측)**: 반복 시리즈는 **이미 자동 체이닝된다** — `materialize_next_occurrence!`가 successor에 `previous_meeting_id: id`를 박는다(`meeting.rb:102`). 미연결로 남는 건 일회성 회의뿐이고, 그때만 `meeting_summarization_job.rb:175,329`의 seeded_merge(이어쓰기) 경로가 안 켜진다.
- **재사용**: `transcript_embeddings`(회의 간 유사도 그대로), `tags`/`taggings` 모델, `PromptTemplate#sections_prompt_for(meeting_type)`가 type을 이미 소비 → 분류가 맞으면 요약 품질까지 따라 오른다.
- **추가**: `MeetingFilingJob`(임베딩 centroid 유사도 + LLM 확인), 제안 배너 UI.
- **가치 근거**: 자체호스팅 특성상 폴더가 금방 지저분해지고, 잘못 분류된 회의는 폴더 챗·의미검색 품질을 직접 갉아먹는다.

### B-4. 요약 자기검증(critic) 루프 · effort M
- **동작**: 요약 직후 별도 critic 패스가 요약 각 항목을 전사와 대조 → **근거 없는 문장(할루시네이션)** 과 **누락된 결정** 검출 → 낮은 신뢰도 문장 플래그 또는 자동 1회 재생성.
- **왜 이 제품에서 특히**: LLM 선택이 사용자별로 열려 있고(ollama·lmstudio·CLI 포함) 로컬 소형 모델도 굴러간다 → 품질 편차가 기본값인데 검증 레이어가 0.
- **재사용**: 요약이 이미 발화 근거 마커를 달고 나온다(idea 7 완료) → 마커의 ms가 실제 전사 구간과 맞는지는 **LLM 없이 기계적으로** 1차 검증 가능. 2차(의미 대조)만 LLM.
- **추가**: `SummaryCriticJob`(요약 후 체이닝), `summaries.critic_report_json`, 저신뢰 문장 하이라이트.
- **판단 필요**: 자동 재생성 허용 여부 — 재생성은 요약 비용을 2배로 만든다. 플래그만 두고 사용자가 누르게 하는 편이 싸다.

### B-5. 에이전틱 챗(툴 루프) · effort L
현 챗은 **컨텍스트 선조립 후 단발 응답**이다(`meeting_chat_context.rb`·`folder_chat_context.rb`가 발췌를 미리 넣고 `answer_question`이 1회 호출). "A가 지난 분기에 약속한 것 중 아직 안 끝난 게 뭐야?" 같은 다중 홉 질문은 구조적으로 못 푼다.

- **추가**: `ToolRegistry`(read-only 6종부터 — `search_transcripts`·`get_summary`·`list_action_items`·`list_decisions`·`speaker_stats`·`compare_meetings`) + `AgentLoop`(최대 스텝·토큰 예산, trace 저장).
- **재사용**: 도구 구현체는 전부 존재 — `search_service.rb`, `transcript_vector_search.rb`, `folder_chat_query_expansion.rb`. 인가는 기존 `accessible_by` meeting_id 필터를 도구 레이어에서 강제.
- **기반**: §3 참조(native function calling 불가 → JSON 플래너 루프).
- **판단 필요**: 기존 단발 챗을 대체할지, "깊게 찾기" 모드로 병치할지. 병치가 안전 — 루프는 느리고 비싸다.

### B-6. MCP 서버 노출 · effort M~L
- **동작**: 또박또박을 MCP 서버로 노출 → 외부 에이전트(Claude Code/Desktop 등)가 회의를 검색·조회. gap §10 ⑫(웹훅)는 **push 방향뿐**이고 pull 방향은 양 문서에 전혀 없다.
- **재사용**: B-5의 `ToolRegistry`를 두 번째 표면으로 그대로 — 한 번 정의해 챗·MCP 양쪽. 인가도 동일 `accessible_by`.
- **추가**: `ApiToken`(PAT — 현재 개념 자체가 없음, scope·expiry 포함) + `/mcp` streamable-HTTP 엔드포인트.
- **보안**: 자체호스팅이라 토큰 유출 = 전 회의 노출. scope 필수, 기본 만료 필수, **read-only부터**. write 도구는 별도 결정 전까지 금지.

### B-7. 글로사리/오타사전 자가학습 · effort M — 지금은 착수 불가
- **동작**: 사용자가 전사·회의록에서 **같은 수정을 반복**하면 감지 → 폴더 글로사리 항목 제안 → 승인 시 `apply_all!` 재적용.
- **재사용**: `GlossaryResolver`의 회의>폴더>조상 레벨 상속과 `MeetingGlossaryApplier#apply_all!` 재적용 패턴이 이미 완성형.
- **⚠️ 선행조건**: 편집 전/후 diff를 남기는 곳이 없다. **수정 이력 캡처가 실제 비용의 대부분** — 이것 없이는 시작할 수 없다.

---

## 5. 기존 등재 항목 — HEAD 델타

| 항목 | 등재 위치 | 2026-07-27 실측 |
|---|---|---|
| 라이브 in-meeting 어시(⑨) | gap §10 Tier2 | 미구현. 인프라(`SummarizationJob` 1분 크론·`ChatChannel`) 변화 없음 |
| 에이전트형 워크플로(⑬ 상태보고·다음안건) | gap §10 Tier3 | 미구현. `meeting_finalizer_service.rb`는 46줄, action_items·decisions 추출만 |
| 액션아이템 배선(③) | gap §10 Tier1 | **여전히 hint 폐기 중**. `save_action_items`(`meeting_finalizer_service.rb:26-34`)가 content/status/ai_generated만 저장. `assignee_hint`·`due_date_hint`는 `summarization_prompts.rb:13,26`에서 추출되나 버려짐. 컬럼(`action_items.assignee_id`·`due_date`)은 존재 |
| 폴더 정기 AI 다이제스트 | gap §9 ❌ | 미구현 |
| 아웃바운드 웹훅 + PAT(⑫) | gap §10 Tier3 | 미구현. `config/routes.rb`에 webhook·api_token 라우트 없음 |
| 자가복구 워치독 | 인벤토리 "내부" | 부분 존재 — `recorder_heartbeat_at`·`re_diarize_started_at`·`RecorderConflictGuard`. 에이전트로 승격할 여지는 있으나 신규 아님 |

---

## 6. 문서 정정 필요 2건

발굴 과정에서 기존 문서가 HEAD와 어긋난 것을 확인했다. **이 문서는 수정하지 않았다** — 반영은 별도 결정.

1. **`docs/기능-인벤토리.md`: "챗 후속 예상 질문 = 계획"** → **구현 완료(클릭 연결까지)**
   - 백엔드 `split_followups`(`folder_chat_job.rb:24`·`meeting_chat_job.rb:24`), `chat_messages.suggestions_json`(schema.rb:50)
   - 프론트 칩 렌더 + `onClick → send(scopeType, scopeId, q)`(`AiChatPanel.tsx:203-218`, pending 중 disabled), 테스트 `__tests__/AiChatPanel.test.tsx`
   - idea.md 49번이 요구한 "링크 누르면 바로 질문" 조건까지 충족 → **idea.md 49도 완료 표기 대상**
2. **`idea.md` 11번 "자동으로 이어지는 회의 / 반복 회의 등록 = 미완료"** → **부분 구현**
   - `meetings.recurrence_rule`·`scheduled_start_time`(schema.rb:262-264), `Recurrence.next_occurrence`, `ScheduleRolloverJob`(1분 크론)이 놓친 시리즈의 다음 occurrence를 멱등 생성 중
   - 남은 건 "몇 분 뒤 시작할 연결 회의 자동 생성"뿐

---

## 7. 착수 순서와 설계 원칙

**권고 순서**
1. **B-3 파일링** — 가장 싸고, 폴더 챗·의미검색 품질을 즉시 올린다
2. **B-1 액션아이템 생애주기** — 단, gap §10 ③(hint 배선)을 먼저 끝내야 재료가 생긴다
3. **B-2 사전 브리핑** — idea 13·15를 한 번에 해소, 크론 인프라 그대로
4. **B-4 크리틱** — 사용자별 LLM 자유도가 만드는 품질 편차의 방어선
5. **B-5 + B-6** — 도구 레지스트리 1회 투자로 두 표면. 가장 큰 도약이자 가장 큰 비용
6. **B-7** — 편집 이력 캡처가 선행되면 그때

**공통 설계 원칙**
- 에이전트의 쓰기는 전부 **제안 → 사람 승인**. 회의 기록을 조용히 바꾸지 않는다.
- 모든 판단에 **근거(transcript_id + ms)** 를 붙인다. 인용 점프 배선이 이미 있어 검증 비용이 거의 0.
- **스텝·토큰 예산 가드 필수**(§3). 로컬 CLI 프로바이더는 스텝당 수 초~수십 초.
- 인가는 도구 레이어에서 **`accessible_by`로 일원화**. 에이전트가 늘수록 인가 우회 표면이 늘어난다 — idea 44 감사에서 IDOR 3건이 나온 전례가 있다.

---

## 부록 A. 실측 앵커 모음

| 사실 | 앵커 |
|---|---|
| LLM 프로바이더 분기(단발 텍스트 왕복) | `backend/app/services/llm_service.rb:347` |
| 전 프로바이더 공통 JSON 경로 | `backend/app/services/llm_service.rb:638` + `llm_service/text_formatter.rb:30` |
| JSON 파싱 실패 시 nil | `backend/app/services/llm_service.rb:641-642` |
| finalize 서비스(46줄, hint 폐기) | `backend/app/services/meeting_finalizer_service.rb:26-34` |
| finalize 진입점 4갈래 | `meeting.rb:350` · `meetings_controller.rb:405,555` · `file_transcription_job.rb:56`(동기) |
| action item hint 추출 프롬프트 | `backend/app/services/llm_prompts/summarization_prompts.rb:13,26` |
| 반복 회의 successor 체이닝 | `backend/app/models/meeting.rb:85,102` |
| seeded_merge(이어쓰기) 분기 | `backend/app/jobs/meeting_summarization_job.rb:175,329` |
| 스케줄 크론(1분) | `backend/app/jobs/schedule_rollover_job.rb` + `backend/config/recurring.yml` |
| 요약 크론(1분) | `backend/app/jobs/summarization_job.rb` + `recurring.yml` |
| 챗 후속질문 백엔드 | `backend/app/jobs/{folder,meeting}_chat_job.rb:24` |
| 챗 후속질문 프론트(클릭 연결) | `frontend/src/components/meeting/AiChatPanel.tsx:203-218` |
| 벡터 검색 추상화 | `backend/app/services/transcript_vector_search.rb` |
| 챗 컨텍스트 선조립 | `backend/app/services/{meeting,folder}_chat_context.rb` |
| 글로사리 레벨 상속·재적용 | `backend/app/services/glossary_resolver.rb` · `meeting_glossary_applier.rb` |
| Tauri 알림 플러그인 | `frontend/src-tauri/Cargo.toml:32` |
| PAT·웹훅·MCP 부재 | `backend/config/routes.rb`(해당 라우트 없음) |
