# TSK-07-05 성능 최적화 및 버그 수정 - 설계

## 목표

| 항목 | 목표값 | 현재 상태 |
|------|--------|----------|
| STT 지연 | ≤ 3초 | 미측정 (ActionCable → Solid Queue → Sidecar 경유) |
| AI 실시간 요약 | ≤ 10초 | 미측정 (LLM 동기 호출) |
| 10명 동시 WebSocket | 안정 | 미검증 (Puma 3 thread, async adapter) |
| SQLite 동시 쓰기 | lock 없음 | WAL 모드 설정 완료, 부하 미검증 |

---

## 현황 분석

### STT 파이프라인 경로 분석

```
브라우저 AudioWorklet (3초 청크)
  → sendAudioChunk: PCM Int16 → base64 인코딩 (btoa loop, O(n))
    → ActionCable (TranscriptionChannel#audio_chunk)
      → TranscriptionJob.perform_later (Solid Queue)
        → SidecarClient#transcribe (HTTP POST, timeout=30s)
          → Python FastAPI /transcribe
            → Qwen3Adapter#transcribe (vLLM executor)
              → ActionCable broadcast → 브라우저 UI
```

**병목 지점 1: base64 인코딩 방식 (frontend/src/channels/transcription.ts:91~97)**

현재 `btoa(binary)` 구현이 for 루프로 문자 하나씩 연결하는 O(n) 방식이다. 3초 청크(16kHz×2byte×3초 = 96KB)에서 96,000회 반복이 발생한다.

```typescript
// 현재 구현 (느림)
let binary = ''
for (let i = 0; i < bytes.length; i++) {
  binary += String.fromCharCode(bytes[i])
}
const base64 = btoa(binary)
```

**병목 지점 2: TranscriptionJob이 ActiveJob 큐를 경유 (backend/app/channels/transcription_channel.rb:19)**

오디오 청크 수신 → `perform_later` → Solid Queue 스케줄링 → Job 실행 순서로, 큐 대기 시간이 추가된다. 실시간 STT의 경우 큐 없이 즉시 처리하는 것이 지연을 줄인다.

**병목 지점 3: SidecarClient HTTP 연결 매번 재생성 (backend/app/services/sidecar_client.rb:50~53)**

`with_connection`에서 매번 `Net::HTTP.new` + `http.start` 를 호출하여 TCP 연결을 재생성한다. open_timeout=30s 설정이지만 연결 오버헤드가 축적된다.

**병목 지점 4: Qwen3Adapter - vLLM executor 블로킹 (sidecar/app/stt/qwen3_adapter.py:82)**

`run_in_executor`로 비동기화했지만, vLLM 추론 자체가 GPU를 점유하므로 동시 요청 시 직렬화된다.

### AI 요약 경로 분석

```
Solid Queue (5분 cron: recurring.yml:18)
  → SummarizationJob#perform (모든 recording 회의 순회)
    → SidecarClient#summarize (HTTP POST, timeout=30s)
      → LLMSummarizer#summarize (동기 anthropic SDK 호출)
        → broadcast → 브라우저
```

**병목 지점 5: LLMSummarizer._call_llm가 동기 (sidecar/app/llm/summarizer.py:82)**

`anthropic.Anthropic`의 동기 클라이언트를 `async def summarize`에서 직접 호출한다. FastAPI의 async 이벤트 루프를 블로킹하여 `/transcribe` 처리도 지연된다.

**병목 지점 6: SummarizationJob이 모든 recording 회의를 순차 처리 (backend/app/jobs/summarization_job.rb:4~8)**

10명이 각자 다른 회의를 진행하는 경우, 10개 회의를 직렬로 처리하여 후반 회의는 N×LLM응답시간 만큼 지연된다.

### WebSocket 동시 접속 분석

**현황:**
- Development: ActionCable async adapter (단일 프로세스, 메모리 내 pub/sub)
- Production: SolidCable adapter (SQLite cable DB, polling_interval=0.1s)
- Puma: 기본 3 threads (puma.rb:32)
- ActionCable은 스레드 기반이며 10명 동시 접속 시 3 thread 풀로는 부족

**병목 지점 7: Puma thread pool 부족**

`RAILS_MAX_THREADS=3` 기본값으로 WebSocket 연결 10개가 동시에 오디오 청크를 전송하면 큐잉이 발생한다.

### SQLite 동시 쓰기 분석

**현황:**
- WAL 모드 + busy_timeout=5000 설정됨 (database.yml)
- production: primary/cache/queue/cable 4개 DB 분리됨
- TranscriptionJob에서 `Transcript.create!` 다중 동시 쓰기 발생 가능

WAL 모드와 busy_timeout이 이미 설정되어 있어 기본적인 보호는 갖춰져 있다. 단, 동시 write가 집중될 경우 5000ms timeout이 넘을 수 있다.

### E2E 테스트 코드에서 발견된 버그/미구현 사항

**버그 1: TranscriptionChannel#audio_chunk 메서드명 불일치**

`frontend/src/channels/transcription.ts:97`에서 `subscription.perform('receive_audio', ...)` 를 호출하지만, `backend/app/channels/transcription_channel.rb`에는 `audio_chunk` 메서드만 정의되어 있다. ActionCable은 `perform('receive_audio')` 시 `receive_audio` 메서드를 호출하므로, 현재 구현에서는 오디오 청크가 처리되지 않는다.

**버그 2: Meeting start/stop API 미구현**

`e2e/tests/meeting.spec.ts:55~63`에서 `**/api/v1/meetings/*/start`와 `**/api/v1/meetings/*/stop` 라우트를 mock하는데, `backend/config/routes.rb`에는 이 엔드포인트가 정의되어 있지 않다. 회의 시작/종료 기능이 실제로 동작하지 않는다.

**버그 3: Meeting summary API 미구현**

`e2e/tests/minutes.spec.ts:57`에서 `RoutePatterns.meetingSummary(id)` 라우트를 mock하지만, `routes.rb`에 summary 관련 엔드포인트가 없다. `MeetingLivePage`에서 회의 요약을 불러오는 REST API 호출이 실패한다.

**버그 4: LLMSummarizer가 async 컨텍스트에서 동기 SDK 호출**

`sidecar/app/llm/summarizer.py:82`에서 `async def summarize`가 동기 `self._client.messages.create`를 직접 호출한다. FastAPI uvicorn 이벤트 루프를 블로킹하므로 `/transcribe` WebSocket 응답이 지연된다.

**버그 5: TranscriptStore 이벤트 수신 불가 (E2E 테스트 한계)**

`e2e/tests/pipeline.spec.ts:101~118`에서 `__e2e_inject_transcript__` 커스텀 이벤트로 transcript를 주입하지만, `transcriptStore`가 이 이벤트를 수신하는 코드가 없다. 실제 ActionCable 없이는 E2E에서 자막 표시를 직접 검증할 수 없다. 테스트 자체는 "빈 상태를 검증"으로 우회 처리됨.

---

## 최적화 전략

### 1. STT 지연 최적화

#### 1-1. base64 인코딩 성능 개선 (frontend)

`String.fromCharCode` 루프를 `TextDecoder` 또는 `Uint8Array.reduce` 방식으로 교체한다.

```typescript
// 개선안: btoa(String.fromCharCode(...array)) - spread는 스택 오버플로 가능
// 안전한 방법: chunk 단위로 처리
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}
```

파일: `frontend/src/channels/transcription.ts`의 `sendAudioChunk` 함수

#### 1-2. TranscriptionJob 큐 우선순위 격상

`queue_as :default` → `queue_as :real_time`으로 변경하고, Solid Queue에서 real_time 큐를 높은 우선순위로 설정한다.

파일:
- `backend/app/jobs/transcription_job.rb`: `queue_as :real_time`
- `backend/config/queue.yml`: real_time 큐 추가, workers 수 조정

#### 1-3. SidecarClient HTTP persistent connection

`Net::HTTP`에 `keep_alive_timeout` 설정하거나, 연결 풀을 도입한다. 단순 개선으로는 연결 재사용을 위해 class-level 인스턴스 변수로 http 객체를 캐싱한다.

파일: `backend/app/services/sidecar_client.rb`

### 2. AI 요약 ≤ 10초 최적화

#### 2-1. LLMSummarizer async 전환

`anthropic.AsyncAnthropic`으로 교체하여 FastAPI 이벤트 루프 블로킹을 제거한다.

```python
# 개선안
from anthropic import AsyncAnthropic

class LLMSummarizer:
    def __init__(self, client=None):
        self._client = client or AsyncAnthropic(...)

    async def _call_llm(self, system, user_content, max_tokens):
        response = await self._client.messages.create(...)
        ...
```

파일: `sidecar/app/llm/summarizer.py`

#### 2-2. SummarizationJob 병렬 처리

현재 `find_each`로 회의를 직렬 처리하는 것을 회의별로 개별 Job으로 분리한다.

```ruby
# 개선안: 회의별 별도 Job 클래스
class MeetingSummarizationJob < ApplicationJob
  queue_as :summarization
  def perform(meeting_id)
    meeting = Meeting.find(meeting_id)
    # 단일 회의 요약
  end
end

# SummarizationJob: 디스패치만 담당
class SummarizationJob < ApplicationJob
  def perform
    Meeting.recording.ids.each do |id|
      MeetingSummarizationJob.perform_later(id)
    end
  end
end
```

파일:
- `backend/app/jobs/summarization_job.rb`
- `backend/app/jobs/meeting_summarization_job.rb` (신규)

### 3. 10명 동시 WebSocket 안정화

#### 3-1. Puma thread pool 확장

`RAILS_MAX_THREADS=10` 설정을 환경 변수로 조정 가능하게 한다. ActionCable은 스레드당 1개의 WebSocket 연결을 처리하므로 10명 기준 최소 10 threads가 필요하다.

파일: `.env.example`, `Procfile` 또는 `backend/config/puma.rb`

#### 3-2. Production SolidCable polling_interval 검토

현재 `polling_interval: 0.1.seconds` (100ms)로 설정되어 있다. 10명 × 3초마다 오디오 청크면 초당 약 33개 메시지가 cable DB에 기록된다. polling 간격이 충분하지만, cable DB를 별도 SQLite 파일로 분리하여 primary DB와의 write 경합을 방지한다 (이미 구현됨).

#### 3-3. ActionCable 인증 검증 강화

`TranscriptionChannel#subscribed`에서 meeting 존재 여부만 확인하고 팀 멤버십을 검증하지 않는다. 이는 보안 문제이자 잘못된 연결로 인한 부하 원인이다.

파일: `backend/app/channels/transcription_channel.rb`

### 4. SQLite 동시 쓰기 검증

WAL 모드와 busy_timeout=5000이 이미 설정되어 있다. 추가 최적화:

- `Transcript.create!` 대신 `insert_all` 사용을 검토하여 다중 세그먼트를 단일 트랜잭션으로 처리
- `database.yml`의 `max_connections` 를 `RAILS_MAX_THREADS`와 동일하게 유지 (이미 동기화됨)

---

## 버그 목록

### BUG-01: ActionCable 메서드명 불일치 (P0 - 실시간 STT 동작 불가)

| 항목 | 내용 |
|------|------|
| 위치 | `frontend/src/channels/transcription.ts:97` vs `backend/app/channels/transcription_channel.rb` |
| 증상 | 오디오 청크 전송 시 `perform('receive_audio')` 호출 → 채널에 해당 메서드 없음 → 조용히 무시됨 |
| 원인 | 프론트엔드에서 `receive_audio`로 호출하지만, 백엔드에는 `audio_chunk` 메서드만 존재 |
| 수정 | `transcription.ts`의 `subscription.perform('receive_audio', ...)` → `subscription.perform('audio_chunk', ...)` 로 변경 |

### BUG-02: Meeting start/stop API 미구현 (P0 - 회의 시작/종료 불가)

| 항목 | 내용 |
|------|------|
| 위치 | `backend/config/routes.rb` |
| 증상 | 회의 시작 버튼 클릭 시 404 응답, meeting status가 recording으로 변경되지 않음 |
| 원인 | `routes.rb`에 `meetings/:id/start`, `meetings/:id/stop` 라우트 미정의 |
| 수정 | routes.rb에 member 액션 추가, MeetingsController에 start/stop 액션 구현 |

### BUG-03: Meeting summary/transcripts REST API 미구현 (P1)

| 항목 | 내용 |
|------|------|
| 위치 | `backend/config/routes.rb`, `backend/app/controllers/api/v1/meetings_controller.rb` |
| 증상 | MeetingLivePage에서 회의 로드 시 summary/transcripts를 불러오지 못함 |
| 원인 | `meetings/:id/summary`, `meetings/:id/transcripts` 엔드포인트 미구현 |
| 수정 | routes.rb에 summary/transcripts member 라우트 추가, 해당 액션 구현 |

### BUG-04: LLMSummarizer async 컨텍스트에서 동기 호출 (P1)

| 항목 | 내용 |
|------|------|
| 위치 | `sidecar/app/llm/summarizer.py:82` |
| 증상 | `/summarize` 요청 중 이벤트 루프 블로킹 → 동시 `/transcribe` 처리 지연 |
| 원인 | `async def summarize`에서 동기 `self._client.messages.create` 직접 호출 |
| 수정 | `anthropic.AsyncAnthropic` + `await self._client.messages.create(...)` 로 전환 |

### BUG-05: TranscriptionChannel 팀 멤버십 미검증 (P1 - 보안)

| 항목 | 내용 |
|------|------|
| 위치 | `backend/app/channels/transcription_channel.rb:3~9` |
| 증상 | 로그인한 모든 사용자가 임의 meeting_id로 WebSocket 구독 가능 |
| 원인 | `subscribed`에서 Meeting 존재만 확인, 팀 멤버십 검증 없음 |
| 수정 | `current_user.teams.include?(meeting.team)` 검증 추가 |

### BUG-06: 오디오 업로드 엔드포인트 미구현 (P2)

| 항목 | 내용 |
|------|------|
| 위치 | `backend/config/routes.rb` |
| 증상 | 회의 종료 시 `onStop` 콜백으로 Blob이 생성되지만 업로드할 엔드포인트 없음 |
| 원인 | `useAudioRecorder.ts`의 `onStop(blob)` 콜백이 호출되지만, 실제 업로드 처리 미구현 |
| 수정 | `meetings/:id/audio` POST 엔드포인트 추가, `audio_file_path` 저장 |

---

## 구현 계획

### Phase 1: 핵심 버그 수정 (BUG-01, BUG-02, BUG-03)

#### backend/config/routes.rb

`meetings` resources에 start/stop/summary/transcripts member 액션 추가:

```ruby
resources :meetings, only: %i[show] do
  member do
    get  :export
    post :start        # BUG-02
    post :stop         # BUG-02
    get  :summary      # BUG-03
    get  :transcripts  # BUG-03
    post :audio        # BUG-06
  end
  resources :blocks, ...
end
```

#### backend/app/controllers/api/v1/meetings_controller.rb

`start`, `stop`, `summary`, `transcripts` 액션 추가:

- `start`: meeting.update!(status: 'recording', started_at: Time.current), SummarizationJob 스케줄 트리거
- `stop`: meeting.update!(status: 'completed', ended_at: Time.current), MeetingFinalizerService 호출
- `summary`: meeting.summaries.order(generated_at: :desc).first 반환
- `transcripts`: meeting.transcripts.order(:sequence_number) 페이지네이션 반환

#### frontend/src/channels/transcription.ts

`sendAudioChunk` 함수 수정:

```typescript
// BUG-01: receive_audio → audio_chunk
subscription.perform('audio_chunk', { data: base64, sequence: seq })

// base64 성능 개선
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}
```

### Phase 2: STT 지연 최적화

#### backend/app/channels/transcription_channel.rb

팀 멤버십 검증 추가 (BUG-05), `perform_now` 옵션 검토:

```ruby
def subscribed
  meeting = Meeting.find_by(id: params[:meeting_id])
  if meeting && current_user.teams.include?(meeting.team)
    @meeting_id = meeting.id
    stream_from "meeting_#{meeting.id}_transcription"
  else
    reject
  end
end
```

#### backend/app/jobs/transcription_job.rb

큐 우선순위 높임:

```ruby
queue_as :real_time
```

#### backend/config/queue.yml

real_time 큐 worker 추가 (우선순위 10 = 가장 높음):

```yaml
dispatchers:
  - polling_interval: 0.1
    batch_size: 500

workers:
  - queues: real_time
    threads: 5
    processes: 1
  - queues: default
    threads: 3
    processes: 1
  - queues: summarization
    threads: 2
    processes: 1
```

#### backend/app/services/sidecar_client.rb

HTTP persistent connection (연결 재사용):

```ruby
# 클래스 수준 연결 풀 or keep-alive 설정
def with_connection
  http = Net::HTTP.new(@host, @port)
  http.open_timeout = TIMEOUT
  http.read_timeout = TIMEOUT
  http.keep_alive_timeout = 30
  http.start { |conn| yield conn }
  ...
end
```

### Phase 3: AI 요약 최적화

#### sidecar/app/llm/summarizer.py

`anthropic.AsyncAnthropic`으로 전환:

```python
import anthropic

class LLMSummarizer:
    def __init__(self, client=None):
        self._client = client or self._build_client()

    @staticmethod
    def _build_client():
        kwargs = {"api_key": settings.ANTHROPIC_AUTH_TOKEN}
        if settings.ANTHROPIC_BASE_URL:
            kwargs["base_url"] = settings.ANTHROPIC_BASE_URL
        return anthropic.AsyncAnthropic(**kwargs)

    async def _call_llm(self, system, user_content, max_tokens):
        try:
            response = await self._client.messages.create(
                model=settings.LLM_MODEL,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user_content}],
            )
            return json.loads(_extract_json(response.content[0].text))
        except (json.JSONDecodeError, KeyError, IndexError):
            return None
```

#### backend/app/jobs/meeting_summarization_job.rb (신규)

회의별 독립 Job:

```ruby
class MeetingSummarizationJob < ApplicationJob
  queue_as :summarization

  def perform(meeting_id)
    meeting = Meeting.find_by(id: meeting_id)
    return unless meeting&.recording?
    # 기존 SummarizationJob의 summarize_meeting 로직 이동
  end
end
```

### Phase 4: 동시 접속 안정화

#### Procfile 또는 .env.example

```
RAILS_MAX_THREADS=10
WEB_CONCURRENCY=1
```

#### backend/config/puma.rb

환경 변수 기반 thread 수 조정 주석 강화 (기존 코드 활용, 변경 불필요)

### Phase 5: 성능 측정 및 검증

#### tests/ 또는 e2e/tests/ 에 성능 테스트 추가

`e2e/tests/performance.spec.ts` (신규):
- STT 지연 측정: mock STT 응답 타임스탬프 기록 → `performance.now()` 기반 3초 이내 검증
- 10 병렬 WebSocket: Playwright multiple contexts 사용하여 동시 접속 시뮬레이션
- 요약 응답 시간: summarize API 응답 시간 측정

---

## 파일별 변경 요약

| 파일 | 변경 유형 | 내용 |
|------|----------|------|
| `frontend/src/channels/transcription.ts` | 수정 | `receive_audio` → `audio_chunk`, base64 인코딩 최적화 |
| `backend/config/routes.rb` | 수정 | start/stop/summary/transcripts/audio 엔드포인트 추가 |
| `backend/app/controllers/api/v1/meetings_controller.rb` | 수정 | start/stop/summary/transcripts/audio 액션 구현 |
| `backend/app/channels/transcription_channel.rb` | 수정 | 팀 멤버십 검증 추가 |
| `backend/app/jobs/transcription_job.rb` | 수정 | `queue_as :real_time` |
| `backend/app/jobs/meeting_summarization_job.rb` | 신규 | 회의별 독립 요약 Job |
| `backend/app/jobs/summarization_job.rb` | 수정 | 디스패치 전용으로 리팩터링 |
| `backend/app/services/sidecar_client.rb` | 수정 | HTTP keep-alive 추가 |
| `backend/config/queue.yml` | 수정 | real_time/summarization 큐 worker 설정 |
| `sidecar/app/llm/summarizer.py` | 수정 | `AsyncAnthropic` 전환 |
| `e2e/tests/performance.spec.ts` | 신규 | 성능 측정 E2E 테스트 |
| `.env.example` | 수정 | `RAILS_MAX_THREADS=10` 추가 |

---

## 우선순위별 실행 순서

1. **P0 (즉시)**: BUG-01 ActionCable 메서드명 + BUG-02 start/stop API → 실시간 STT 파이프라인 기본 동작 확보
2. **P0 (즉시)**: BUG-03 summary/transcripts API → MeetingLivePage 완전 동작
3. **P1**: BUG-04 LLMSummarizer async 전환 → AI 요약 지연 개선
4. **P1**: BUG-05 팀 멤버십 검증 → 보안 강화
5. **P1**: base64 인코딩 최적화 + TranscriptionJob 큐 우선순위 → STT 지연 ≤ 3초
6. **P1**: SummarizationJob 병렬화 → 요약 ≤ 10초
7. **P2**: Puma thread 확장 + 성능 측정 테스트 → 10명 동시 접속 검증
8. **P2**: BUG-06 오디오 업로드 → 녹음 저장 완성
