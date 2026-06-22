# 클라이언트 식별 토대 + 비정상 종료 녹음 자동 종결 — 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 또는 executing-plans 로 task 단위 구현. 각 step은 `- [ ]` 체크박스.

**Goal:** 강제종료/크래시로 `녹음중`에 고정된 회의를 recorder presence(하트비트) 부재로 자동 종결하고, 다음 단계(B/C)를 위한 client_id 식별 토대를 깐다.

**Architecture:** 녹음 클라가 ~15초마다 ActionCable `heartbeat`를 보내 `meetings.recorder_heartbeat_at`(DB)을 갱신. 회의 조회(index/show) 시 Puma 요청 경로에서 `recording`이고 하트비트가 90초+ 부재인 회의를 `stop`과 동일 시맨틱으로 종결. client_id/platform은 HTTP 헤더로 받아 녹음 시작 시 회의에 도장(B/C 토대).

**Tech Stack:** Rails 8 (rspec), React + TypeScript (vitest), ActionCable, ky.

## Global Constraints

- 기능 변경 0 외 기존 동작 보존. `stop` 종결 시맨틱과 동일(completed + ended_at + paused_at=nil + RecordingLock.clear + 전사 있으면 MeetingFinalizerJob/MeetingSummarizationJob(final)).
- `RECORDER_HEARTBEAT_STALE_AFTER = 90.seconds`. 하트비트 throttle 10초. 하트비트 인터벌 15초.
- presence 판정은 **client 무관**(하트비트 부재만). client_id는 A 판정에 사용 안 함.
- 하트비트 bump는 **owner/host role만**(viewer 무시).
- 마이그레이션은 단순 add_column → `disable_ddl_transaction!` 금지(불필요).
- 백엔드 dir `backend/`, 프론트 dir `frontend/`. 두 스트림 파일 비중첩 → 병렬 안전.
- 커밋 메시지 끝에 Co-Authored-By/Claude-Session 트레일러(기존 컨벤션).

---

# 스트림 BACKEND (`backend/`)

## Task B1: 마이그레이션 — meetings 컬럼 3개

**Files:**
- Create: `backend/db/migrate/<ts>_add_recorder_fields_to_meetings.rb`
- Modify: `backend/db/schema.rb` (마이그레이션 실행으로 자동)

- [ ] **Step 1: 마이그레이션 생성**

```ruby
class AddRecorderFieldsToMeetings < ActiveRecord::Migration[8.0]
  def change
    add_column :meetings, :recording_client_id, :string
    add_column :meetings, :recording_client_platform, :string
    add_column :meetings, :recorder_heartbeat_at, :datetime
  end
end
```
(파일명 타임스탬프는 `bin/rails g migration` 또는 기존 최신 마이그레이션보다 큰 값으로.)

- [ ] **Step 2: 실행**

Run: `cd backend && bin/rails db:migrate && RAILS_ENV=test bin/rails db:migrate`
Expected: schema.rb에 3컬럼 추가, 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add backend/db/migrate backend/db/schema.rb
git commit -m "feat(meetings): recorder_heartbeat_at + recording_client_id/platform 컬럼"
```

## Task B2: ApplicationController — client 헤더 헬퍼

**Files:**
- Modify: `backend/app/controllers/application_controller.rb`
- Test: `backend/spec/requests/api/v1/meetings_spec.rb` (B4에서 통합 검증)

**Interfaces:**
- Produces: `current_client_id` → `request.headers["X-Client-Id"].presence`, `current_client_platform` → `request.headers["X-Client-Platform"].presence`. private.

- [ ] **Step 1: 헬퍼 추가** (`private` 섹션, `parameter_missing` 아래)

```ruby
    def current_client_id
      request.headers["X-Client-Id"].presence
    end

    def current_client_platform
      request.headers["X-Client-Platform"].presence
    end
```

- [ ] **Step 2: 커밋** (B4와 함께 검증되므로 여기선 컴파일만)

```bash
cd backend && bin/rails runner 'puts "ok"'
git add backend/app/controllers/application_controller.rb
git commit -m "feat(api): current_client_id/platform 헤더 헬퍼"
```

## Task B3: Meeting 모델 — stale_recording? / heal_stale_recording!

**Files:**
- Modify: `backend/app/models/meeting.rb` (heal_stale_re_diarize! 근처, line ~226-233)
- Test: `backend/spec/models/meeting_stale_recording_spec.rb` (신규)

**Interfaces:**
- Consumes: B1 컬럼 `recorder_heartbeat_at`. `RecordingLock.clear`.
- Produces: `Meeting#stale_recording?` → Boolean, `Meeting#heal_stale_recording!` → 종결 수행(멱등), `Meeting::RECORDER_HEARTBEAT_STALE_AFTER`.

- [ ] **Step 1: 실패 테스트 작성** `backend/spec/models/meeting_stale_recording_spec.rb`

```ruby
require "rails_helper"

RSpec.describe Meeting, "stale recording reaper" do
  let(:user) { create(:user) }
  let(:project) { create(:project, creator: user) }

  def rec(heartbeat_at:, status: "recording")
    create(:meeting, project: project, creator: user, status: status,
                     started_at: 10.minutes.ago, recorder_heartbeat_at: heartbeat_at)
  end

  before { RecordingLock.reset! }

  describe "#stale_recording?" do
    it "fresh heartbeat(<90s) → false (활성 보호)" do
      expect(rec(heartbeat_at: 5.seconds.ago).stale_recording?).to be false
    end

    it "방금 시작(heartbeat=now) → false (시작직후 침묵 보호)" do
      expect(rec(heartbeat_at: Time.current).stale_recording?).to be false
    end

    it "heartbeat 90s+ 과거 → true" do
      expect(rec(heartbeat_at: 3.minutes.ago).stale_recording?).to be true
    end

    it "heartbeat nil(레거시/크래시) → true" do
      expect(rec(heartbeat_at: nil).stale_recording?).to be true
    end

    it "completed → false (recording 아님)" do
      expect(rec(heartbeat_at: nil, status: "completed").stale_recording?).to be false
    end
  end

  describe "#heal_stale_recording!" do
    it "stale → completed + ended_at + paused_at nil" do
      m = rec(heartbeat_at: nil)
      m.update_column(:paused_at, 5.minutes.ago)
      m.heal_stale_recording!
      m.reload
      expect(m.status).to eq("completed")
      expect(m.ended_at).to be_present
      expect(m.paused_at).to be_nil
    end

    it "활성(fresh) → no-op" do
      m = rec(heartbeat_at: 1.second.ago)
      expect { m.heal_stale_recording! }.not_to change { m.reload.status }
    end

    it "전사 있으면 finalize/summary enqueue" do
      m = rec(heartbeat_at: nil)
      create(:transcript, meeting: m)
      expect(MeetingFinalizerJob).to receive(:perform_later).with(m.id)
      expect(MeetingSummarizationJob).to receive(:perform_later).with(m.id, type: "final")
      m.heal_stale_recording!
    end

    it "전사 없으면 job 미enqueue" do
      m = rec(heartbeat_at: nil)
      expect(MeetingFinalizerJob).not_to receive(:perform_later)
      m.heal_stale_recording!
    end
  end
end
```
(transcript 팩토리명이 다르면 `spec/factories`에서 확인해 맞출 것.)

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/models/meeting_stale_recording_spec.rb`
Expected: FAIL (`stale_recording?` 미정의).

- [ ] **Step 3: 구현** (`meeting.rb`, `heal_stale_re_diarize!` 메서드 아래 삽입)

```ruby
  # 강제종료/크래시로 recording 에 고정된 회의 자가복구. recorder presence(하트비트)
  # 부재로만 판정 — 침묵과 무관(침묵은 클라측 silenceAutoComplete 가 stop 호출).
  # RecordingLock 미사용 이유: acquire 가 audio_chunk(발화)에서만 호출돼 시작직후 침묵에
  # holder 가 nil → 활성 녹음 오종결. 하트비트는 VAD/일시정지 무관하게 전송돼 정확.
  RECORDER_HEARTBEAT_STALE_AFTER = 90.seconds

  def stale_recording?
    return false unless recording?

    recorder_heartbeat_at.nil? || recorder_heartbeat_at < RECORDER_HEARTBEAT_STALE_AFTER.ago
  end

  def heal_stale_recording!
    return unless stale_recording?

    update!(status: "completed", ended_at: Time.current, paused_at: nil)
    RecordingLock.clear(id)

    if transcripts.exists?
      MeetingFinalizerJob.perform_later(id)
      MeetingSummarizationJob.perform_later(id, type: "final")
    end
  end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/models/meeting_stale_recording_spec.rb`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add backend/app/models/meeting.rb backend/spec/models/meeting_stale_recording_spec.rb
git commit -m "feat(meetings): stale_recording? + heal_stale_recording! presence 자가복구"
```

## Task B4: start 액션 도장 + index/show lazy heal

**Files:**
- Modify: `backend/app/controllers/api/v1/meetings_controller.rb` (start ~line 271; before_action ~line 19; index ~line 21-26)
- Test: `backend/spec/requests/api/v1/meetings_stale_recording_spec.rb` (신규)

**Interfaces:**
- Consumes: B2 `current_client_id`/`current_client_platform`, B3 `heal_stale_recording!`.

- [ ] **Step 1: 실패 테스트** `backend/spec/requests/api/v1/meetings_stale_recording_spec.rb`

```ruby
require "rails_helper"

RSpec.describe "Stale recording reaper (requests)", type: :request do
  let(:user) { create(:user) }
  let(:project) { create(:project, creator: user) }
  let(:headers) { auth_headers_for(user) } # 기존 헬퍼 사용(없으면 meetings_spec 패턴 따름)

  before { RecordingLock.reset! }

  it "GET show 시 stale recording 자동 종결" do
    m = create(:meeting, project: project, creator: user, status: "recording",
               started_at: 10.minutes.ago, recorder_heartbeat_at: nil)
    get "/api/v1/meetings/#{m.id}", headers: headers
    expect(m.reload.status).to eq("completed")
  end

  it "GET index 시 stale recording 자동 종결, 활성은 보존" do
    stale  = create(:meeting, project: project, creator: user, status: "recording",
                    started_at: 10.minutes.ago, recorder_heartbeat_at: nil)
    active = create(:meeting, project: project, creator: user, status: "recording",
                    started_at: 1.minute.ago, recorder_heartbeat_at: 2.seconds.ago)
    get "/api/v1/meetings", headers: headers
    expect(stale.reload.status).to eq("completed")
    expect(active.reload.status).to eq("recording")
  end

  it "POST start 가 recording_client_id/platform/heartbeat 도장" do
    m = create(:meeting, project: project, creator: user, status: "pending")
    post "/api/v1/meetings/#{m.id}/start",
         headers: headers.merge("X-Client-Id" => "dev-uuid-1", "X-Client-Platform" => "desktop")
    m.reload
    expect(m.status).to eq("recording")
    expect(m.recording_client_id).to eq("dev-uuid-1")
    expect(m.recording_client_platform).to eq("desktop")
    expect(m.recorder_heartbeat_at).to be_present
  end
end
```
(인증 헤더 헬퍼는 기존 `spec/requests/api/v1/meetings_spec.rb`의 방식을 그대로 차용할 것.)

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_stale_recording_spec.rb`
Expected: FAIL.

- [ ] **Step 3: 구현**

(a) `start` 액션 — line ~271:
```ruby
        @meeting.update!(
          status: :recording,
          started_at: Time.current,
          recording_client_id: current_client_id,
          recording_client_platform: current_client_platform,
          recorder_heartbeat_at: Time.current
        )
```

(b) show before_action — line ~19 확장:
```ruby
      before_action -> { @meeting&.heal_stale_re_diarize! }, only: %i[show re_diarize]
      before_action -> { @meeting&.heal_stale_recording! }, only: %i[show]
```

(c) index — 본문 맨 앞(line ~22 `scope = ...` 직전)에 lazy heal:
```ruby
      def index
        # 비정상 종료된 recording 회의 자가복구(접근 가능 스코프 한정, 카운트보다 먼저).
        Meeting.accessible_by(current_user).where(status: :recording).find_each(&:heal_stale_recording!)

        scope = Meeting.accessible_by(current_user)
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/requests/api/v1/meetings_stale_recording_spec.rb`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add backend/app/controllers
git commit -m "feat(meetings): start client 도장 + index/show stale recording lazy heal"
```

## Task B5: TranscriptionChannel — heartbeat

**Files:**
- Modify: `backend/app/channels/transcription_channel.rb`
- Test: `backend/spec/channels/transcription_channel_spec.rb` (append)

**Interfaces:**
- Produces: 채널 `heartbeat` 액션. `recorder_heartbeat_at` 갱신은 owner/host + recording? 일 때만, 10초 throttle.

- [ ] **Step 1: 실패 테스트** (append to transcription_channel_spec.rb)

```ruby
  describe "#heartbeat" do
    before { RecordingLock.reset! }

    it "owner 가 recording 회의에 heartbeat → recorder_heartbeat_at 갱신" do
      meeting.update!(status: "recording", started_at: 1.minute.ago, recorder_heartbeat_at: nil)
      subscribe(meeting_id: meeting.id)
      perform(:heartbeat)
      expect(meeting.reload.recorder_heartbeat_at).to be_present
    end

    it "10초 이내 재호출은 미갱신(throttle)" do
      ts = 3.seconds.ago
      meeting.update!(status: "recording", started_at: 1.minute.ago, recorder_heartbeat_at: ts)
      subscribe(meeting_id: meeting.id)
      perform(:heartbeat)
      expect(meeting.reload.recorder_heartbeat_at).to be_within(1.second).of(ts)
    end

    it "viewer heartbeat → 미갱신" do
      viewer = create(:user)
      create(:meeting_participant, meeting: meeting, user: viewer, role: "viewer", joined_at: Time.current)
      meeting.update!(status: "recording", started_at: 1.minute.ago, recorder_heartbeat_at: nil)
      stub_connection current_user: viewer
      subscribe(meeting_id: meeting.id)
      perform(:heartbeat)
      expect(meeting.reload.recorder_heartbeat_at).to be_nil
    end
  end
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && bundle exec rspec spec/channels/transcription_channel_spec.rb -e heartbeat`
Expected: FAIL.

- [ ] **Step 3: 구현** (`transcription_channel.rb`)

`subscribed` 안, `notify_if_recording_in_progress(meeting)` 다음 줄에:
```ruby
      bump_recorder_heartbeat
```
`audio_chunk` 안, 성공 경로(`TranscriptionJob.perform_later` 직전 또는 직후)에 `bump_recorder_heartbeat` 추가.

public 액션 추가(`unsubscribed` 다음):
```ruby
  def heartbeat(_data = {})
    bump_recorder_heartbeat
  end
```

private 메서드 추가:
```ruby
  # 녹음 클라 생존 신호. owner/host + recording 일 때만, 10초 throttle 로 DB 갱신.
  def bump_recorder_heartbeat
    return unless @meeting_id
    return unless %w[owner host].include?(@role)

    meeting = Meeting.find_by(id: @meeting_id)
    return unless meeting&.recording?

    last = meeting.recorder_heartbeat_at
    return if last.present? && last > 10.seconds.ago

    meeting.update_column(:recorder_heartbeat_at, Time.current)
  end
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && bundle exec rspec spec/channels/transcription_channel_spec.rb`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add backend/app/channels/transcription_channel.rb backend/spec/channels/transcription_channel_spec.rb
git commit -m "feat(channel): recorder heartbeat (owner/host, 10s throttle)"
```

## Task B6: 백엔드 전체 회귀

- [ ] **Step 1:** `cd backend && bundle exec rspec` → 전부 green 확인(기존 + 신규). 실패 시 원인 수정.
- [ ] **Step 2 커밋**(필요 시): `git commit -am "test(meetings): stale recording 회귀 green"`

---

# 스트림 FRONTEND (`frontend/`)

## Task F1: clientId 유틸

**Files:**
- Create: `frontend/src/lib/clientId.ts`
- Test: `frontend/src/lib/clientId.test.ts`

**Interfaces:**
- Produces: `getClientId(): string` (localStorage `ddobak_client_id` get-or-create UUID), `getClientPlatform(): 'desktop'|'mobile'|'web'`.

- [ ] **Step 1: 실패 테스트** `frontend/src/lib/clientId.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('clientId', () => {
  beforeEach(() => localStorage.clear())

  it('getClientId 가 UUID 를 생성·영속하고 멱등', async () => {
    const { getClientId } = await import('./clientId')
    const a = getClientId()
    expect(a).toMatch(/[0-9a-f-]{36}/)
    expect(getClientId()).toBe(a) // 같은 값 재사용
    expect(localStorage.getItem('ddobak_client_id')).toBe(a)
  })

  it('getClientPlatform 은 web (테스트 환경)', async () => {
    const { getClientPlatform } = await import('./clientId')
    expect(['web', 'desktop', 'mobile']).toContain(getClientPlatform())
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/clientId.test.ts`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현** `frontend/src/lib/clientId.ts`

```ts
import { IS_TAURI, IS_MOBILE } from '../config'

const KEY = 'ddobak_client_id'

/** 기기/브라우저별 안정적 클라이언트 ID. 없으면 생성·영속(localStorage). */
export function getClientId(): string {
  let id = localStorage.getItem(KEY)
  if (!id) {
    id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    localStorage.setItem(KEY, id)
  }
  return id
}

export function getClientPlatform(): 'desktop' | 'mobile' | 'web' {
  if (IS_MOBILE) return 'mobile'
  if (IS_TAURI) return 'desktop'
  return 'web'
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/clientId.test.ts`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/clientId.ts frontend/src/lib/clientId.test.ts
git commit -m "feat(client): getClientId/getClientPlatform 식별 유틸"
```

## Task F2: API 클라이언트 헤더 주입

**Files:**
- Modify: `frontend/src/api/client.ts`
- Test: `frontend/src/api/__tests__/client.test.ts` (append, beforeRequest 검증 패턴 차용)

**Interfaces:**
- Consumes: F1 `getClientId`/`getClientPlatform`.

- [ ] **Step 1: 실패 테스트** (append) — beforeRequest 가 `X-Client-Id`/`X-Client-Platform` 세팅하는지 검증. 기존 `client.test.ts:51` 패턴을 그대로 따라 작성:

```ts
  it('beforeRequest 가 X-Client-Id/Platform 헤더를 세팅한다', async () => {
    // 기존 beforeRequest 테스트와 동일한 방식으로 request.headers 검사
    // (apiClient 의 hooks.beforeRequest[0] 직접 호출 또는 mock fetch 검사)
  })
```
(기존 테스트가 hooks를 어떻게 검사하는지 읽고 동일 스타일로 실제 단언을 채울 것 — 플레이스홀더 금지.)

- [ ] **Step 2: 구현**

`client.ts` import 추가:
```ts
import { getClientId, getClientPlatform } from '../lib/clientId'
```
beforeRequest hook 안(Authorization 세팅 다음)에:
```ts
        request.headers.set('X-Client-Id', getClientId())
        request.headers.set('X-Client-Platform', getClientPlatform())
```
`getAuthHeaders()` 도 client 헤더 포함하도록 확장:
```ts
export function getAuthHeaders(): HeadersInit {
  const { accessToken } = useAuthStore.getState()
  return {
    'X-Client-Id': getClientId(),
    'X-Client-Platform': getClientPlatform(),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  }
}
```

- [ ] **Step 3: 통과 확인**

Run: `cd frontend && npx vitest run src/api/__tests__/client.test.ts`
Expected: PASS.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/api/client.ts frontend/src/api/__tests__/client.test.ts
git commit -m "feat(client): X-Client-Id/Platform 헤더 주입"
```

## Task F3: 하트비트 전송

**Files:**
- Modify: `frontend/src/channels/transcription.ts` (sendHeartbeat 추가)
- Modify: `frontend/src/hooks/useTranscription.ts` (15초 인터벌)
- Test: `frontend/src/channels/transcription.heartbeat.test.ts` (신규, 가능 시) — 최소: sendHeartbeat 가 `subscription.perform('heartbeat', {})` 호출.

**Interfaces:**
- Produces: `sendHeartbeat(subscription: Subscription): void`.

- [ ] **Step 1: 실패 테스트** `frontend/src/channels/transcription.heartbeat.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'
import { sendHeartbeat } from './transcription'

describe('sendHeartbeat', () => {
  it("subscription.perform('heartbeat') 호출", () => {
    const perform = vi.fn()
    sendHeartbeat({ perform } as unknown as import('@rails/actioncable').Subscription)
    expect(perform).toHaveBeenCalledWith('heartbeat', {})
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/channels/transcription.heartbeat.test.ts`
Expected: FAIL.

- [ ] **Step 3: 구현**

(a) `channels/transcription.ts` — `sendAudioChunk` 근처에 추가:
```ts
export function sendHeartbeat(subscription: Subscription): void {
  subscription.perform('heartbeat', {})
}
```
(b) `hooks/useTranscription.ts` — import 에 `sendHeartbeat` 추가, subscribe effect(line 44-57) 안에서 인터벌 추가:
```ts
    const subscription = createTranscriptionChannel(meetingId, consumer)
    subscriptionRef.current = subscription

    sendHeartbeat(subscription) // 즉시 1회
    const hb = setInterval(() => {
      if (subscriptionRef.current) sendHeartbeat(subscriptionRef.current)
    }, 15_000)

    return () => {
      clearInterval(hb)
      subscription.unsubscribe()
      consumer.disconnect()
      consumerRef.current = null
      subscriptionRef.current = null
    }
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/channels/transcription.heartbeat.test.ts src/hooks/useTranscription.test.ts`
Expected: PASS (useTranscription 기존 테스트 회귀 없음 — 인터벌이 perform 호출 늘려도 기존 단언 깨지지 않는지 확인, 깨지면 mock 보강).

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/channels/transcription.ts frontend/src/hooks/useTranscription.ts frontend/src/channels/transcription.heartbeat.test.ts
git commit -m "feat(client): 녹음 하트비트 15초 전송"
```

## Task F4: 프론트 전체 회귀

- [ ] **Step 1:** `cd frontend && npx vitest run` → 전부 green. 실패 시 수정.
- [ ] **Step 2:** `cd frontend && npx tsc --noEmit` (또는 프로젝트 타입체크 명령) → 신규 타입에러 0.

---

# 통합 검증 (양 스트림 머지 후)

- [ ] 백엔드 `bundle exec rspec` green.
- [ ] 프론트 `npx vitest run` green + 타입체크.
- [ ] 수동 스모크(사용자): #207 — index 로딩 시 자동 종결되는지(dev 서버 재시작 후).

## 비목표
- B(백그라운드 녹음)·C(자동시작 게이팅) 미구현(스펙 §5 메모).
- 주기 잡 리퍼 미도입(lazy 로 충분).
- cable 구독 params 에 client_id 미추가(A 불필요 — B/C 때).
