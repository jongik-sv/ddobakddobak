# 핸드오프 — B(백그라운드 녹음) 완료, 다음 C

작성 2026-06-23. 이전 핸드오프 `2026-06-22-next-background-recording.md`의 B를 끝냈다.
메모리 `project_background_recording_lift`(자동 로드).

## B 상태: 구현완료·미머지
- 브랜치 `feat/background-recording`, **코드 13커밋 `5b715fc..e33ac6a`**(+ spec/plan/handoff).
- 스펙: `docs/superpowers/specs/2026-06-22-background-recording-core-lift-design.md`
- 플랜: `docs/superpowers/plans/2026-06-22-background-recording-core-lift.md`
- 진행 레저: `.superpowers/sdd/progress.md`

### 게이트 (통과)
- 진짜 타입체크 `cd frontend && npx tsc -p tsconfig.app.json --noEmit` → **내 파일 신규 0**(24 사전존재 baseline = 테스트파일, main 동일). ⚠️ bare `tsc --noEmit`는 루트 `files:[]`라 0파일 검사=거짓 green — 쓰지 말 것.
- 풀 vitest `npx vitest run` → **1485 passed / 0 failed**. 실패 suite 2(AiSummaryFullView·AiSummaryPanel.dataloss)는 `@blocknote/react` mock collection 에러로 **사전존재**(내 작업 무관).
- vite build OK.

### 구조 (요약)
`<RecordingHost>`(App.tsx GatedApp 영속) → `activeMeetingId` 설정 시 헤드리스 `<RecordingSession>`(useLiveRecording 유일 실행처) → `recordingStore`에 publish + 핸들러 register. `MeetingLivePage`=순수 뷰(attach-vs-init). `<RecordingBar>` 하단 전체폭. `RecordingLayer`=host+bar+전역 종료확인. 데스크톱 백그라운드=닫기 `win.hide()`라 자동.

### 전수리뷰(workflow) → 수정 완료
- Critical(Fix-A 138f2c4): reopen-after-stop 데이터손실(handleStart가 stale meetingApiStatus로 완료회의에 startMeeting→422무시→완료회의 녹음); useLiveRecording showLeaveBlock TS2339(헤드리스라 useNavigationGuards 제거).
- Important(Fix-B e33ac6a): start 전환가드·idle sharing 로드·reset 직접·persistence 테스트 강화.

### 남은 Minor (미수정·기능무영향 — 필요 시)
- isSystemCapturing 페이지서 하드 false(시스템오디오 캡처중 인디케이터 죽음, 코스메틱).
- 종료 후 status바 잠시 stale(self-heal).
- sharing-clobber: 공유회의 A 백그라운드 녹음 중 미공유 B 보면 전역 sharingStore가 A→리셋(A 복귀 시 재로드, 캡처/STT/하트비트 무영향). 권장수정=sharing effect를 `activeMeetingId∈{null,meetingId}` 게이트.

### 남음
1. **수동 기기 E2E**: ①웹 — 녹음 중 다른 페이지 다녀와도 녹음·전사 유지, 바 표시·복귀·종료. ②데스크톱 — 녹음 중 창 닫기(백그라운드)→숨김서 녹음 계속→복귀 이어짐. ③A결합 — 백그라운드 중 하트비트 지속(stale 자동종결 안 됨). ④reopen — 종료 후 같은 회의 재시작 정상.
2. **머지** 결정(사용자).
3. 작업트리 무관 미커밋(사용자 것, 건드리지 말 것): `App.tsx`(파일드롭 가드 — 내 RecordingLayer 마운트와 별개 hunk, stash로 분리 커밋함), `IconPicker.tsx`, `ProjectsPage.tsx`, `idea.md`.

## 다음: C (예약 자동시작 게이팅 + 단일 인스턴스)
- 웹 예약 자동시작 금지(2탭+ 중복·AudioContext 제스처) → 자동시작=desktop+예약 client_id만, web `auto_start_mode=auto` UI 잠금(`project_cli_preset_env_gate` 패턴).
- 데스크톱 **단일 인스턴스 강제**(`tauri-plugin-single-instance`, 현재 미적용).
- `meetings.scheduled_by_client_id` 기록 → 그 client에서만 자동시작.
- 연관: `project_scheduled_meeting_autostart`, `project_stale_recording_client_identity`(client_id 토대).
