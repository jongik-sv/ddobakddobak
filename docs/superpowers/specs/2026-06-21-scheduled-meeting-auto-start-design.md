# 예약 회의 자동 시작 (Scheduled Meeting Auto-Start)

작성일: 2026-06-21
브랜치: `feat/scheduled-meeting-auto-start`
상태: **구현 완료 (S1~S7), 미커밋.** 백엔드 rspec 1311/0 · 프론트 vitest 1383/0 · 신규 tsc 0. 브랜치 feat/scheduled-meeting-auto-start. 남음 = 기기 E2E(특히 웹-auto AudioContext 제스처) · recurring.yml Solid Queue 슈퍼바이저 재시작 · 커밋.

## 1. 목표

회의 생성 시 **예약 시각**을 지정하면, 그 시각에 회의가 자동으로 시작되도록 한다.

- **자동(auto) 모드**: 예약 시각 도달 → 묻지 않고 자동 시작 + "회의를 시작합니다" 메시지 잠시 표시.
- **수동(manual) 모드**: 예약 시각 **1분 전** → "「제목」 회의를 시작하시겠습니까?" 프롬프트 → Yes → 즉시 시작 / 무응답 → 시작 안 함(놓침 처리).
- **반복(recurrence)**: 매주 특정 요일·시각 반복 예약 지원.
- 예약 미지정 시 = **기존 동작 그대로**(생성 직후 라이브 진입, 수동 버튼 시작).

## 2. 핵심 제약 (설계의 토대)

1. **녹음은 이 기기 마이크로 일어난다.** 서버 혼자 녹음 못 함 → 자동시작 트리거는 **열린 앱 안의 클라이언트 타이머**가 담당. (Tauri 데스크톱은 창 닫으면 백엔드+sidecar를 죽임 — `frontend/src-tauri/src/lib.rs:106-112`. 서버사이드 cron 단독으론 녹음 불가.)
2. **닫힌 앱**: 예약 시각에 앱이 꺼져 있었으면 자동시작 안 함. 다음에 앱을 열면 **"놓친 예약 회의"**로 안내(지금 시작 / 닫기). (사용자 결정 A)
3. **웹/PWA 자동시작 제스처 문제** ⚠️: 타이머가 클릭 없이 `getUserMedia`+`AudioContext`를 시작하면 브라우저 autoplay 정책상 `AudioContext`가 suspended → **녹음되는데 무음**이 될 수 있음(이 코드베이스가 반복적으로 당한 조용한 실패 부류). 따라서:
   - **데스크톱(Tauri)**: 네이티브 Rust 레코더가 OS 마이크를 직접 열어 제스처 불필요 → 완전 자동.
   - **웹/PWA + auto 모드**: 완전 무클릭 자동 대신 **원탭 "지금 시작" 토스트**로 강등(탭이 제스처 제공). → Slice 0에서 실측 검증 후 확정.
   - **manual 모드**: Yes 클릭이 제스처 → 웹/데스크톱 모두 안전(오늘 버튼과 동일).
4. **중복 발화 방지·세션 보호**: 스케줄러는 (a) 이미 녹음 중이거나 (b) 사용자가 `/live` 페이지에 있으면 아무 것도 안 함. 디둡 권위는 백엔드 `status`(시작되면 더 이상 `pending` 아님) — 인메모리 id set보다 status를 신뢰.
5. **타임존**: `datetime-local`은 로컬 시각, Rails는 UTC 저장. 반복 규칙의 `time`은 tz 없으면 무의미 → 규칙에 **생성 시점 브라우저 IANA tz를 명시 저장**.

## 3. 적용 범위 (YAGNI)

- **서버 회의(`meetings`)만**. 로컬/오프라인 회의(`/local-meetings`)는 후속.
- 반복은 **주간(weekly)** 우선(요일 + 시각). "매주 월 10시" 예시 충족. (`daily`도 같은 규칙 포맷으로 저렴하게 포함 가능 — 구현 재량.)
- 신규 토스트/모달 시스템 **만들지 않음** — 기존 `showStatus`(라이브 상태바)·`confirmDialog`(`frontend/src/lib/confirmDialog.ts`, Tauri 안전 전역) 재사용.

## 4. 데이터 모델 (meetings 신규 컬럼)

마이그레이션 `20260621000001_add_scheduling_to_meetings.rb` (번호: 최신 `20260620000002` 다음):

| 컬럼 | 타입 | 의미 |
|------|------|------|
| `scheduled_start_time` | `datetime` (null) | 예약 시각(UTC). null = 즉시 회의(기존). |
| `auto_start_mode` | `string` (null) | `"auto"` \| `"manual"`. 예약 회의에만 의미. |
| `recurrence_rule` | `text` (null) | JSON. null = 1회성. 예: `{"freq":"weekly","days":[1,3],"time":"10:00","tz":"Asia/Seoul"}` (days = 0=일~6=토). |
| `schedule_dismissed_at` | `datetime` (null) | 사용자가 놓친 예약을 닫은 시각(목록에서 숨김). |

인덱스: `scheduled_start_time` (스케줄러 조회용). `disable_ddl_transaction!` 불필요(단순 add_column — 테이블 재생성 아님. cf. SQLite FK 함정 메모는 rename/FK 재생성 케이스에 한정).

### Meeting 모델 추가

- `validates :auto_start_mode, inclusion: { in: %w[auto manual] }, allow_nil: true`
- `scope :scheduled, -> { where.not(scheduled_start_time: nil) }`
- `scope :upcoming_scheduled, ->(within: 1.hour) { scheduled.pending.where(schedule_dismissed_at: nil).where(scheduled_start_time: ..(Time.current + within)) }` (지난 것 포함 — 놓침 판정은 클라이언트/뷰에서)
- `scope :missed_scheduled, -> { scheduled.pending.where(schedule_dismissed_at: nil).where(scheduled_start_time: ...60.seconds.ago) }` — **60s 트리거 유예 후**에만 missed. 워처가 `[scheduled, scheduled+60s)`(auto)/`[scheduled-60s, scheduled+60s)`(manual) 윈도우에서 발화하므로, 그 윈도우가 닫힌 뒤에야 "놓친 예약"으로 분류해 이중노출 방지. `Meeting::SCHEDULE_TRIGGER_GRACE = 60.seconds` 상수로 두고 프론트 `computeScheduleActions` GRACE(60s)와 일치(문서화된 결합).
- `recurring?` → `recurrence_rule.present?`
- `materialize_next_occurrence!` → 반복 규칙으로 다음 occurrence(미래) pending 회의를 복제 생성. title/folder/type/shared/mode/rule 승계, `previous_meeting_id = self.id`로 체이닝(이전 회의 시드 재사용), `scheduled_start_time = Recurrence.next_occurrence(rule, after: Time.current)`. 이미 미래 형제가 있으면 no-op(중복 방지).

## 5. 백엔드 API

- **`POST /meetings` (create)**: 파라미터 추가 — `scheduled_start_time`(ISO8601), `auto_start_mode`, `recurrence_rule`(JSON 문자열/해시). create에 주입. 미지정 시 기존 경로 무변경.
- **`GET /meetings/scheduled`** (신규, member route): 현재 사용자 접근가능 + `scheduled` + `pending` + 미dismiss 회의 반환(upcoming + missed 구분 플래그 포함). 클라이언트 스케줄러가 폴링.
- **`POST /meetings/:id/dismiss_schedule`** (신규): `schedule_dismissed_at = Time.current`. 놓친/예약 회의 안내 닫기. (control 권한 가드 적용.)
- **`POST /meetings/:id/start` (기존)**: 변경 — 시작 성공 후 `@meeting.materialize_next_occurrence! if @meeting.recurring?` (반복 시리즈 연속).
- **serializer `meeting_json`**: `scheduled_start_time`, `auto_start_mode`, `recurrence_rule`(파싱된 객체), `schedule_dismissed_at` 추가(list + detail 공통).

## 6. 반복(Recurrence) — 순수 모듈 (가장 마지막 슬라이스, 분리 가능)

`backend/app/services/recurrence.rb` (순수 함수, 집중 단위테스트):

- `Recurrence.next_occurrence(rule, after:)` → 규칙(요일/시각/tz) 기준 `after`보다 **엄격히 미래**인 다음 occurrence의 UTC `Time`. tz는 `ActiveSupport::TimeZone[rule["tz"]]`로 해석.
- "앱이 일주일 닫혀 N회 놓침" 난제는 이 함수로 흡수됨 — 항상 미래 1개만 반환하므로 N개 복제·분당 크롤 없음.
- 서버 롤오버 잡 `ScheduleRolloverJob`(`recurring.yml`에 `every minute` 등록, 앱 열려 있을 때만 도는 기존 infra와 일관): 시간 지난 반복 시리즈 중 미래 형제 없는 것에 대해 `materialize_next_occurrence!` **1개만** 생성. 놓친 과거 occurrence는 missed로 남김.

## 7. 프론트엔드

### 7.1 타입·API (`frontend/src/api/meetings`)
- `Meeting` 타입에 `scheduled_start_time?`, `auto_start_mode?`, `recurrence_rule?`, `schedule_dismissed_at?` 추가.
- `createMeeting` 파라미터에 위 예약 필드 추가(옵셔널).
- `getScheduledMeetings()` → `GET meetings/scheduled`.
- `dismissSchedule(id)` → `POST meetings/:id/dismiss_schedule`.

### 7.2 생성 폼 (`CreateMeetingModal.tsx`)
- 추가 UI: **예약 시각**(`datetime-local`, 비우면 즉시 회의), 예약 시 노출되는 **시작 방식 라디오**(자동/수동, 기본=수동 — 안전), **반복 설정**(요일 체크박스 + 시각, 선택).
- `datetime-local` 로컬값 → `new Date(value).toISOString()`(UTC)로 전송. 반복 tz = `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- **onCreated 분기(행위 변경)**: `meeting.scheduled_start_time`가 있으면 라이브로 점프하지 않고 목록/상세로. 두 호출부 모두 수정: `MeetingsPage.tsx:460`, `DashboardPage.tsx:228`. 두 곳의 기존 테스트(`MeetingsPage.test.tsx` 등) 갱신.

### 7.3 전역 스케줄러 (`useScheduledMeetings` + `<ScheduledMeetingWatcher/>`)
- `GatedApp` 안 `RecordingRecovery`(return null 패턴) 옆에 `<ScheduledMeetingWatcher/>` 마운트 → 인증된 앱이 열려 있는 동안만 동작.
- 동작:
  1. `getScheduledMeetings()` ~30초 폴링. 근접 트리거는 `setTimeout`으로 정밀화.
  2. **가드**: 이미 녹음 중 또는 현재 경로가 `/live`면 skip. status가 pending 아니면 skip(백엔드 권위).
  3. **auto**: 발화 윈도우 `[scheduled, scheduled+60s)` 안에서 → (데스크톱) `navigate('/meetings/:id/live', { state: { autoStart: true } })`. (웹) 무클릭 자동녹음 무음 위험 회피 위해 원탭 `confirmDialog('「제목」 회의를 시작합니다. 지금 시작할까요?')` 후 동일 네비게이트. **상한 60s 필수** — 없으면 앱이 닫혔다 한참 뒤 열릴 때 확인 없이 무음 자동녹음이 즉시 시작됨(§2.2 위반). 윈도우 넘기면 missed.
  4. **manual**: 윈도우 `[scheduled-60s, scheduled+60s)` 안에서 → `confirmDialog('「제목」 회의를 시작하시겠습니까?')` → Yes면 `navigate(..., { state: { autoStart: true } })`. No/무응답 → 시작 안 함(윈도우 넘기면 missed).
  - GRACE=60s 상수는 백엔드 `Meeting::SCHEDULE_TRIGGER_GRACE`와 일치(missed 분류 정렬). `computeScheduleActions`는 순수 함수로 분리해 윈도우 경계를 단위테스트.
  5. **디둡**: 트리거한 meeting id를 세션 내 기억 + 폴링마다 status 재확인.

### 7.4 라이브 페이지 자동시작 (`MeetingLivePage.tsx`)
- `useLocation().state?.autoStart`가 true면 마운트 후 1회 `handleStart()` 호출 + `showStatus('회의를 시작합니다', 4000)`. (recorder 준비 보장: 기존 handleStart 내부 시퀀스 사용.) 중복 호출 방지 ref. state는 1회 소비.

### 7.5 놓친 예약 회의 UI
- 대시보드(또는 회의 목록 상단)에 **"놓친 예약 회의"** 섹션: `getScheduledMeetings()`의 missed 항목 리스트 + [지금 시작]([라이브 autoStart]) / [닫기](`dismissSchedule`). 없으면 미표시.

## 8. 컴포넌트 경계 / 테스트

| 단위 | 책임 | 테스트 |
|------|------|--------|
| `Recurrence` (BE) | 규칙→다음 occurrence(순수) | rspec 단위(요일/경계/tz/DST) |
| Meeting scopes/`materialize_next_occurrence!` (BE) | 예약/놓침 조회·시리즈 연속 | model rspec |
| MeetingsController create/scheduled/dismiss/start (BE) | API 계약·권한 | request rspec |
| `meeting_json` (BE) | 직렬화 필드 | serializer/request rspec |
| `getScheduledMeetings`/`dismissSchedule`/`createMeeting` (FE) | API 클라이언트 | vitest(api mock) |
| `CreateMeetingModal` (FE) | 폼·전송 페이로드 | vitest(렌더·submit) |
| `useScheduledMeetings` (FE) | 트리거/가드 로직(순수 분리) | vitest(타이머·가드) |
| onCreated 분기 (FE) | 예약 시 비점프 | 기존 page 테스트 갱신 |

핵심 분리: 스케줄러의 "지금 무엇을 트리거할지" 판단은 **순수 함수**(`computeScheduleActions(meetings, now, { isRecording, onLivePage })`)로 빼서 타이머/네비게이션 부수효과와 분리 → 단위테스트 용이.

## 9. 에러 처리·엣지

- 폴링 실패(`getScheduledMeetings` 네트워크 에러) → 조용히 무시, 다음 폴링 재시도(서버 미도달이 정상인 오프라인 케이스 존재).
- 예약 시각 과거로 생성(사용자가 지난 시각 입력) → 생성 즉시 missed 취급(자동시작 안 함). 폼에서 과거 시각 경고는 선택.
- 다중 탭: status 기반 디둡 + RecordingLock(백엔드 행 단위)로 동시 시작 거부.
- 잠긴(locked) 회의: 예약·자동시작 가드는 기존 `reject_if_locked!`/control 가드 따름.

## 10. 구현 슬라이스 순서 (1회성 먼저, 반복은 마지막=분리 가능)

- **S0(검증 스파이크)**: 웹에서 타이머 트리거 `handleStart()`가 실제 오디오를 캡처하는지 실측 → 웹-auto 강등 여부 확정.
- **S1(BE)**: 마이그레이션 + Meeting 컬럼/검증/scope(반복 제외) + 단위테스트.
- **S2(BE)**: create 파라미터 + `meeting_json` 필드 + `GET scheduled` + `dismiss_schedule` + request 테스트.
- **S3(FE)**: 타입 + API 클라이언트 + 테스트.
- **S4(FE)**: CreateMeetingModal 폼(예약/모드, 반복 UI는 S7) + onCreated 분기(2곳) + 테스트.
- **S5(FE)**: `useScheduledMeetings`/`computeScheduleActions` + `<ScheduledMeetingWatcher/>` 마운트 + 테스트.
- **S6(FE)**: MeetingLivePage autoStart + "회의를 시작합니다" + 놓친 예약 UI.
- **S7(반복, 분리 가능 마지막)**: `Recurrence` 모듈 + `materialize_next_occurrence!` + start 롤오버 + `ScheduleRolloverJob` + `recurring.yml` + 폼 반복 UI + 테스트.

행위 불변 보장: 예약 미지정 회의의 생성→라이브→녹음 경로는 어떤 슬라이스에서도 바뀌지 않는다.
