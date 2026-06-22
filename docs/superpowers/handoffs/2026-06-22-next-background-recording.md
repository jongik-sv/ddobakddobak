# 핸드오프 — 다음 작업: B(백그라운드 녹음)

작성 2026-06-22. 새 세션(컨텍스트 클리어 후)이 이걸 읽고 이어간다.
연관 메모리: `project_stale_recording_client_identity.md`(자동 로드됨).

## 0. 지금 상태 (방금 끝낸 것)

**하위프로젝트 1 = 클라이언트 식별 토대 + A(비정상 종료 녹음 자동 종결)** 완료.
- 브랜치 `feat/client-identity-stale-recording` (**6커밋, 미머지**):
  - 52e4a48 spec · 489b573 plan · c003d33 backend · f639996 frontend · f6618aa harden · 27f70f0 #213 fix
- 게이트: backend rspec **1347/0**, frontend vitest **1454/0**, tsc 0.
- 기기 E2E 통과: stale→완료(브라우저 user10 JWT 포함)·fresh 생존·cross-identity·client_id 헤더.
- 스펙/플랜: `docs/superpowers/specs/2026-06-22-client-identity-stale-recording-design.md`, `docs/superpowers/plans/2026-06-22-client-identity-stale-recording.md`.

**열린 결정/주의:**
- **머지 미정** — A를 main에 머지할지 사용자 확인 필요. 권장: A 머지 → main에서 B 분기(B는 A의 client_id 토대 필요). 또는 이 브랜치 위에 B 계속.
- **작업트리 무관 미커밋 파일**(내 작업 아님, 사용자 것): `frontend/src/App.tsx`, `frontend/src/components/project/IconPicker.tsx`, `frontend/src/pages/ProjectsPage.tsx`, `idea.md`. **건드리지 말 것**(사용자 별도 작업).
- A 잔여 수동 게이트: 실 마이크 녹음 중 클라가 침묵에도 15s 하트비트 보내는지 — 브라우저 마이크 prompt라 미검증(유닛+서버생존으로 커버). 사용자 확인: 녹음→침묵 2분→안 끝나면 OK.
- A heal은 **현재 보는 뷰(프로젝트/필터) 스코프 한정** — stuck은 그게 보이는 목록 열 때 청소.

## 1. 다음 작업: B(백그라운드 녹음)

### 사용자 요구 (확정)
- 회의 녹음/STT가 **회의 페이지를 빠져나와도 계속** — 명시적 `종료` 전까지.
- 동기: **회의 중 이전 회의(다른 페이지) 참고**하러 다녀와도 녹음 유지.
- 데스크톱(Tauri)은 **탭/앱 닫아도 계속**(백그라운드).

### 아키텍처 도전 (현 구조)
- 현재 녹음은 **페이지 종속**: `useLiveRecording`(MeetingLivePage)에 묶임 → 페이지 떠나면 언마운트 → 녹음 중단.
- 녹음을 **전역/앱 레벨 서비스로 승격** 필요 + 떠다니는 녹음바(어디서나 표시·복귀) + 라우트 변경에도 유지.
- 마이크 캡처(getUserMedia)·VAD 워클릿·ActionCable 구독·청크 전송이 라우트 변경에 끊기지 않게 lift.

### A와의 결합 (중요)
- A의 자동 종결은 **presence 하트비트 부재(90s)**로 판정. B의 백그라운드 recorder는 **계속 하트비트를 보내야** A가 안 죽임.
- 현재 하트비트는 `useRecorderHeartbeat(isActive && !recordingDenied, sendHeartbeat)` — useLiveRecording 안. B에선 이 게이트/전송을 **전역 녹음 상태**로 옮겨야 함(페이지 떠나도 active면 계속 전송).

### 플랫폼 스코프
- **데스크톱 Tauri**: 풀 백그라운드(앱 닫아도). `project_tauri_background_tray`(이미 구축: 트레이·백그라운드 실행·caffeinate)와 결합. **단일 인스턴스 강제**(`tauri-plugin-single-instance` 현재 미적용) 검토.
- **웹**: 앱 내 네비게이션만(탭 닫으면 JS 죽어 불가). 전역 recorder + 떠다니는 바.
- **모바일**: OS 백그라운드 제약 — 범위 확인 필요.

### 시작 방법
**브레인스토밍부터** (B는 새 기능 — `superpowers:brainstorming`). 풀어야 할 설계 질문:
1. 전역 recorder 구조(전역 store/service vs portal vs 앱 레벨 훅) + 떠다니는 녹음바 UX.
2. 웹 vs 데스크톱 백그라운드 범위 — 웹은 어디까지?
3. 라우트 변경 시 마이크/VAD/cable/청크 파이프라인 연속성.
4. 하트비트를 전역 녹음 상태로 이동(A 결합).
5. 종료/복귀 흐름(어디서나 종료 버튼, 녹음 중 회의로 점프).
→ 스펙(`docs/superpowers/specs/`) → 플랜(`docs/superpowers/plans/`) → 서브에이전트 TDD 구현(메모리 `feedback_always_subagent_execution`).

## 2. 그 다음: C(예약 자동시작 게이팅)
- **웹 예약 자동시작 금지**(2탭+ 중복 트리거·AudioContext 제스처) → 자동시작=desktop+예약한 client_id만, web `auto_start_mode=auto` UI 잠금(`project_cli_preset_env_gate` 패턴).
- 데스크톱 **단일 인스턴스 강제**.
- `meetings.scheduled_by_client_id` 기록(예약 시) → 그 client에서만 자동시작.
- 연관: `project_scheduled_meeting_autostart`.

## 3. 빠른 컨텍스트 포인터
- 녹음 캡처: `frontend/src/hooks/useLiveRecording.ts`(652줄, 페이지 종속)·`useTranscription.ts`(cable 구독)·`useMicCapture.ts`(VAD)·`useAudioRecorder.ts`.
- 하트비트: `frontend/src/hooks/useRecorderHeartbeat.ts` + `channels/transcription.ts`(sendHeartbeat).
- 백엔드 presence/heal: `backend/app/models/meeting.rb`(stale_recording?/heal_stale_recording!)·`meetings_controller.rb`(index/show heal·start/reopen 도장)·`transcription_channel.rb`(heartbeat 액션·bump).
- client_id: `frontend/src/lib/clientId.ts` + `api/client.ts`(헤더) + `ApplicationController#current_client_id`.
- 플랫폼: `frontend/src/config.ts`(IS_TAURI/IS_MOBILE/getMode). 서버모드/하이브리드 인증: `project_hybrid_auth`.
