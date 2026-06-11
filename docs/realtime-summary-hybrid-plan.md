# 실시간 요약 — 하이브리드(세션유지 + 델타/op) 방안

작성: 2026-06-11
대상: 회의 요약 LLM 속도 개선. 현 `claude_cli`/haiku 생성속도 병목(본문 ~120초, refine 180초 타임아웃).

---

## 1. 배경 / 현 상태 (코드 확인됨)

- `app/jobs/meeting_summarization_job.rb`
  - `generate_minutes_realtime` (line 85~): 입력 = `applied_to_minutes:false` 델타 전사 + `current_notes`. 출력 = **회의록 전문 재생성**. → **Mode A**(입력만 델타, 출력 전체). 느림·타임아웃 원인.
  - `generate_minutes_final` (line 149~): 전체 전사 + current_notes → 회의록 전문. 1회 대형.
- `app/services/llm_service.rb`
  - `refine_notes` (line 23~): current_notes + 델타 → 통짜 `notes_markdown`.
  - `call_claude_cli` (line 234~): 매 호출 `claude -p` **새 spawn**. 세션 없음, 히스토리 없음, stateless. `--setting-sources "" --strict-mcp-config --disable-slash-commands`로 부팅 군살은 제거(커밋 46daf4a).
  - `CLI_TIMEOUT = 180`.
- 회의록 저장 = `summaries.notes_markdown` **통짜 markdown 1개**. op 타겟팅 단위 없음. 전사에 `applied_to_minutes` 불린 플래그만.

**병목 핵심**: 시간 ∝ 출력 토큰수. 구독 CLI haiku ~33 tok/s. 본문 11844자 출력 = ~120초. 부팅/입력은 수초.
→ 입력만 줄여선 안 빨라짐. **출력을 줄여야** 빨라짐 = 증분(op) 출력.

---

## 2. 하이브리드 목표

| 모드 | 트리거 | 입력 | 출력 | 속도 |
|------|--------|------|------|------|
| **B (증분)** | 실시간 틱 | 새 전사 델타만 | op 리스트(변경분만) | 빠름 (틱당 수초) |
| **A (정본)** | 종료 / "재생성" 버튼 | 전체 전사 | 회의록 전문 | 느림 1회 OK |

- 실시간 = B로 빠르게.
- 종료/명시적 재생성 = A로 전체 정돈(실시간 op 누적오차 교정 = 최종 안전망).

### 왜 세션유지가 필요한가
세션이 회의록 전체 맥락(과거 발행 op 포함)을 기억 → 새 델타가 **어느 기존 결정을 건드리는지** 식별 가능. 그래서:
- 새 결정 → `add`
- 결정 내용 변경(A안→B안 보강) → `update`
- 번복(A안 채택했다가 B안으로) → `supersede`
- 취소(없던 일로) → `remove`

단순 append 델타로는 번복/변경 절대 못 다룸(A·B 둘 다 결정으로 남아 모순).

---

## 3. 멀티 회의 / 세션 모델

**활성 회의당 세션 1개.** 서버 1대서 3건 동시 진행 = 세션 3개 동시.

- 세션 키 = `meetingId`. **교차 절대 금지**(A 델타가 B 세션 가면 회의록 오염). 컨텍스트는 배치(결정3 A/B) 무관 항상 회의별 분리.
- **상한 없음(MAX_SESSIONS 무제한)** — 추후 고사양 서버 확장 대비. 상한은 천장일 뿐 메모리 예약 아님(실 메모리 = 그 순간 살아있는 세션 수에만 비례). 평소 1~3 동시.
- **유휴 축출 = 30분 무활동 시 파기**(회의 쉬는시간 고려). 시간 기반만(개수 기반 축출 없음). DB가 정본이라 안전.
- 메모리: 세션마다 누적 히스토리 보유 → 회의 길수록 RAM↑. 30분 유휴 축출로 회수.
- STT(gpu_lock 직렬화)와 별개. 요약 동시성 상한 = 구독 크레딧/레이트리밋.
- **크래시 폭발반경**: 단일 사이드카가 전 세션 보유 → 죽으면 동시 증발. 그래도 DB items 정본 → 회의별 다음 틱에 앵커 재주입으로 복구. (회의별 프로세스 분리는 무거워서 비채택 — 단일 사이드카 + 세션맵 권장.)

---

## 4. 컴포넌트

### 4.1 세션 보유 사이드카 (Node + Claude Agent SDK)
- 회의별 영속 Claude 세션 보유. 프로세스 살아있음 → respawn 부팅비용 0, 세션 히스토리 메모리 유지.
- 인증: `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`, 구독 무과금). **주의: 2026-06-15부터 Agent SDK/`claude -p` 구독사용분 별도 월간 Agent SDK 크레딧 한도서 차감.**
- Rails ↔ 사이드카 = 로컬 HTTP/소켓(루프백 only). API:
  - `POST /session/:meetingId/delta` `{transcripts, anchor?}` → `{ops}`
  - `POST /session/:meetingId/finalize` `{fullTranscripts}` → `{notes_markdown}`
  - `DELETE /session/:meetingId` (종료 정리)
- 세션맵: `meetingId → {claudeSession, lastActiveAt}`. 유휴 축출 타이머.

> **대안(비채택)**: 사이드카 없이 `claude -p --resume <session-id>`. 세션 히스토리는 로컬 저장·replay되나, 매 spawn마다 전체 재prefill + 부팅비용 → 증분 이점 반감. 살아있는 프로세스가 핵심 이득이므로 사이드카 채택.

### 4.1a 회의별 섹션 구조 → op 라우팅
- 회의 유형마다 섹션 구조 다름. 이미 존재: `PromptTemplate.sections_prompt_for(meeting.meeting_type)` (job line 109).
- 세션 생성 시 그 회의의 **섹션 구조를 시스템 프롬프트에 주입** → 세션이 자기 회의의 섹션 집합 인지.
- 델타가 들어오면 세션이 각 내용의 소속 섹션 판단 → op의 `section` 필드로 라우팅. 머지가 `meeting_minute_items.section`에 슬롯.
- 한 델타에 여러 섹션 내용 섞이면(결정 1 + 액션 2) → op 여러 개로 쪼개 각 섹션 분산.
- 세션별 독립: 회의 A(유형=일반)는 일반 섹션 기준, 회의 B(유형=1:1)는 1:1 섹션 기준 — 각자 자기 구조로 분류.

### 4.2 op 스키마
```json
{ "ops": [
  { "type": "add",       "section": "결정사항", "id": "d-1", "text": "..." },
  { "type": "update",    "id": "d-1", "text": "(보강된 내용)" },
  { "type": "supersede", "id": "d-1", "text": "B안으로 번복", "reason": "10:40 재논의" },
  { "type": "remove",    "id": "d-1" }
] }
```
- `id` = 항목 안정 식별자. 세션이 자기가 발행한 id 기억 → 후속 델타에서 같은 id 참조해 변경/번복.

### 4.3 머지 (Rails 측 = 진실원천) — A' 블록단위 모델 채택

**입자 = 줄 단위 아님, 섹션/블록 단위.** (결정1=A, 모델=A')

| 입자 | 결과 |
|------|------|
| 전체 markdown (B) | op 타겟 불가, 느림 |
| 줄 단위 items | 표·mermaid 깨짐 + 회의형식별 스키마 폭발 (비채택) |
| **섹션/블록 단위 (A')** | op는 블록 단위 supersede/update, 블록 안은 markdown 자유(표·다이어그램 OK) |

**핵심: 섹션 라벨 = 스키마 아니라 데이터.** 회의형식별 섹션 구조는 이미 `sections_prompt_for(meeting_type)` 프롬프트로 존재. items 테이블은 형식 무관 generic — `section`은 자유 문자열 라벨. 새 회의형식 추가 = `sections_prompt`만 추가, **DB·머지코드 무변경, 형식별 분기 0**.

- 신규 테이블 `meeting_minute_items`:
  `id, meeting_id, section(string label), item_key, text(블록 markdown — 표/mermaid/중첩 그대로), status[active|superseded|removed], superseded_by, position, timestamps`
- op 적용 = 이 테이블 블록 단위 갱신. (예: `{supersede, section:"결정사항", item_key:"파일포맷", text:"B안(YAML)"}` → 그 블록 통째 교체)
- 렌더: items → markdown(기존 `notes_markdown` 호환 출력해 브로드캐스트·표시 그대로).
- 일반/1:1/신규 형식 전부 **같은 테이블·같은 머지 로직**. 차이는 데이터(sections_prompt)에만.
- supersede 표현 2택:
  1. **교체** — 옛 항목 제거, 신규만. 깔끔하나 이력 손실.
  2. **취소선+갱신** — `~~A안 채택~~ → B안(10:40)`. 의사결정 추적. 회의록엔 보통 이게 나음. (기본 채택 권장)

### 4.4 생명주기
- 회의 start → 사이드카 세션 생성(시스템 프롬프트 주입: 섹션 구조, op 출력 규약).
- 틱마다 → `delta` → ops → 머지(items) → 브로드캐스트(`meeting_notes_update`, items→markdown 렌더). 기존 채널 재사용.
- 회의 stop/complete → `finalize` 풀패스(전체 전사 재읽음) → 정본 확정 → 세션 파기.
- **30분 유휴 축출 / 크래시 / 재시작 → 세션 증발 → 재개 시 앵커 재주입으로 복구**(아래 4.4a).

### 4.4a 재개 시 컨텍스트 복구 (앵커 재주입)
세션은 휘발성 가속기, **DB `meeting_minute_items`가 정본.** 축출·크래시 후 회의 재개 시:
```
POST /session/:meetingId/delta {transcripts}
  세션맵에 meetingId 있음?
    예  → 델타만 전송 (빠름)
    아니오(축출/크래시/최초) →
      1. 세션 생성 (sections_prompt 시스템프롬프트 주입)
      2. 앵커 주입: "현재까지 회의록 = <DB items → markdown 렌더>"  ← 전체 전사 아님, 회의록 결과만(가벼움)
      3. 그 다음 델타 전송
```
- 세션이 "지금까지 이런 회의록이었다" 인지 → supersede/update 타겟팅 정상.
- 비용: 재개 첫 틱만 앵커(회의록 1개분) prefill 1회. 이후 다시 델타만.
- 30분이든 3시간이든 동일 — DB에서 앵커 한 번 주입하면 맥락 복원.

---

## 5. 안전장치

- **세션 = 휘발성 가속기. DB items = 진실.** 세션 죽어도 손실 없게.
- 긴 회의 → 세션 컨텍스트 윈도우 초과(compaction) 위험 → 주기적 앵커 재주입 or 종료 풀패스 교정.
- op 드리프트(세션 오기억) → 종료 풀패스가 최종 교정.
- 6/15부터 Agent SDK 별도 크레딧 차감 → 사용량 모니터.
- 통짜 fallback 경로 유지: 사이드카 다운/세션상한 초과 시 기존 `refine_notes`(Mode A)로 자동 강등.

---

## 6. 구현 단계

1. **DB 구조화** — `meeting_minute_items` 마이그레이션 + items↔markdown 렌더/역호환 레이어. (op 없이 먼저, 기존 동작 보존)
2. **사이드카 골격** — Node Agent SDK, 세션 생성/delta/finalize/delete, OAuth 토큰, 세션맵+유휴축출.
3. **realtime 잡 분기** — delta→op 경로 추가, 머지 적용. 기존 통짜 경로 = fallback.
4. **final 잡** — finalize 풀패스로 정본 확정.
5. **검증** — 번복 시나리오(A안→B안) E2E, 세션 크래시 복구, 긴 회의 앵커, 멀티 회의 동시 세션 격리.

---

## 7. 결정 사항

- **[결정됨] 회의록 구조화 = A (전환), 모델 = A' 블록단위.** §4.3 참조. 섹션=데이터(형식별 분기 0). 작업: items 테이블 + items↔markdown 렌더 + 사용자편집/op 충돌정책.
- **[작업 격리] 브랜치 `feat/realtime-summary-hybrid`에서 작업** — 언제든 main 복귀 가능.
- **[결정됨] supersede 표현 = 취소선+갱신** (`~~A안~~ → B안(시각)`). 의사결정 변천 추적.
- **[결정됨] 사이드카 배치 = A 단일 프로세스 + 세션맵.** 회의별 컨텍스트는 A에서 보장(맵 키=meetingId). 실사용 1~3 동시라 회의별 프로세스(B) 불필요.
- **[결정됨] 세션 상한 = 무제한**(추후 확장 대비, 천장이지 예약 아님) / **유휴 축출 = 30분**(쉬는시간 고려) / 재개 시 앵커 재주입(§4.4a).

### 사용자 직접편집 vs op 머지 충돌 정책 (A 채택으로 새로 필요)
사용자가 markdown 통으로 편집 시 블록 매핑 깨질 수 있음 → 그 회의는 op 중단하고 통짜 모드로 강등(기존 `last_user_edit_at` 안전장치 재사용). 형식별 복잡 아님 = 모델 1개 복잡.
