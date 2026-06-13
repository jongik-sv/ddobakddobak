# 수동 요약 + 종료 확인 + 일시정지/빈기록 요약 게이트 — 설계

날짜: 2026-06-13
브랜치: `feat/manual-summary-and-audio-tail`
범위: 요약 트리거 정책 4종. (시스템 오디오 꼬리 잘림 = **별도 작업**, 본 스펙 제외)

## 배경 / 현행

요약 트리거는 두 갈래로 돈다.

1. **프론트 인터벌 타이머** (`useLiveRecording.ts` line 576~637): `summaryIntervalSec` 주기로
   `triggerRealtimeSummary()` 호출. 일시정지 시 멈춤(line 582). `summaryIntervalSec===0`="안함".
2. **백엔드 cron** (`SummarizationJob`, `config/recurring.yml`): **매분** `Meeting.recording` 전체에
   `MeetingSummarizationJob(type: realtime)` enqueue. **프론트 설정·일시정지 무시.** 항상 동작하는 드라이버.

`MeetingSummarizationJob`은 meeting별 Mutex로 직렬화. realtime 경로엔 `return if new_transcripts.empty?`
가드 존재, final 경로엔 없음.

현행 문제점:
- 회의 중 **수동 요약 버튼 없음** (`triggerRealtimeSummary` 호출처는 인터벌/일시정지/종료 3곳뿐).
- `handleStop`은 확인 없이 바로 종료 → 백엔드 `stop`이 무조건 final 요약 + finalizer enqueue.
- 일시정지는 프론트 전용 → 백엔드 cron이 일시정지 무시하고 매분 요약.
- 빈 기록에도 final 요약/컨트롤러가 LLM 호출 가능.

## 사용자 결정 (확정)

- 자동요약 정책: **유지** + 수동 추가.
- 수동 버튼 동작: 새 동작 안 만듦, **기존 설정**(`summary_restructure` + `summary_verbosity`) 따름.
- 수동 버튼 위치: **회의 중만**.
- 일시정지: **완전 금지** (자동 차단 + 일시정지 순간 flush도 제거).
- 일시정지/재개: **별도 엔드포인트**.
- 종료 "건너뛰기": final 요약 + 액션아이템/결정 추출 **둘 다 생략** (realtime로 쌓인 회의록은 유지).

## 공유 기반 — 백엔드 일시정지 인지

`meetings.paused_at` (`datetime`, nullable, 기본 nil) 컬럼 추가.

- `POST /api/v1/meetings/:id/pause` → `recording?`일 때만, `paused_at = Time.current`, 브로드캐스트 `recording_paused`.
- `POST /api/v1/meetings/:id/resume` → `paused_at = nil`, 브로드캐스트 `recording_resumed`.
- routes member 라우트 2개 추가.
- `stop`/`reset_content`에서 `paused_at`도 nil로 정리(종료/리셋 시 잔류 방지).

## 기능 1 — 수동 요약 (회의 중만)

**프론트**
- 라이브 녹음 컨트롤(`DesktopRecordControls.tsx` + `MobileRecordControls.tsx`)에 **"지금 요약"** 버튼 추가.
  - 핸들러: `useLiveRecording`에 `handleManualSummary` 신설 → `triggerRealtimeSummary(meetingId)`
    (인터벌 타이머와 동일 경로 → 현 설정 그대로 적용).
  - disabled: `finals.length === 0` || `isPaused` || 요약 진행중.
  - 누른 뒤 인터벌 deadline 재anchor(중복 요약 방지, 인터벌 코드의 finally와 동일하게).
- 완료 회의 화면: **변경 없음** (기존 "회의록 재생성" 유지).

**백엔드**: 변경 없음 (기존 `summarize` 엔드포인트 재사용). 단 기능4의 빈가드는 추가.

## 기능 2 — 종료 시 요약 확인

**프론트** (`useLiveRecording.handleStop`)
- 캡처/flush 중지 후, **전사 존재(`finals.length > 0`)면 확인 다이얼로그**:
  "이번 회의를 AI로 최종 요약할까요?" → [요약함] / [건너뛰기].
  - 전사 없으면 다이얼로그 생략 → `skip_summary=true`로 바로 종료 (기능4).
- 사용자 응답에 따라:
  - 요약함: 기존 흐름 (종료 전 `triggerRealtimeSummary` flush → `stopMeeting(id)`).
  - 건너뛰기: flush 생략, `stopMeeting(id, { skip_summary: true })`.
- 다이얼로그는 `ConfirmDialog`(`MeetingLivePage.tsx`에서 이미 사용) 패턴 재사용.
  단 `handleStop`은 hook 안이라 async 대기 필요 → hook에 `pendingStopResolve` 상태 +
  페이지에서 다이얼로그 렌더. (대안: 다이얼로그 표시 state를 hook이 노출, 페이지가 [요약]/[건너뛰기]
  콜백으로 실제 종료 함수 호출.) **택1: hook이 `stopConfirm` state와 `confirmStop(skip)`/`cancelStop` 노출,
  페이지가 다이얼로그 렌더.**

**API** (`frontend/src/api/meetings.ts`)
- `stopMeeting(id, opts?: { skip_summary?: boolean })` → `POST /meetings/:id/stop?skip_summary=true`.

**백엔드** (`meetings_controller#stop`)
```ruby
@meeting.update!(status: :completed, ended_at: Time.current, paused_at: nil)
RecordingLock.clear(@meeting.id)
ActionCable.server.broadcast(...recording_stopped...)
skip = params[:skip_summary].to_s == "true"
if !skip && @meeting.transcripts.exists?
  MeetingFinalizerJob.perform_later(@meeting.id)
  MeetingSummarizationJob.perform_later(@meeting.id, type: "final")
end
```

## 기능 3 — 일시정지 중 요약 완전 금지

- cron: `SummarizationJob#perform` → `Meeting.recording.where(paused_at: nil).ids`.
- `MeetingSummarizationJob` realtime 경로: 초반에 `return if meeting.paused_at?` 가드.
  (final은 stop 시점이라 영향 없음.)
- 프론트 인터벌 타이머: 이미 일시정지 시 멈춤 — 유지.
- `handlePause`(line 341)의 `triggerRealtimeSummary` flush **제거**.
- `handlePause`/`handleResume`가 신규 `pauseMeeting`/`resumeMeeting` API 호출.

## 기능 4 — 빈 기록이면 요약 안 함

- 컨트롤러 `summarize`: `unless @meeting.transcripts.exists?` → enqueue 생략, `{ ok: true, skipped: "no_transcripts" }`.
- `MeetingSummarizationJob` final 경로: LLM 호출 전 `return if transcripts.empty?`.
- 프론트: `triggerRealtimeSummary` 호출부(인터벌·수동·종료) 모두 `finals.length > 0` 가드.

## 데이터 흐름 요약

```
일시정지: FE handlePause → POST /pause (paused_at=now) ; flush 없음 ; 인터벌 멈춤
          cron: WHERE paused_at IS NULL 로 제외 ; job: paused_at? → return
재개:     FE handleResume → POST /resume (paused_at=nil) ; 인터벌 재anchor
수동요약: "지금 요약" → triggerRealtimeSummary → realtime job (설정 반영)
종료:     handleStop → (전사 있으면) ConfirmDialog
          요약함 → flush → stop(skip_summary=false) → final+finalizer
          건너뛰기 → stop(skip_summary=true) → job 미enqueue ; realtime 노트 유지
빈기록:   모든 경로에서 전사 0 → 요약 안 함 (FE 가드 + 컨트롤러 + final job)
```

## 엣지 케이스

- 일시정지 중 "지금 요약" 버튼: disabled (isPaused).
- 일시정지 직후 종료: `stop`이 `paused_at=nil`로 정리, 확인 다이얼로그 정상.
- cron이 enqueue한 뒤 사용자가 즉시 일시정지: job 실행 시 `paused_at?` 재확인으로 차단.
- 전사 0건인데 cron 이미 enqueue: realtime 기존 `new_transcripts.empty?` 가드가 잡음.
- 다이얼로그 떠 있는 동안 ActionCable `recording_stopped` 등 외부 종료: hook이 stopConfirm state 정리.

## 테스트

**백엔드 (RSpec)**
- `pause`/`resume`: `paused_at` 토글 + 상태 가드(`recording?`) + 브로드캐스트.
- `SummarizationJob`: `paused_at` 있는 recording 회의는 enqueue 제외.
- `MeetingSummarizationJob`: realtime이 `paused_at?`면 LLM 미호출 ; final이 전사 0이면 미호출.
- `stop`: `skip_summary=true`면 job 미enqueue ; 전사 0이면 job 미enqueue ; 기본은 enqueue.
- `summarize`: 전사 0이면 enqueue 안 하고 skipped 반환.

**프론트 (Vitest)**
- `handlePause`가 `triggerRealtimeSummary` 호출 안 함 + `pauseMeeting` 호출.
- "지금 요약" 버튼 disabled 조건(전사0/일시정지/요약중).
- `handleStop`: 전사 있으면 다이얼로그, 건너뛰기→`skip_summary:true` ; 전사 없으면 다이얼로그 없이 `skip_summary:true`.

## 범위 밖 (Out of scope)

- **요구사항 5 — 시스템 오디오 입력 시 뒷부분 잘림**: 네이티브 캡처(macOS ScreenCaptureKit / Windows WASAPI)
  중지 시 부분 배치(<~300ms) 미emit + VAD min_chunk 임계 미달 tail 폐기 + `stop_system_audio_capture` 미await
  레이스. 별도 작업/스펙으로 분리.
- 완료 회의 화면의 수동 요약 버튼.
- 자동요약 주기 변경.
