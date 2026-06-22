# 설계 — B(백그라운드 녹음) 핵심 리프트

작성 2026-06-22. 브랜치 `feat/background-recording`(main 1d80f97 위, 커밋 0).
연관: 핸드오프 `docs/superpowers/handoffs/2026-06-22-next-background-recording.md`,
메모리 `project_stale_recording_client_identity`(A=비정상 종료 자동종결, 이미 main 머지).

## 1. 목적 / 동기

회의 녹음·STT가 **회의 라이브 페이지를 빠져나와도 계속**된다 — 명시적 `종료` 전까지.
동기: 회의 중 **이전 회의(다른 페이지) 참고**하러 다녀와도 녹음이 유지돼야 한다.

현재 녹음은 **페이지 종속**: `useLiveRecording`(652줄 god 훅)이 `MeetingLivePage`
(라우트 `/meetings/:id/live`)에 묶여 있어, 라우트를 떠나면 페이지가 언마운트되고
녹음 캡처·cable 구독·하트비트가 전부 끊긴다.

## 2. 범위

### 이 스펙 (핵심 리프트 — 전 플랫폼 공통 토대)
- 녹음 세션을 **앱 레벨 전역 서비스**로 승격(라우트 변경에도 캡처 연속).
- **떠다니는 녹음바**(어느 페이지서든 표시·복귀·종료).
- 하트비트·caffeinate·녹음활성 플래그를 **전역 녹음 상태**로 이동(A 결합 유지).
- 이탈 가드 **반전**(차단 → 허용).
- **웹**: 앱내 네비게이션 동안 녹음 유지(탭 닫으면 JS 사망 — 불가, 경고만).
- **데스크톱(Tauri)**: 위 + 창 숨김(트레이 "백그라운드 유지")에도 녹음 유지.
  근거: 닫기 핸들러는 `win.hide()`(`ClosePrompt.tsx:25,47`)로 창을 **destroy 않고 숨김**
  → WebView JS 생존 → 녹음 계속. 녹음 중 caffeinate(`set_recording`)가 앱냅을 이미 차단.

### 스코프 밖 (별도 스펙)
- 단일 인스턴스 강제(`tauri-plugin-single-instance`) — 다음 작업.
- 모바일 OS 백그라운드(마이크 백그라운드 제약) — 별도 조사.
- C(예약 자동시작 게이팅).

## 3. 아키텍처 (Approach 1: 앱 레벨 RecordingHost + store + 페이지=뷰)

### 선택 근거
캡처 훅들(`useAudioRecorder`/`useMicCapture`/`useSystemAudioCapture`)은
워클릿 teardown 타이밍·250ms flush·cable 재구독 등 **취약**하다. 임시(imperative)
서비스로 de-hook하면 이 전부가 회귀 위험 → **기각**(Approach 2). 훅을 유지하려면
**언마운트되지 않는 컴포넌트**에 살려야 한다 → 호스트 패턴.

### 컴포넌트
- **`<RecordingHost/>`** — `GatedApp`에 마운트(`ScheduledMeetingWatcher`·`ClosePrompt` 옆).
  라우트가 바뀌어도 GatedApp은 안 죽으므로 호스트도 안 죽는다.
  `recordingStore.activeMeetingId != null`일 때 내부에 **헤드리스
  `<RecordingSession meetingId/>`**를 마운트한다. 이게 (가볍게 리팩된)
  `useLiveRecording`을 실행하는 **유일한** 곳이다.
- **`MeetingLivePage` = 순수 뷰**. `useLiveRecording`을 **절대 직접 실행하지 않는다**.
  (실행하면 좀비 캡처로 청크 이중 전송·전사 2배 — `useLiveRecording.ts:467-474` 경고의
  아키텍처화.) 페이지는 store/전역 store에서 읽고, 시작/일시정지/종료/리셋을 store 인텐트로 보낸다.
- **`<RecordingBar/>`** — GatedApp 마운트. `activeMeetingId`가 있고 현재 라우트가
  그 회의의 live가 아닐 때 표시. 하단 전체폭 바.
- **`<StopConfirmDialog/>`**(전역화) — 바 옆에 마운트. 바의 [종료]가 어느 라우트서든 띄운다.

### 핵심 불변식 (위반 시 전사 2배 / wipe)
1. **세션 훅 단일 소유자 = 호스트만.** 페이지는 읽기 전용.
2. **세션-스코프 부수효과를 페이지→세션으로 이동**(세션당 1회, 라우트 무관). 현재는
   페이지 마운트/언마운트마다 발화하는 것들:
   - transcriptStore `reset()`+`loadFinals`+요약 로드 (`useLiveRecording.ts:111-125`) — wipe trap.
   - sharingStore init/reset (`:575-608`) — 언마운트 reset이 네비-어웨이 시 공유 상태를 지움.
   - 하트비트(`:524`)·caffeinate `set_recording`(`:507-518`)·`setRecordingActive`(`:500-504`)·
     무음/경과/요약 타이머 — 훅을 따라 자동 이동(세션이 호스트에 있으므로 라우트 무관). 이동 후 동작 확인만.

### 페이지 새 로직 = attach-vs-init
- `recordingStore.activeMeetingId === Number(:id)` → store에서 라이브 뷰 렌더.
  **재init·재reset·`handleStart` 재실행 금지**(이미 호스트가 세션 보유 중).
- 아니면 → idle/시작 화면. 시작 버튼 = `recordingStore.start(id)` → 호스트가 세션 기동.

### store 경계 (최소 — ~40 필드 배선 금지)
전사·요약·공유는 **이미 전역 zustand**(transcriptStore/sharingStore) → 페이지·바가 직접 읽음.
특히 `isSummarizing`(transcriptStore)·`finals`(미리보기 마지막 발화)는 바가 직독(store 중복 금지).
새 `recordingStore`엔 **진짜 세션-로컬 상태**만 둔다:
- 상태: `activeMeetingId, status('idle'|'recording'|'stopped'), meetingApiStatus,
  isPaused, elapsedSeconds, sttEngine, activeSttMode, systemAudioEnabled,
  isResetting, isStopping, error, isApplyingCorrections, summaryCountdown, summaryIntervalSec`.
  (`canManualSummary`는 파생: `status==='recording' && !isPaused && finals.length>0 && !isSummarizing`.)
- 인텐트: `start(meetingId), pause(), resume(), requestStop(), confirmStop(skipSummary),
  reset(), toggleSystemAudio(next), manualSummary(), setSummaryInterval(sec)`.
- 종료 확인: `showStopConfirm` 플래그(전역 다이얼로그 게이트).

### 페이지-결합 입력 처리
- `showStatus` → **전역 토스트**로 승격(백그라운드 종료 "회의 종료 중…"이 다른 라우트서 떠야 함).
- `showStopConfirm`(요약하고 종료/그냥 종료/취소) → **전역화**, 바 옆 마운트.
- `isApplyingCorrections` → recordingStore 필드로 세션에 흘림(기본 false).
- `clearMemoEditor` → **페이지-로컬 유지**(리셋은 페이지에 있을 때만 일어남 — 안 들어올림).

### 떠다니는 녹음바 (확정 UX: 하단 전체폭 + 미리보기)
- 위치: 하단 전체폭 고정. 표시 조건: `activeMeetingId != null` && 현재 라우트 ≠ 그 회의 live.
- 내용(기본): `● REC {경과시간}` + 마지막 final 발화 한 줄(transcriptStore 직독, 화자 라벨 포함).
- 컨트롤(확정 — **컴팩트 아이콘 버튼**, 폭 최소화. 의미는 tooltip/`aria-label`로):
  **[지금 요약 ✨]**(`manualSummary`, 비활성=`!canManualSummary`) · **[일시정지 ⏸ / 재개 ▶]**
  (`pause`/`resume`) · **[돌아가기 ⤢]**(→ `/meetings/{id}/live`) · **[종료 ⏹]**(어디서든 전역
  종료확인 → 요약하고 종료/그냥 종료/취소). **요약 카운트다운**(`summaryCountdown`)은 작은 텍스트
  `⏱03:21`. 텍스트 라벨 대신 아이콘만 — 공간 차지 최소.
- 상태 인디케이터: **"요약 중…"**(`isSummarizing` transcriptStore 직독 — [지금 요약] 비활성 +
  ✨ 스피너화) · 일시정지 시 [일시정지] 아이콘이 [재개 ▶]로 토글. 돌아가기 강제 없음.
- 페이지 전용(바에 안 올림): 요약 **간격 선택**·**시스템오디오 토글**·**리셋**(파괴적).
- 예시 레이아웃(아이콘 폼):
  ```
  ● 12:34 │ 화자2: "그 부분은…"                    ⏱03:21  ✨  ⏸  ⤢  ⏹
  ```
- 일시정지 중에도 표시(status='recording' 유지). pill이 아니라 전체폭 바. 좁은 폭은
  미리보기를 먼저 줄이고 아이콘 컨트롤은 유지(우선순위: 종료 > 돌아가기 > 일시정지 > 지금요약).

### 이탈 가드 반전
`useNavigationGuards`의 **이탈 차단 로직 제거**(popstate 되돌림·Option+←/→·Cmd+[ ] 가로채기·
`showLeaveBlock`) → 자유 네비게이션. 단 **웹 `beforeunload` 경고는 유지**
(탭/창 닫으면 웹은 녹음을 잃음 — 예상된 동작이므로 경고만). 데스크톱은 닫기=hide라 손실 없음.

## 4. 데이터 흐름

```
[MeetingLivePage 시작버튼] --start(id)--> [recordingStore.activeMeetingId=id]
        ↓ (호스트가 감지)
[<RecordingHost/> → <RecordingSession id/>] --useLiveRecording(id)-->
        ├─ 캡처(mic/system) · cable 구독 · 청크 전송
        ├─ 하트비트 15s(라우트 무관) · caffeinate · setRecordingActive
        ├─ transcriptStore.loadFinals / 실시간 final push (전역)
        └─ recordingStore에 status/elapsed/isPaused 등 publish
        ↓ (어느 라우트서든 구독)
[MeetingLivePage(attach 시) | <RecordingBar/>(딴 라우트)] 읽기 렌더
        ↓ [종료]
[recordingStore.requestStop → showStopConfirm] → [confirmStop(skip)] →
  세션 performStop → stopMeeting → activeMeetingId=null → 호스트 세션 언마운트
```

## 5. 에러 / 엣지 케이스
- **이중 마운트 방지**: 페이지가 절대 `useLiveRecording`을 안 부른다(불변식 1). 테스트로 회귀 가드.
- **녹음 중 페이지 attach 시 transcript wipe 금지**: reset/loadFinals가 세션에만 있어 페이지 attach는
  store를 안 건드림.
- **recordingDenied(2번째 클라가 녹음 시도)**: 기존 단일 세션 보장 유지 — viewer로 라우팅.
  단일 소유자가 호스트로 이동했으므로, 이 분기도 세션/스토어 기준으로 재배선.
- **백그라운드 종료 토스트**: 전역 토스트라 다른 라우트서 보임.
- **데스크톱 숨김창 타이머 스로틀링**: 온디바이스 검증 항목(아래).
- **새로고침(웹)**: 페이지 리로드 = JS 재시작 → 녹음 끊김. 기존과 동일(beforeunload 경고). A의
  stale-recording 자동종결이 90s 후 서버측 정리.

## 6. 테스트 (TDD)
- `recordingStore` 단위: start/stop/pause/resume 인텐트, activeMeetingId 전이, showStopConfirm 게이트.
- attach-vs-init 분기: `activeMeetingId===:id` → 뷰 렌더·재init 안 함 / 불일치 → idle.
- 단일 소유자 불변식: 페이지가 `useLiveRecording`을 호출하지 않음(정적/렌더 회귀 가드).
- `<RecordingBar/>` 표시 조건: activeMeetingId 유무 × 라우트 일치 여부 매트릭스. 미리보기=마지막 final.
- nav-guard 반전: 녹음 중 네비게이션 차단 안 됨. 웹 beforeunload 경고는 유지.
- 세션-스코프 부수효과 이동: 페이지 리마운트가 transcriptStore/sharingStore를 reset 안 함.
- 회귀: 기존 라이브 녹음 동작(시작/일시정지/종료/요약/무음완료) green 유지.

## 7. 구현 순서 / 병렬성 (서브에이전트)
의존: `recordingStore`가 먼저 착지해야 host/bar/page/guard가 소비.
1. (선) `recordingStore` + 전역 토스트 + `useLiveRecording` 옵션 디커플(showStatus/isApplyingCorrections 경유).
2. (선) `<RecordingSession>` 추출 — 세션-스코프 부수효과 이동(transcript/sharing init를 세션으로).
3. (팬아웃) `<RecordingHost/>` 마운트 · `<RecordingBar/>` · `<StopConfirmDialog/>` 전역화 ·
   `useNavigationGuards` 반전 · `MeetingLivePage` 페이지=뷰 재작성.
4. 회귀·신규 테스트 green → 게이트.

## 8. 검증 게이트
- frontend vitest green(기존 1454 + 신규), tsc 0, vite build OK.
- 수동 E2E(기기): ① 웹 — 녹음 중 다른 회의 페이지 다녀와도 녹음·전사 유지, 바 표시·복귀·종료.
  ② 데스크톱 — 녹음 중 창 닫기(백그라운드 유지)→ 숨김 상태서 녹음 계속(타이머 스로틀 없음 확인)→
  복귀 시 이어짐. ③ A 결합 — 백그라운드 중 하트비트 지속(서버 stale 자동종결 안 됨).
