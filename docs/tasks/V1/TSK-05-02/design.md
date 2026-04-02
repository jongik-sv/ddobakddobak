# TSK-05-02: SummarizationJob 및 실시간 요약 - 설계

## 구현 방향

Solid Queue recurring job으로 등록된 `SummarizationJob`이 5분 간격으로 실행되어, `recording` 상태인 모든 회의의 최근 5분 트랜스크립트를 조회하고 `SidecarClient`를 통해 `/summarize` (realtime 타입)를 호출한다. 결과는 `summaries` 테이블에 upsert되고, 기존 `TranscriptionChannel`이 사용하는 동일 ActionCable 스트림(`meeting_#{id}_transcription`)으로 `summary_update` 이벤트를 브로드캐스트한다. 회의 종료(status → 'completed') 시에는 `MeetingFinalizerService`가 전체 트랜스크립트를 대상으로 `/summarize` (final 타입)와 `/summarize/action-items`를 순차 호출하여 최종 Summary와 ActionItem 레코드를 생성한다.

---

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|---|---|---|
| `backend/app/jobs/summarization_job.rb` | 5분 간격 실시간 요약 실행 (Solid Queue recurring) | 신규 |
| `backend/app/services/meeting_finalizer_service.rb` | 회의 종료 시 최종 요약 + Action Items 생성 | 신규 |
| `backend/app/channels/transcription_channel.rb` | `summary_update` 브로드캐스트 헬퍼 추가 | 수정 |
| `backend/app/services/sidecar_client.rb` | `summarize` / `summarize_action_items` 시그니처 수정 (transcripts 직접 전달) | 수정 |
| `backend/config/recurring.yml` | SummarizationJob 5분 간격 recurring 등록 | 신규 |
| `backend/spec/jobs/summarization_job_spec.rb` | SummarizationJob 단위 테스트 | 신규 |
| `backend/spec/services/meeting_finalizer_service_spec.rb` | MeetingFinalizerService 단위 테스트 | 신규 |

---

## 주요 구조

```ruby
# app/jobs/summarization_job.rb
class SummarizationJob < ApplicationJob
  queue_as :default

  def perform
    Meeting.recording.find_each do |meeting|
      summarize_meeting(meeting)
    end
  end

  private

  def summarize_meeting(meeting)
    # 최근 5분 트랜스크립트 조회
    since_ms = (Time.current - 5.minutes).to_i * 1000
    transcripts = meeting.transcripts
                         .where("started_at_ms >= ?", since_ms)
                         .order(:sequence_number)
    return if transcripts.empty?

    client = SidecarClient.new
    result = client.summarize(transcripts_payload(transcripts), type: "realtime")

    # summaries 테이블 upsert (realtime 타입)
    summary = meeting.summaries.find_or_initialize_by(summary_type: "realtime")
    summary.update!(
      key_points:         result["key_points"],
      decisions:          result["decisions"],
      discussion_details: result["discussion_details"],
      generated_at:       Time.current
    )

    broadcast_summary_update(meeting, result)
  rescue SidecarClient::SidecarError => e
    Rails.logger.error "[SummarizationJob] meeting=#{meeting.id} error=#{e.message}"
  end

  def broadcast_summary_update(meeting, result)
    ActionCable.server.broadcast(
      "meeting_#{meeting.id}_transcription",
      {
        type:       "summary_update",
        key_points: result["key_points"],
        decisions:  result["decisions"]
      }
    )
  end

  def transcripts_payload(transcripts)
    transcripts.map do |t|
      { speaker: t.speaker_label, text: t.content, started_at_ms: t.started_at_ms }
    end
  end
end
```

```ruby
# app/services/meeting_finalizer_service.rb
class MeetingFinalizerService
  def initialize(meeting)
    @meeting = meeting
    @client  = SidecarClient.new
  end

  def call
    transcripts = @meeting.transcripts.order(:sequence_number)
    return if transcripts.empty?

    payload = transcripts_payload(transcripts)

    # 최종 요약 생성
    summary_result = @client.summarize(payload, type: "final")
    save_final_summary(summary_result)

    # Action Items 추출
    items_result = @client.summarize_action_items(payload)
    save_action_items(items_result["action_items"] || [])

    broadcast_final_summary(summary_result)
  rescue SidecarClient::SidecarError => e
    Rails.logger.error "[MeetingFinalizerService] meeting=#{@meeting.id} error=#{e.message}"
  end

  private

  def save_final_summary(result)
    summary = @meeting.summaries.find_or_initialize_by(summary_type: "final")
    summary.update!(
      key_points:         result["key_points"],
      decisions:          result["decisions"],
      discussion_details: result["discussion_details"],
      generated_at:       Time.current
    )
  end

  def save_action_items(items)
    items.each do |item|
      @meeting.action_items.create!(
        content:      item["content"],
        status:       "todo",
        ai_generated: true
      )
    end
  end

  def broadcast_final_summary(result)
    ActionCable.server.broadcast(
      "meeting_#{@meeting.id}_transcription",
      {
        type:       "summary_update",
        key_points: result["key_points"],
        decisions:  result["decisions"]
      }
    )
  end

  def transcripts_payload(transcripts)
    transcripts.map do |t|
      { speaker: t.speaker_label, text: t.content, started_at_ms: t.started_at_ms }
    end
  end
end
```

```ruby
# config/recurring.yml  (Solid Queue recurring 등록)
summarization:
  class: SummarizationJob
  schedule: "*/5 * * * *"   # 5분 간격
  queue: default
```

```ruby
# SidecarClient 수정 — transcripts 직접 전달 방식으로 변경
def summarize(transcripts, type: "realtime", context: nil)
  body = { transcripts: transcripts, type: type }
  body[:context] = context if context
  post("/summarize", body)
end

def summarize_action_items(transcripts)
  post("/summarize/action-items", { transcripts: transcripts })
end
```

```ruby
# MeetingsController (회의 종료 엔드포인트) — 기존 코드에 추가
def complete
  @meeting = Meeting.find(params[:id])
  @meeting.update!(status: "completed", ended_at: Time.current)
  MeetingFinalizerService.new(@meeting).call
  render json: MeetingSerializer.new(@meeting)
end
```

---

## 데이터 흐름

### 실시간 요약 (SummarizationJob)

1. Solid Queue가 `recurring.yml` 스케줄에 따라 5분마다 `SummarizationJob#perform` 실행
2. `Meeting.recording.find_each`로 현재 녹음 중인 회의 전체 순회
3. 각 회의에서 `started_at_ms >= now - 5min` 조건으로 최근 트랜스크립트 조회
4. 트랜스크립트가 없으면 스킵, 있으면 `SidecarClient#summarize(payload, type: "realtime")` HTTP POST 호출
5. 응답의 `key_points`, `decisions`, `discussion_details`를 `summaries` 테이블에 upsert (`summary_type: "realtime"`)
6. `ActionCable.server.broadcast`로 `{ type: "summary_update", key_points, decisions }` 브로드캐스트
7. 클라이언트(React)의 ActionCable 구독자가 이벤트를 수신하여 AI 요약 패널 갱신

### 최종 요약 (MeetingFinalizerService)

1. 클라이언트가 회의 종료 API 호출 (`PATCH /api/v1/meetings/:id/complete` 등)
2. `MeetingsController`에서 `meeting.status = "completed"`, `ended_at = Time.current` 저장
3. `MeetingFinalizerService.new(meeting).call` 동기 호출
4. 전체 트랜스크립트를 `sequence_number` 순으로 조회하여 payload 구성
5. `SidecarClient#summarize(payload, type: "final")` 호출 → `summaries` 테이블에 `summary_type: "final"` upsert
6. `SidecarClient#summarize_action_items(payload)` 호출 → `action_items` 테이블에 `ai_generated: true` 레코드 생성
7. 최종 요약 결과를 동일 채널로 `summary_update` 브로드캐스트

---

## SummarizationJob 설계 상세

### Solid Queue Recurring 등록

`config/recurring.yml`에 `summarization` 키로 등록한다. Rails 8의 Solid Queue는 `config/recurring.yml`을 자동으로 읽어 cron 형식 스케줄로 등록한다.

```yaml
summarization:
  class: SummarizationJob
  schedule: "*/5 * * * *"
  queue: default
```

### 트랜스크립트 조회 범위

5분 간격 실행이므로, 최근 5분(`Time.current - 5.minutes`)의 트랜스크립트만 조회한다. `started_at_ms`는 밀리초 단위이므로 `* 1000` 변환이 필요하다.

```ruby
since_ms = (Time.current - 5.minutes).to_i * 1000
```

### 에러 처리

`SidecarClient::SidecarError` (타임아웃, 연결 실패, HTTP 오류 포함)를 rescue하여 로그 기록 후 다음 회의로 진행한다. 개별 회의의 실패가 다른 회의 처리를 막지 않도록 `find_each` 루프 내 `summarize_meeting`에서 rescue한다.

### Summary upsert 전략

`summary_type: "realtime"`으로 `find_or_initialize_by`를 사용하여 항상 하나의 realtime 요약 레코드만 유지한다. 5분마다 해당 레코드를 덮어쓰는 방식으로, 히스토리가 필요하면 별도 컬럼(`updated_count` 등)을 추가한다.

---

## MeetingFinalizerService 설계 상세

### 호출 시점

`MeetingsController#complete` 액션에서 `meeting.status`를 `"completed"`로 변경한 직후 동기 호출한다. 요약 생성 시간이 길 수 있으므로 추후 `perform_later`로 비동기화를 검토할 수 있으나, 초기 구현에서는 동기 호출로 단순하게 처리한다.

### SidecarClient 호출 순서

1. `POST /summarize` (type: "final") — key_points, decisions, discussion_details 포함한 최종 요약
2. `POST /summarize/action-items` — Action Item 배열 추출

두 호출은 순차 실행한다. 첫 번째 호출 실패 시 `SidecarError`가 propagate되어 두 번째 호출이 실행되지 않는다.

### ActionItem 생성

`ai_generated: true`로 생성하며, `assignee_id`와 `due_date`는 LLM 응답의 `assignee_hint`, `due_date_hint`를 파싱하여 설정할 수 있으나, 초기 구현에서는 `content`만 저장하고 나머지는 사용자가 수동 설정하도록 한다.

---

## TranscriptionChannel 수정

기존 `TranscriptionChannel`은 이미 `meeting_#{meeting.id}_transcription` 스트림을 구독하고 있다. 새로운 `summary_update` 이벤트는 **동일 스트림**으로 브로드캐스트하므로, 채널 코드 자체를 수정할 필요는 없다. 클라이언트 측에서 `received` 콜백의 `type` 필드로 `transcript` 이벤트와 `summary_update` 이벤트를 구분한다.

클라이언트가 수신하는 이벤트 형식:

```json
// 기존 트랜스크립트 이벤트
{ "type": "final", "text": "...", "speaker": "SPEAKER_00", "started_at_ms": 0, "ended_at_ms": 2000, "seq": 1 }

// 신규 요약 이벤트
{ "type": "summary_update", "key_points": "...", "decisions": "..." }
```

---

## 테스트 전략

### SummarizationJob 단위 테스트

- `recording` 상태 회의가 있을 때 `SidecarClient#summarize` 호출 여부 확인
- 최근 5분 내 트랜스크립트가 없으면 `summarize`가 호출되지 않음
- `SidecarClient::SidecarError` 발생 시 다른 회의 처리가 계속됨
- `ActionCable.server.broadcast` 호출 시 올바른 채널명과 payload 확인
- `summaries` 테이블에 `summary_type: "realtime"` 레코드 upsert 확인

```ruby
# spec/jobs/summarization_job_spec.rb
RSpec.describe SummarizationJob, type: :job do
  let(:meeting) { create(:meeting, status: "recording") }
  let(:client_double) { instance_double(SidecarClient) }

  before do
    allow(SidecarClient).to receive(:new).and_return(client_double)
    allow(client_double).to receive(:summarize).and_return(
      { "key_points" => "key", "decisions" => "dec", "discussion_details" => "" }
    )
  end

  it "calls summarize for recording meetings with recent transcripts" do
    create(:transcript, meeting: meeting, started_at_ms: (Time.current.to_i - 60) * 1000)
    expect(client_double).to receive(:summarize)
    described_class.new.perform
  end

  it "skips meetings with no recent transcripts" do
    expect(client_double).not_to receive(:summarize)
    described_class.new.perform
  end

  it "broadcasts summary_update to the correct channel" do
    create(:transcript, meeting: meeting, started_at_ms: (Time.current.to_i - 60) * 1000)
    expect(ActionCable.server).to receive(:broadcast).with(
      "meeting_#{meeting.id}_transcription",
      hash_including(type: "summary_update")
    )
    described_class.new.perform
  end
end
```

### MeetingFinalizerService 단위 테스트

- 전체 트랜스크립트를 payload로 `summarize(type: "final")` 호출 확인
- `summarize_action_items` 호출 확인
- `summaries` 테이블에 `summary_type: "final"` 레코드 생성 확인
- `action_items` 테이블에 `ai_generated: true` 레코드 생성 확인
- `SidecarError` 발생 시 rescue 후 로그 기록 확인

```ruby
# spec/services/meeting_finalizer_service_spec.rb
RSpec.describe MeetingFinalizerService do
  let(:meeting)       { create(:meeting, status: "completed") }
  let(:client_double) { instance_double(SidecarClient) }

  before do
    allow(SidecarClient).to receive(:new).and_return(client_double)
    allow(client_double).to receive(:summarize).and_return(
      { "key_points" => "kp", "decisions" => "dec", "discussion_details" => "dd" }
    )
    allow(client_double).to receive(:summarize_action_items).and_return(
      { "action_items" => [{ "content" => "item1" }] }
    )
    create(:transcript, meeting: meeting)
  end

  it "creates a final summary record" do
    expect { described_class.new(meeting).call }
      .to change { meeting.summaries.where(summary_type: "final").count }.by(1)
  end

  it "creates action items with ai_generated true" do
    expect { described_class.new(meeting).call }
      .to change { meeting.action_items.where(ai_generated: true).count }.by(1)
  end

  it "broadcasts summary_update" do
    expect(ActionCable.server).to receive(:broadcast).with(
      "meeting_#{meeting.id}_transcription",
      hash_including(type: "summary_update")
    )
    described_class.new(meeting).call
  end
end
```

### SidecarClient 수정 테스트

- `summarize` 메서드가 `{ transcripts:, type: }` body로 POST 전송 확인
- `summarize_action_items` 메서드가 `{ transcripts: }` body로 POST 전송 확인
