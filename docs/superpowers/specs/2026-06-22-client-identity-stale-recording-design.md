# 클라이언트 식별 토대 + 비정상 종료 녹음 자동 종결 — 설계

- 날짜: 2026-06-22
- 브랜치: `feat/client-identity-stale-recording`
- 상태: 하위프로젝트 1만 구현 대상 (B·C는 메모로만)

## 배경 / 문제

회의 #207이 실제 회의는 끝났는데 `녹음중(recording)` 상태로 영구 고정됨.

근본 원인:
- 회의 종료는 오직 `종료` 버튼 → `stop` API만 `completed`로 전환한다.
- 앱/탭이 강제 종료·크래시되거나, 일시정지 후 방치되면 `stop`이 호출되지 않는다.
- ActionCable `unsubscribed`(연결 끊김)는 `RecordingLock`만 해제하고 **status는 건드리지 않는다**(공유 회의만 host grace 처리).
- 재diarize 정지에는 `heal_stale_re_diarize!` 자가복구가 있지만 **녹음 정지에는 자가복구가 없다**.

#207 실측(dev DB): `status=recording`, `started_at=07:39`, `ended_at=NULL`, `paused_at=07:40:33`, 전사 11건. 일시정지 후 앱이 닫혀 stuck.

기존 관련 메커니즘:
- `silenceAutoComplete`(`frontend/src/lib/silenceAutoComplete.ts`): **클라이언트 측** 5분 침묵 자동완료. 즉 **클라가 살아 있으면** 장시간 침묵은 클라가 처리해 `stop`을 호출한다.
- 따라서 본 리퍼가 잡아야 할 건 **클라가 죽은(크래시/강제종료) 경우**뿐이다. 판정 기준은 침묵이 아니라 **recorder presence(녹음 클라 생존 여부)**여야 한다.

## 사용자 요구 (대화로 확정)

전체 비전은 **클라이언트 식별(client identity)**을 토대로 한 3개 기능이며, 본 스펙은 **토대 + A**만 다룬다.

| 기능 | 내용 | 본 스펙 |
|------|------|:---:|
| **토대** | 기기/브라우저별 안정적 `client_id` | ✅ 최소 플럼빙 |
| **A. 크래시 복구** | 비정상 종료된 `녹음중` 회의 자동 종결 | ✅ |
| **B. 백그라운드 녹음** | 페이지 이동·탭/앱 닫아도 녹음 지속(데스크톱), 명시적 종결까지 | ❌ 다음 단계 |
| **C. 예약 자동시작 게이팅** | 예약한 컴퓨터에서만 자동시작 | ❌ 다음 단계 |

확정된 설계 결정:
- **식별 = 영구 UUID** (IP+UserID 비채택 — IP 불안정: 모바일/DHCP/VPN/NAT, 같은 공유기 2기기 구분 불가, 네트워크 이동 시 깨짐).
- **A presence 신호 = DB 하트비트** (RecordingLock 비채택 — 아래 §3.1 근거).
- **A 트리거 = Puma 요청경로 lazy heal** (주기 잡 비채택 — 아래 §3.3 근거).

## 하위프로젝트 1 — 설계

### 1. 클라이언트 식별 토대 (최소 플럼빙)

A는 client_id를 쓰지 않지만(presence 하트비트는 client 무관), 다음 단계 B/C의 토대를 지금 깔고 녹음에 도장을 찍어 감사/이력을 남긴다.

**프론트엔드** — `frontend/src/lib/clientId.ts` (신규)
- `getClientId(): string` — `localStorage["ddobak_client_id"]`에 UUID 없으면 `crypto.randomUUID()`로 생성·영속 후 반환. 웹·Tauri 웹뷰·모바일 웹뷰 공통. 시크릿창/캐시 삭제 시 새 id로 취급(허용).
- `getClientPlatform(): 'desktop'|'mobile'|'web'` — 기존 `IS_TAURI`(+모바일 판별)로 결정.
- 전달:
  - HTTP: api 클라이언트(ky 인스턴스) 1곳에 hook으로 헤더 `X-Client-Id`, `X-Client-Platform` 주입.
  - ActionCable: 구독 params에 `client_id`, `client_platform` 포함.

**백엔드**
- `ApplicationController`: `current_client_id`(= `request.headers["X-Client-Id"].presence`), `current_client_platform` 헬퍼.
- `start` 액션: `update!(status: :recording, started_at:, recording_client_id: current_client_id, recording_client_platform: current_client_platform)`.
- 별도 `clients` 테이블 없음 — client_id는 불투명 문자열, 회의에 기록만(YAGNI).

### 2. DB 마이그레이션

- `add_column :meetings, :recording_client_id, :string` (null 허용) — B/C 토대·감사
- `add_column :meetings, :recording_client_platform, :string` (null 허용) — B/C 토대·감사
- `add_column :meetings, :recorder_heartbeat_at, :datetime` (null 허용) — A presence
- 단순 add_column이므로 `disable_ddl_transaction!` 불필요. 인덱스 불필요(소량 `recording` 행만 스캔).

### 3. A — recorder presence 기반 stale-recording 자동 종결

#### 3.1 presence 신호 = DB 하트비트 (RecordingLock 아님)

`RecordingLock`을 쓰지 않는 이유:
- `RecordingLock.acquire`는 `audio_chunk`(=VAD 통과한 발화 청크)에서만 호출된다(`transcription_channel.rb:42`). **`subscribed`에서 획득하지 않음.**
- → 녹음 시작 직후 **침묵 구간**에는 `holder == nil`. 이때 "holder nil + 활동 stale"이 둘 다 참이 되어 **살아 있는 라이브 녹음을 오종결**한다. 이는 사용자가 "다른 사람이 실수로 녹음 완료 못 하게"라며 막으려던 바로 그 케이스.
- `RecordingLock`은 in-process(`Concurrent::Map`, 단일 Puma 워커 전제)라 크로스프로세스에서도 못 본다.

**하트비트 설계**
- 프론트(`useLiveRecording`): 녹음 활성 동안(=`recording`, **일시정지 포함**, VAD/침묵 무관) `~15초`마다 채널 `heartbeat` 전송. `stop`/언마운트/크래시 시 중단.
- 채널(`TranscriptionChannel`):
  - 신규 `heartbeat` 액션 → `bump_recorder_heartbeat`.
  - `subscribed`에서도 owner/host면 즉시 `bump_recorder_heartbeat` (시작 직후 공백 제거).
  - `audio_chunk`에서도 bump (공짜 하트비트).
  - `bump_recorder_heartbeat`: throttle — `recorder_heartbeat_at`이 nil이거나 `10초` 이전일 때만 `update_column(:recorder_heartbeat_at, Time.current)` (검증/콜백/updated_at 우회, 쓰기 폭주 방지).

#### 3.2 종결 로직 (모델 `Meeting`)

```ruby
RECORDER_HEARTBEAT_STALE_AFTER = 90.seconds  # 하트비트 ~15s, 수 회 누락 허용

# 녹음 클라가 사라진(크래시/강제종료/탭닫힘) recording 회의를 종결.
# presence(하트비트)로만 판정 — 침묵과 무관(침묵은 클라측 silenceAutoComplete가 처리).
def stale_recording?
  return false unless recording?
  recorder_heartbeat_at.nil? || recorder_heartbeat_at < RECORDER_HEARTBEAT_STALE_AFTER.ago
end

def heal_stale_recording!
  return unless stale_recording?

  update!(status: :completed, ended_at: Time.current, paused_at: nil)
  RecordingLock.clear(id)

  if transcripts.exists?
    MeetingFinalizerJob.perform_later(id)
    MeetingSummarizationJob.perform_later(id, type: "final")
  end
end
```

`stop` 액션과 동일한 종결 시맨틱(완료 + ended_at + lock clear + finalize/summary). 차이: 사용자 트리거가 아니라 자가복구 호출.

- `recorder_heartbeat_at.nil?` → #207·레거시(컬럼 신규)이고 하트비트도 안 오는 죽은 녹음 → 종결.
- 새로 시작한 녹음은 `subscribed`가 즉시 bump → nil 아님 → 시작 직후 침묵도 보호.

#### 3.3 트리거 = Puma 요청경로 lazy heal (주기 잡 아님)

주기 잡(`recurring.yml`)을 쓰지 않는 이유:
- prod는 `:solid_queue` → 잡이 **별도 워커 프로세스**에서 실행(in-process 상태 의존 위험; 본 설계는 DB 신호라 무관하지만 불필요).
- **dev는 `:async` + `bin/jobs` 미기동**(Procfile·dev.sh 확인) → 주기 잡 자체가 안 돈다. 그런데 #207은 dev에 있음. → 주기 잡은 dev에서 #207을 못 고친다.

lazy heal은 dev·prod 양쪽에서 동작하고, 사용자가 보는 목록을 그 자리에서 청소한다. 하트비트가 DB 컬럼이므로 Puma 요청 경로에서 읽어도 정확.

- `meetings#show`: `before_action -> { @meeting&.heal_stale_recording! }, only: %i[show]` (기존 `heal_stale_re_diarize!`와 동일 패턴/위치).
- `meetings#index`: 본문 진입 시 가장 먼저 **접근 가능 스코프 내** recording 회의만 heal:
  ```ruby
  accessible_scope.where(status: :recording).find_each(&:heal_stale_recording!)
  ```
  이후 status_counts·페이지 쿼리는 heal 커밋 이후 상태를 읽어 일관. 권한 스코프 한정이라 타유저 회의를 건드리지 않음(admin은 전체 — 의도된 모니터링).

### 4. 안전성 매트릭스 (presence 기준)

| 상황 | 하트비트 | 결과 |
|------|:--------:|------|
| 활성 라이브(앱 열림, 발화) | 최신 | skip(보호) |
| 활성 라이브, **시작 직후 침묵** | `subscribed`가 bump → 최신 | **skip(보호)** ← 기존 설계의 구멍 |
| 라이브, 5분 미만 침묵 | 최신(하트비트는 침묵 무관) | skip(보호) |
| 라이브, 5분+ 침묵 | 최신 | 클라 `silenceAutoComplete`가 `stop` 호출(별개 경로) |
| 일시정지 + 앱 열림 | 최신(일시정지 중도 전송) | skip(보호) |
| 페이지 리로드/네트워크 블립 | 90s 내 재개 | skip(보호) |
| 크래시/강제종료/탭닫힘(#207) | 90s+ 부재 | **종결** |
| 백그라운드 녹음(B 이후) | 백그라운드가 계속 전송 | skip(보호) |

리퍼는 **presence(하트비트 부재)**로만 판정하므로 `silenceAutoComplete`(침묵 5분)와 축이 달라 경쟁하지 않는다.

### 5. C·B를 위한 메모 (다음 단계 — 본 스펙 구현 대상 아님)

- **웹 예약 자동시작 금지**: 웹은 탭/브라우저 2개+ = 본질적 멀티 인스턴스라 자동시작이 중복 트리거되고, AudioContext가 사용자 제스처를 요구함. → 자동시작은 **desktop(Tauri) + 예약한 client_id**에서만. 웹/모바일은 manual만. web에서 `auto_start_mode=auto` UI 잠금(`project_cli_preset_env_gate` 패턴).
- **데스크톱 단일 인스턴스 강제**: 현재 `tauri-plugin-single-instance` 미적용 → 데스크톱도 2개+ 실행 가능. C에서 단일 인스턴스 강제(2번째 실행=기존 창 포커스)해야 자동시작 정확히 1회.
- `meetings.scheduled_by_client_id` 기록(예약 시).
- B(백그라운드 녹음): 녹음을 페이지 컴포넌트에서 전역/백그라운드 서비스로 승격, 떠다니는 녹음바 + 복귀, 녹음 소유 = 특정 client_id. 백그라운드 recorder가 **하트비트를 계속 전송** → A 리퍼가 안 죽임(presence 신호 재사용).

## 컴포넌트 경계

- `frontend/src/lib/clientId.ts` (신규): `getClientId`/`getClientPlatform` 순수 함수 + localStorage 접근. 단독 테스트 가능.
- api 클라이언트 hook (기존 ky 인스턴스 1곳): 헤더 주입.
- ActionCable 구독부 + `useLiveRecording`(기존): params 추가 + 하트비트 인터벌.
- `TranscriptionChannel` (기존): `heartbeat` 액션 + `bump_recorder_heartbeat`(subscribed/audio_chunk/heartbeat).
- `ApplicationController` (기존): 헤더 → 헬퍼.
- `Meeting` 모델 (기존): `stale_recording?`/`heal_stale_recording!`. `heal_stale_re_diarize!`와 동일 패턴·위치.
- `meetings_controller` (기존): `index`/`show` lazy heal.
- 마이그레이션 (신규).

## 테스트 전략

- 모델 스펙: `stale_recording?`/`heal_stale_recording!` —
  - 하트비트 최신 → skip (활성 보호). **시작 직후 침묵(heartbeat=subscribed 시각, 최신) → skip** (핵심 회귀).
  - 하트비트 nil → 종결(레거시/#207).
  - 하트비트 90s+ 과거 → 종결.
  - completed/transcribing → no-op.
  - 전사 있을 때 finalize/summary enqueue, 없을 때 미enqueue.
- 채널 스펙: `heartbeat`/`subscribed`/`audio_chunk`가 `recorder_heartbeat_at` bump, throttle(10s 내 재호출은 미갱신).
- 요청 스펙: `start`가 `recording_client_id`/platform 도장. `show`/`index`가 stale 회의 자동 완료, 활성(하트비트 최신) 미변경. `current_client_id` 헤더 파싱.
- 프론트: `getClientId` get-or-create 멱등·`getClientPlatform`·헤더 주입. (하트비트 인터벌은 통합지점이라 단위테스트 최소.)

## 비목표 (YAGNI)

- `clients` 테이블·세션 관리.
- IP 기반 식별.
- 주기 잡 리퍼(추후 prod 보강 가능하나 lazy로 충분).
- B(백그라운드 녹음), C(자동시작 게이팅) 구현.
- client_id를 A의 판정에 사용(presence 하트비트는 client 무관).
