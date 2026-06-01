## 요약 진행 상태 시각화 (스피너)

**증상/요구**: 현재 백그라운드 요약 작업(`MeetingSummarizationJob`)이 매 1분 cron 또는 사용자/시스템 트리거로 돌고 있지만, 사용자는 요약이 진행 중인지 끝났는지 알 수 없다. → **요약 실행 중임을 화면에서 시각적으로 확인할 수 있는 스피너(또는 상태 인디케이터)를 추가**한다.

**적용 범위**:
- AI 회의록 패널 헤더(`frontend/src/components/meeting/AiSummaryPanel.tsx`)에 스피너/뱃지 노출.
- 트리거 종류 구분(가능하면): realtime 자동 cron / 사용자 수동 트리거 / final(종료 시).

**필요 신호 (백엔드 → 프론트)**:
- `MeetingSummarizationJob`이 시작/종료 시점에 ActionCable broadcast 발행:
  - `{ type: "summarization_started", summary_type: "realtime"|"final" }`
  - `{ type: "summarization_finished", summary_type: ..., ok: true|false }`
- 또는 `Meeting`에 `summarizing_since` 같은 컬럼/캐시 키를 두고 컨트롤러에서 폴링.

**프론트 처리**:
- `frontend/src/channels/transcription.ts`에서 위 두 이벤트 수신 → zustand 상태(`isSummarizing: boolean`)에 반영.
- `AiSummaryPanel` 헤더의 "자동 저장" 뱃지 옆 또는 그 자리를 점유해 작은 스피너 + "요약 중..." 텍스트 표시.
- finished 이벤트 도착 시 자동 해제. 안전을 위해 30~60초 watchdog timeout으로 강제 해제.

**부가 효과**: 문제 ①의 디버깅에도 유용 — 사용자가 "방금 저장한 게 사라졌다"고 느끼는 순간이 cron broadcast 직후인지 시각적으로 확인 가능.

---

## 설계 방향: 화면 기반 요약 (Client-driven summarization)

**핵심 결정**: 요약의 입력 소스를 **DB의 Summary 레코드가 아니라 "현재 화면에 떠 있는 회의록(사용자 편집 반영본) + 라이브 자막"**으로 바꾼다. 이렇게 하면 문제 ①(사용자 편집이 1분 후 LLM 출력으로 덮어써짐)이 원천 해소된다.

### 현재 흐름 (문제)
```
[DB realtime row] → Job이 읽음 → LLM refine → [DB realtime row 덮어쓰기] → broadcast
              ↑
   user PATCH가 같은 row를 갱신해도 다음 cron이 같은 자리에 덮어씀
```

### 새 흐름 (제안)
```
[화면의 notes_markdown (편집본)] + [화면이 보고 있는 live 자막] 
   → 프론트가 요약 요청에 직접 payload로 전송
   → 서버는 stateless하게 LLM refine만 수행
   → 결과를 프론트에 응답 (DB 저장은 옵션/별도 단계)
   → 프론트가 받은 결과를 에디터에 반영 (사용자 추가 편집은 그 사이에도 유지)
```

### 구현 포인트

1. **요약 트리거가 프론트에서 출발**
   - 1분 cron은 백엔드에서 끄거나, 백엔드는 자막 수집·정리만 담당.
   - 프론트에 자체 타이머(예: 60초) 또는 "N개 자막 누적 시" 트리거를 둔다.
   - 트리거 시점에 `notes_markdown = editor.getMarkdown()` + `pending_transcripts = 화면이 적용 안 된 자막 배열`을 묶어 `POST /meetings/:id/summarize_with_context` 요청.

2. **백엔드 엔드포인트 추가/변경**
   - 새 액션 `summarize_with_context`(가칭):
     ```
     params: notes_markdown (사용자 편집본), transcripts (적용할 자막 id 목록 또는 텍스트)
     → LlmService.refine_notes(notes_markdown, payload, ...) 호출
     → 응답: { notes_markdown: 새 결과 }
     → DB 갱신은 (a) 즉시 user 행에 저장 또는 (b) 응답만 반환 후 클라이언트가 saveNow로 다시 PATCH
     ```
   - 기존 `MeetingSummarizationJob`은 final(회의 종료) 또는 사용자가 명시적으로 누른 "AI 회의록 재생성"에만 한정.

3. **로컬 우선 + 서버는 stateless refine**
   - 사용자 편집은 항상 클라이언트가 권위(authoritative). 서버는 "내가 본 입력으로 정제해줘"라는 호출에만 응답.
   - 응답 도착 시점에 에디터가 이미 사용자에 의해 또 바뀌었다면, 클라이언트가 diff/merge 정책으로 결정 (가장 단순한 정책: "사용자가 그 사이 편집했으면 응답 폐기").

4. **자막 적용 상태 관리**
   - 어떤 자막이 이미 회의록에 반영됐는지 표시(`applied_to_minutes`)는 백엔드의 기존 컬럼 재활용 가능.
   - 단, 갱신 시점은 "프론트가 응답을 받아 화면에 적용했음을 confirm" 후에. (서버가 자기 마음대로 표시하지 않음)

5. **DB 저장은 분리된 책임**
   - 요약 결과를 화면에 반영한 후, 일정 주기로(또는 사용자 명시 저장 시) `update_notes` PATCH 호출.
   - 즉 "DB Summary = 화면 상태의 스냅샷"이 되어, cron이 사라지면 덮어쓰기 자체가 없어짐.

### 장점
- **사용자 편집이 절대 사라지지 않음** — 다음 요약 입력 자체가 사용자 편집본이므로.
- 서버 상태 단순화 — cron 잡 동시성/락 문제 사실상 제거.
- 멀티 탭/협업 시에도 "현재 화면의 권위"가 명확.

### 주의/리스크
- 회의 페이지를 보지 않는 동안엔 요약이 갱신되지 않음 → 백그라운드 자동 요약을 원하는 사용자라면 옵션으로 cron 유지 + 사용자 편집 잠금(문제 ① 수정 방향 1/2번)을 병행.
- 페이로드 크기: 자막이 많아지면 매 요약 요청에 큰 payload를 보내야 함 → 적용 안 된 자막만 전송하거나 서버에서 transcripts id 목록으로만 받아 DB에서 fetch.
- 새 회의를 연 즉시(편집 없음)에는 기존 final/realtime row를 초기 노트로 로드해 시작점으로 삼는다.

### 단계적 이행 안
1. **Phase 1**: `update_notes`에 `last_user_edit_at` 컬럼 도입 → cron job이 이 시각을 보고 사용자 편집 후 N분 동안 skip (문제 ① 수정 방향 2번의 변형). 빠른 안전망.
2. **Phase 2**: 프론트에서 `summarize_with_context` 호출로 전환. cron은 유지하되 사용자 편집이 있으면 동작 안 함.
3. **Phase 3**: cron 제거. 백엔드는 final/명시 트리거 + sidecar 자막 적재만 담당.

---

## 동시 실행 차단 점검 (현재 상태)

**요구**: 같은 회의에 대한 요약 작업이 동시에 2개 이상 실행되면 안 됨.

**현재 코드 상태**: `MeetingSummarizationJob` (`backend/app/jobs/meeting_summarization_job.rb:6-8`)
```ruby
if respond_to?(:limits_concurrency)
  limits_concurrency to: 1, key: ->(meeting_id, **) { "meeting_summarization:#{meeting_id}" }
end
```

### 환경별 적용 여부

**Production (`:solid_queue`)** — `backend/config/environments/production.rb:50`
- ✅ `limits_concurrency` 적용됨. SolidQueue의 row-level 락으로 같은 키(`meeting_summarization:<id>`)의 job은 동시 실행 차단.
- 키가 `type` 무관(같은 meeting이면 realtime/final 모두 같은 키) → realtime cron과 stop 시 final이 겹쳐도 한 번에 1개만 실행.
- 후행 job은 폐기되지 않고 큐에서 대기하다 순차 실행됨.

**Development (`:async`)** — `backend/config/environments/development.rb:57`
- ❌ `limits_concurrency` 무시 (SolidQueue 전용 기능). async 어댑터는 ActiveSupport `Concurrent::ThreadPoolExecutor`로 그냥 병렬 실행.
- 동시 실행 차단 없음 → 같은 meeting의 realtime/final이 동시에 LLM을 부를 수 있음.
- 현재 유일한 안전망: `generate_minutes_realtime`의 `meeting.reload.completed?` (L54) — LLM 응답 후 broadcast 직전 가드. 즉 **LLM 호출 자체의 중복은 막지 못함** (비용·속도 손실).
- `generate_minutes_final`에는 그 가드조차 없음.

### 발견된 결함

1. **dev에서 LLM 중복 호출 가능** — 가장 큰 실사용 리스크. realtime cron + 수동 trigger + stop의 final이 겹치면 2~3개 LLM 호출 동시 발생.
2. **final 경로 가드 누락** — prod에서도 `limits_concurrency` 실패/우회 시(예: 락 row 이상, restart 직후) final이 2개 큐잉되면 둘 다 LLM 호출 후 둘 다 broadcast.
3. **`limits_concurrency`로 backlog 누적 가능성** — 한 회의의 realtime job이 60초 이상 걸리면, 그 사이 cron이 매분 새 job을 큐잉(같은 키지만 enqueue는 허용됨, 실행만 직렬화). 작업이 끝난 직후 누적된 잡들이 연쇄 실행되어 "방금 끝났는데 또 도네" 현상 가능.
4. **`SummarizationJob` 디스패처** (`summarization_job.rb`) 자체는 매분 cron으로 돌며 `recording` 상태 회의별 enqueue. 디스패처에는 동시 실행 방지가 없음(짧은 작업이라 영향 적음).

### 보완 방향

**Phase 1 (즉시)**:
- `generate_minutes_final`에도 시작 직후 `meeting.reload` + 가드(완료 여부/`last_user_edit_at`/`last_reset_at`) 추가.
- `meeting_summarization_job.rb` 최상단에서 in-process 락도 함께 적용 → dev에서도 동일 meeting 동시 LLM 호출 방지:
  ```ruby
  LOCKS = Concurrent::Map.new
  def perform(meeting_id, type:)
    mutex = LOCKS.compute_if_absent(meeting_id) { Mutex.new }
    return unless mutex.try_lock
    begin
      ...기존 로직...
    ensure
      mutex.unlock
    end
  end
  ```
  (try_lock 실패면 다른 job이 처리 중이므로 즉시 종료. broadcast 누락 위험은 후속 cron이 자막 누적 → 다음 사이클에서 처리하므로 허용.)
- 또는 dev도 SolidQueue 어댑터로 전환해 `limits_concurrency`를 prod와 동일하게 적용.

**Phase 2 (구조)**:
- 위쪽 "화면 기반 요약" 도입 후엔 realtime cron 자체가 사라져 중복 트리거 면이 대폭 축소.
- final은 명시 트리거(stop, regenerate_notes)만 남아 동시 실행 가능성 자체가 줄어듦.

### 결론
- **Prod**: 의도대로 단일 실행 보장됨. 단 final 가드 누락은 보강 권장.
- **Dev**: 실질적으로 동시 실행 보호 없음. 사용자가 체감하는 "요약이 두 번 실행되는 것 같다"가 dev 환경에서 나온 보고라면 **현재 코드가 그 문제를 해결하지 못한 상태**.

---

## 원인 분석 (개선 작업 입력용)

### 문제 ① 회의록 수정 시 저장이 안 됨

**증상**: 사용자가 AI 회의록(BlockNote 에디터)에서 마크다운을 편집해도, 잠시 후 화면이 이전 상태로 되돌아가거나 변경 사항이 사라진다.

**근본 원인 (재정정)**: 사용자 PATCH는 실제로 DB에 저장된다. **그러나 1분마다 도는 요약 cron이 같은 Summary 레코드를 LLM 출력으로 덮어쓴다.** 즉 "저장이 안 되는" 것이 아니라 **"저장 직후 덮어써진다"**가 정확한 진단.

#### 핵심 흐름

1. 사용자 편집 → `AiSummaryPanel.saveNow()` → `PATCH /meetings/:id/update_notes`
2. 컨트롤러 `update_notes` (`meetings_controller.rb:292-301`):
   - `summary = find_or_create_active_summary` (L296, L401-404)
   - `active_summary`(`meeting.rb:51-54`) = `summaries.find_by(summary_type: "final")` 우선, 없으면 `summaries.order(generated_at: :desc).first`
   - 녹음 중에는 final이 없으므로 **`realtime` 행**이 반환됨.
   - `summary.update!(notes_markdown: 사용자입력)` → DB 반영 OK.
3. **1분 후** (또는 그 이전, 수동 트리거 시) `MeetingSummarizationJob#generate_minutes_realtime` 실행:
   - `current_notes = meeting.current_notes_markdown` → 방금 사용자가 저장한 마크다운을 읽음.
   - LLM `refine_notes(current_notes, new_transcripts, ...)` 호출. LLM은 새 자막을 반영해 회의록을 **재작성**(부분 유지 + 부분 재구성)한다.
   - `summary = meeting.summaries.find_or_initialize_by(summary_type: "realtime")` → **사용자가 저장한 그 행** (`meeting_summarization_job.rb:60-61`)
   - `summary.update!(notes_markdown: LLM출력)` → 사용자 편집이 통째로 덮어써짐.
4. 회의 종료 후에도 같은 패턴: 사용자가 "저장" 버튼으로 final 행을 갱신해도, 누군가 `regenerate_notes` 트리거하거나 `stop` 시점에 들어간 final job이 실행되면 동일하게 덮어써짐.

#### 결정적 증거

- `backend/config/recurring.yml:12-22` — dev/prod 모두 `every minute`로 SummarizationJob 실행. (단, 여기서는 `SummarizationJob` 클래스명, 실제 enqueue 클래스명 매칭 여부 별도 확인 필요)
- `backend/app/models/meeting.rb:51-54` — `active_summary`는 final 우선, 그 외엔 최신 한 행. 따라서 user PATCH와 job 모두 **동일한 row**를 가리킨다.
- `backend/app/jobs/meeting_summarization_job.rb:60` (realtime), L97 (final) — `find_or_initialize_by(summary_type: ...)`로 동일 row 덮어쓰기.
- `backend/app/controllers/api/v1/meetings_controller.rb:292-301` — user PATCH도 동일 row 갱신, "user-edited" 플래그 없음.

#### 부차적(2차) 원인 — 실패해도 무방하지만 UX는 악화

- **녹음 중이 아니면 자동 저장 디바운스가 안 돈다** (`AiSummaryPanel.tsx:104-112`, `if (isRecording)` 가드). 회의 종료 후 편집은 수동 "저장" 버튼을 눌러야만 PATCH가 나감.
- **PATCH 응답 무대기 + broadcast 무가드**: `saveNow()`가 PATCH 응답을 기다리지 않고 `isUserEditingRef`를 즉시 false로 풀어, 동시에 도착하는 cron broadcast가 로컬 zustand 상태를 덮음. (DB는 1번에서 이미 저장됐어도 화면이 깜빡임)
- **`update_notes`가 broadcast를 발행하지 않음** (`meetings_controller.rb:292-301`) → 다른 탭/세션이 사용자 저장본을 즉시 받지 못함.

#### 수정 방향

**결정**: 위쪽 ["설계 방향: 화면 기반 요약"](#설계-방향-화면-기반-요약-client-driven-summarization) 채택. 요약 입력 소스를 DB 레코드가 아닌 "화면의 편집본 + 라이브 자막"으로 전환하면 본 문제의 원인(같은 row를 cron이 덮어쓰기)이 구조적으로 사라진다.

**단계적 이행 (위 섹션의 Phase와 동일)**:

1. **Phase 1 — 빠른 안전망 (먼저 머지)**
   - `meetings`에 `last_user_edit_at` 컬럼 추가, `update_notes` 컨트롤러에서 PATCH 시 갱신.
   - `MeetingSummarizationJob#generate_minutes_realtime` / `generate_minutes_final` 시작 시점에 `meeting.reload`. `last_user_edit_at`이 job `enqueued_at`보다 나중이거나 최근 N초 이내면 skip.
   - 동시에 부차 원인 정리:
     - `AiSummaryPanel.tsx:104-112` `handleChange`의 `isRecording` 가드 제거 → 종료 후에도 자동 디바운스 저장.
     - `update_notes` 성공 시 `meeting_notes_update` broadcast 발행, 단 본인은 자기 PATCH 응답을 받았으면 무시(클라이언트에서 echo 방지용 client_id 토큰).
     - `transcription.ts` broadcast 핸들러: 최근 user 저장 시각 < broadcast 시각인 경우에만 store 적용.

2. **Phase 2 — 화면 기반 요약 도입**
   - 새 엔드포인트 `POST /meetings/:id/summarize_with_context` 추가. payload = `{ notes_markdown, transcript_ids }`. 응답 = `{ notes_markdown }`. DB 저장은 응답 후 클라이언트의 `update_notes` PATCH로 분리.
   - 프론트에 자체 요약 트리거(60초 또는 자막 N개 누적). 트리거 시 에디터 markdown + 적용 안 된 자막 id 묶어 호출.
   - cron 잡은 유지하되 `last_user_edit_at` 가드 + 화면 기반 호출과 동일 키로 `limits_concurrency` 락.

3. **Phase 3 — cron 제거**
   - `recurring.yml`의 `summarization` 항목 삭제. realtime cron 경로 제거.
   - `MeetingSummarizationJob`은 `final`(stop 시) + `regenerate_notes`(명시 트리거)만 담당.
   - 백엔드의 자동 덮어쓰기 경로가 사라져 본 문제와 [문제 ②]의 잔여 job 위험이 동시에 줄어듦.

**참고: 단순 컬럼/플래그 분리 방안 (대체안, 채택 안 함)**
- `summaries`에 `user_edited_notes_markdown` 별도 컬럼 또는 `summary_type: "user"` 별도 행 + `active_summary` 우선순위 "user > final > realtime".
- 위 안이 더 단순하지만 cron이 계속 LLM을 돌려 비용·중복 broadcast가 남으므로 "화면 기반 요약"으로 가는 것이 본질적.

---

### 문제 ② 회의록 초기화가 실제로 적용되지 않음

**증상**: "초기화" 버튼을 눌러 화면이 빈 상태로 바뀌었다가, 잠시 후 옛 회의록/자막이 다시 나타남.

**근본 원인**: 초기화는 DB·로컬 스토어를 모두 비우지만, 큐에 남아있던 요약/전사 작업이 reset 이후에 실행되어 "삭제된 데이터를 새로 만들어" broadcast 함.

1. **이미 enqueue된 Job이 reset 이후에도 실행됨**
   - `backend/app/controllers/api/v1/meetings_controller.rb:175-195` `reset_content`는 transcripts/summaries/action_items/decisions/blocks/attachments를 `destroy_all` 하고 status를 `:pending`으로 되돌리지만, **이미 SolidQueue/ActiveJob에 쌓인 `MeetingSummarizationJob` / `FileTranscriptionJob`을 취소하지 않음**.
   - 종료(stop) 시점에 enqueue된 final 요약 잡이 reset 호출 후 실행되면, 다시 Summary를 만들고 `meeting_notes_update`를 broadcast 함.

2. **요약 잡의 가드가 "reset" 상태를 인지하지 못함**
   - `backend/app/jobs/meeting_summarization_job.rb:54`의 realtime 가드는 `if meeting.reload.completed?` 뿐.
   - `final` 경로(`generate_minutes_final`, L80-109 부근)에는 status 가드 자체가 없음 → reset으로 `:pending`이 되어도 final job은 그대로 진행.
   - completed → pending 역전이를 가드 조건이 다루지 않음.

3. **`reset_content`가 broadcast를 발행하지 않음**
   - 컨트롤러가 "회의록이 비워졌다"는 사실을 클라이언트에 알리지 않는다.
   - 그 결과, 잔여 job의 broadcast가 도착했을 때 프론트가 "지금은 reset 직후라 무시해야 한다"를 판단할 근거가 없음.

4. **프론트 broadcast 수신 측에 reset/pending 가드가 없음**
   - `frontend/src/channels/transcription.ts:108-110`은 `meeting_notes_update` 이벤트를 받으면 status 무관하게 `setMeetingNotes()` 호출.
   - `handleResetConfirm`(`MeetingLivePage.tsx:393-415`)이 `reset()`으로 스토어를 비우고 status를 `idle`/`pending`으로 돌려도, 직후 도착한 broadcast가 이를 다시 채움.

5. **로컬 자막 입력 경로도 동일 문제**
   - SSE/ActionCable로 들어오는 `transcript_appended` 이벤트도 reset 직후에 들어오면 비워진 자막 리스트에 다시 채워짐. (자막 작업이 백엔드에서 진행 중이었다면)

**수정 방향**:

Phase 1(즉시 적용):
- `meetings`에 `last_reset_at` 컬럼 추가. `reset_content`에서 `meeting.update!(status: :pending, last_reset_at: Time.current, ...)`.
- `reset_content` 끝에 `ActionCable.server.broadcast(meeting.transcription_stream, { type: "meeting_reset" })` 발행.
- `MeetingSummarizationJob` 시작 시 `meeting.reload`. realtime/final 양쪽 모두에서 `status == "pending"` 또는 `last_reset_at > job.enqueued_at`이면 즉시 return. 문제 ①의 `last_user_edit_at` 가드와 동일한 가드 블록으로 통합.
- 프론트:
  - `transcription.ts`: `meeting_reset` 수신 시 모든 store(notes/transcripts/action_items/decisions) 초기화 + 그 이후 일정 시간/조건 동안 `meeting_notes_update`·`transcript_appended` drop.
  - `handleResetConfirm`: API 성공 후 명시적으로 `setMeetingNotes(null)` 호출 (현재 `reset()` 부수효과 의존 제거).
- (선택) `reset_content`에서 해당 meeting의 활성 SolidQueue job을 best-effort로 `discard`. 가드가 있으므로 필수는 아님.

Phase 2~3과의 연계:
- 문제 ①의 화면 기반 요약으로 전환되면 백엔드 cron 자체가 줄어들어 잔여 job 위험도 자연 감소. 그러나 `final`/명시 `regenerate_notes`는 남으므로 reset 가드는 영구 유지 필요.

---

### 두 문제의 공통 패턴
사용자 편집·초기화 같은 "권위 있는 사용자 작업"과 백그라운드 요약 broadcast 사이에 **단일 소유권(authoritative source) 규칙이 없음**. 백엔드는 누가 마지막 변경자인지 추적하지 않고, 프론트는 모든 broadcast를 무조건 신뢰함.

해결의 두 축:
1. **단기**: `meetings.last_user_edit_at` / `last_reset_at` 컬럼 + 모든 요약 job 시작 시 `meeting.reload` 후 비교 가드 (`enqueued_at < 위 시각`이면 skip).
2. **중기**: 권위를 백엔드 cron에서 **화면(클라이언트)** 으로 이동 — "화면 기반 요약" 채택. cron 제거 후엔 final/명시 트리거만 남아 비교 가드만으로 충분해진다.

---

## 요약 중복 실행 정리 (최소 범위)

### 배경
회의 화면에서 "한 사이클에 요약이 2번 실행되는 느낌" 보고. 조사 결과:

- **백엔드는 이미 수정 완료**: `backend/app/jobs/meeting_summarization_job.rb`에
  - `limits_concurrency to: 1, key: "meeting_summarization:#{meeting_id}"` 추가 (prod/SolidQueue 한정 효력)
  - realtime 경로 broadcast 직전 `meeting.reload.completed?` 가드 추가
  - dev 백엔드 재시작 완료
- **프론트엔드 점검 결과**:
  - `useEffect` 기반 `setInterval`(경과시간, 요약 카운트다운, SpeakerPanel, HostDisconnectedBanner) 모두 cleanup 정상 → 타이머 누수 없음
  - 단 두 가지 잠재 문제 남음 ↓

### 남은 문제

**문제 ①**: `useAudioRecorder.stop()` / `useMicCapture.stop()`의 200ms `setTimeout`이 ID 미보관 · 미클리어.
- stop 직후 200ms 안에 start 하면, 옛 timeout이 새 `AudioContext`/`workletNode`를 `disconnect`/`close` 해 새 캡처가 깨질 위험.

**문제 ②**: `MeetingLivePage.handleStop`이 `triggerRealtimeSummary(meetingId)`를 호출한 직후 `stopMeeting(meetingId)`을 호출 → 백엔드 stop endpoint가 `MeetingSummarizationJob(type: "final")`을 enqueue → 회의 종료 시 **realtime + final 두 번 broadcast**.

### 수정 항목

#### 1) `frontend/src/hooks/useAudioRecorder.ts` (약 102 / 110-173 / 195-222)
- `const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)` 추가
- `stop()` 안의 `setTimeout(..., 200)` 결과를 `cleanupTimerRef.current`에 보관. 콜백 끝나면 `cleanupTimerRef.current = null`
- `start()` 진입 직후:
  ```
  if (cleanupTimerRef.current) {
    clearTimeout(cleanupTimerRef.current)
    cleanupTimerRef.current = null
    // 이전 자원이 아직 살아있으면 그 자리에서 disconnect/close 동기 정리
  }
  ```

#### 2) `frontend/src/hooks/useMicCapture.ts` (약 115-130 `stop` + `start` 진입부)
- 1)과 동일 패턴. `cleanupTimerRef` ref + `stop()`에서 보관 + `start()` 진입 시 clear + 잔존 자원 정리.

#### 3) `frontend/src/pages/MeetingLivePage.tsx` (359-387 `handleStop`)
- L370 `await triggerRealtimeSummary(meetingId).catch(() => {})` 한 줄 제거.
- L372의 `await new Promise(r => setTimeout(r, 2000))`은 "회의 종료 중..." 상태 메시지 노출 시간 확보를 위해 일단 유지 (검증 후 제거 검토).
- 백엔드 stop endpoint가 모든 트랜스크립트로 `generate_minutes_final`을 돌리므로 마지막 자막 누락 없음.
- 백엔드의 `meeting.reload.completed?` 가드와 결합 → 종료 시 **broadcast가 final 1회로 수렴**.

### 검증 방법
1. **빠른 stop → start**: 즉시 정지 후 짧은 간격 재시작. 콘솔에 `[AudioRecorder]`/`[MicCapture]` 에러 없이 `onChunk` 로그 정상 발생 확인.
2. **stop 시 broadcast 1회**: `backend/log/development.log`에서 해당 meeting의 `meeting_notes_update`가 1건(final)만 출력되는지 확인.
3. **회의록 누락 없음**: stop 직후 화면 final 회의록에 마지막 자막 내용 포함 확인.
4. **타입체크/린트**: `cd frontend && npm run typecheck` 또는 `npm run lint` / build.
5. **백엔드 회귀**: `cd backend && bundle exec rspec spec/jobs/summarization_job_spec.rb spec/services/meeting_finalizer_service_spec.rb spec/requests/api/v1/meetings_spec.rb` 통과 확인.

### 이번 범위에서 제외 (필요 시 별도 과제)
- `useEffect` 기반 `setInterval`은 이미 cleanup 정상 → 손대지 않음.
- 프론트 dedup wrapper(in-flight 요약 합치기) — 추후 검토.
- `handlePause`의 `triggerRealtimeSummary`, RecordTabPanel `onApply` — 명시 트리거라 유지.
- 근본 리팩토링(트리거 단일화, idempotent 잡, 자원 생명주기 재설계, cron 간격/LLM timeout 정책 재검토) — 별도 PR로 분리.



## 수정요청
1. 사이드바의 배경이 투명이라 배경과 겹쳐서 잘 안보임
2. 햄버거 버튼이 너무 위에 있어서 휴대폰 날짜와 겹침 
3. 회의 미리보기에서 recording, 일반 회의 등 글자가 자리를 많이 차지함
4. recording, 일반 회의, 수정아이콘 과  회의진행, 내보내기, 삭제 버튼 이 한 줄에 나오지 않음, 회의진행, 내보내기, 삭제 버튼은 아이콘 버튼으로 변경 필요
5. 회의 미리보기 옆 파일첨부, 메모, 책갈피 아이콘에서 메모, 책갈피는 의미를 잘 모르겠음
6. 회의 시작 옆 ... 버튼을 누르면 추가 옵션이 나오는데 공유, 시스템 오디오 가 있고 그 밑에는 뭐가 있는지 홈, 회의, 검색 바에 가려져서 안보임
7. 회의 페이지에서는 요약 주기 설정하는 콤보가 없어졌는데 필요한 기능

- 키스토어: frontend/src-tauri/ddobak-release.jks
- 비번: store/key ddobak2026!, alias ddobak
- (둘 다 .gitignore 처리해서 커밋 안 됨)

유저로 회의 소유자를 결정하는데 만약 같은 유저ID로 다른 디바이스에서 둘다 회의에 들어갈 수 있어? 들어간다면 둘다 회의 시작을 동시에 할 수 있겠네.
회의 목록에서 음성 업로드 기능이 없어. 타우리 데스크탑에는 있는데 모바일 버전에서도 사용하고 싶어.

admin 관리자로 들어갔을때 설정에서 유저관리를 분리하고 싶어. 

모바일 앱이면 해당 서버에 한번 접속하면 로그아웃할때까지 계속 로그인 상태로 둘수 있을까? 다른 서버에 접속했다가 다시 원래서버로 접속할때 자동으로 로그인이 되면 좋겠는데.

여러 서버를 사용하면서 회의 데이터의 파편화가 걱정이 되는데 하나의 DB를 사용하게 할 수 있을까?
