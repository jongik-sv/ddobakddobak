# TSK-02-04 테스트 리포트

- 실행일: 2026-04-02
- 실행 명령: `cd frontend && npx vitest run --reporter=verbose`
- Vitest 버전: v4.1.1

## 전체 결과 요약

| 항목 | 결과 |
|------|------|
| Test Files | 14 failed / 25 passed (총 39) |
| Tests | 52 failed / 269 passed (총 321) |
| Errors | 3 (Unhandled Exceptions) |
| Duration | 12.41s |

## TSK-02-04 관련 테스트 결과

**파일: `src/components/auth/__tests__/AuthGuard.test.tsx`**

| # | 테스트 | 결과 |
|---|--------|------|
| 1 | 로컬 모드 > children을 그대로 렌더링한다 | PASS |
| 2 | 로컬 모드 > 인증 상태와 관계없이 children을 렌더링한다 | PASS |
| 3 | 로컬 모드 > LoginPage를 표시하지 않는다 | PASS |
| 4 | 서버 모드 + 인증됨 > children을 렌더링한다 | PASS |
| 5 | 서버 모드 + 인증됨 > LoginPage를 표시하지 않는다 | PASS |
| 6 | 서버 모드 + 미인증 > LoginPage를 표시한다 | PASS |
| 7 | 서버 모드 + 미인증 > children을 렌더링하지 않는다 | PASS |
| 8 | 서버 모드 + 로딩 중 > 로딩 표시를 렌더링한다 | PASS |
| 9 | 서버 모드 + 로딩 중 > children을 렌더링하지 않는다 | PASS |
| 10 | 서버 모드 + 로딩 중 > LoginPage를 표시하지 않는다 | PASS |

**TSK-02-04 결과: 10/10 PASS (수정 불필요)**

## 기존 실패 목록 (TSK-02-04 무관)

### src/components/meeting/AudioPlayer.test.tsx (6 failed)
- 파형 컨테이너 div가 렌더링된다
- isReady=true일 때 재생 버튼이 표시된다
- 재생 버튼 클릭 시 play() 호출
- isPlaying=true일 때 정지 버튼이 표시된다
- 정지 버튼 클릭 시 pause() 호출
- 현재 재생 시간을 표시한다

### src/hooks/useAudioPlayer.test.ts (6 failed)
- 초기 상태: isReady=false, isPlaying=false, currentTimeMs=0
- play() 호출 시 wavesurfer.play() 실행
- pause() 호출 시 wavesurfer.pause() 실행
- seekTo(ms) 호출 시 wavesurfer.seekTo(ms/duration) 실행
- seekTo(0) 호출 시 wavesurfer.seekTo(0) 실행
- 반환 값에 isReady, isPlaying, currentTimeMs, play, pause, seekTo가 포함됨

### src/pages/MeetingLivePage.test.tsx (6 failed)
- "회의 시작" 버튼 렌더
- "회의 종료" 버튼은 회의 시작 전 비활성화
- 3영역 레이아웃 표시 (기록, 요약, 메모)
- "회의 시작" 클릭 시 startMeeting API 호출
- 회의 시작 후 녹음 표시등 표시
- "회의 종료" 클릭 시 stopMeeting API 호출

### src/pages/MeetingPage.test.tsx (9 failed)
- 회의 제목이 표시된다
- 에디터 영역이 렌더링된다
- AI 요약 섹션이 표시된다
- 요약이 없을 때 빈 상태 메시지를 표시한다
- 제목 클릭 시 인라인 편집 input이 표시된다
- 제목 편집 후 Enter 키 입력 시 updateMeeting API가 호출된다
- 삭제 버튼 클릭 시 deleteMeeting API가 호출된다
- 삭제 후 /dashboard로 이동한다
- getMeeting과 getSummary가 병렬 호출된다

### src/pages/MeetingsPage.test.tsx (7 failed)
- 회의 목록 페이지가 렌더링됨
- 팀 목록이 드롭다운에 표시됨
- 검색 입력창이 존재함
- 새 회의 버튼이 존재함
- 새 회의 버튼 클릭 시 모달이 열림
- 회의 생성 모달에서 회의 생성 성공
- 모달 취소 버튼 클릭 시 모달이 닫힘

### src/components/meeting/AiSummaryPanel.test.tsx (4 failed)
- AI 회의록 헤더 표시
- editable=false일 때 저장 버튼 미표시
- isRecording=true일 때 자동 저장 표시
- isRecording=false일 때 저장됨 버튼 표시

### src/components/meeting/ExportButton.test.tsx (2 failed)
- 버튼 클릭 시 옵션 패널이 표시된다
- 체크박스 해제 후 다운로드 시 올바른 옵션으로 API를 호출한다

### src/components/layout/Sidebar.test.tsx (1 failed)
- md 이하에서 숨김 클래스를 가짐

### src/hooks/useTranscription.test.ts (3 failed)
- partial 이벤트 수신 시 스토어 업데이트
- final 이벤트 수신 시 스토어 업데이트
- speaker_change 이벤트 수신 시 currentSpeaker 업데이트

### src/hooks/__tests__/useBlockSync.test.ts (1 failed)
- 빈 블록 배열 -> initialContent가 빈 배열로 설정된다

### src/api/meetings.test.ts (4 failed)
- getMeetings > 파라미터가 searchParams로 전달됨
- createMeeting > meetings 엔드포인트로 POST 요청
- createMeeting > 생성된 Meeting을 반환
- getMeetingDetail > 성공 시 meeting 데이터와 null error 반환

### src/hooks/useAudioRecorder.test.ts (3 failed)
- start() 성공 후 isRecording=true
- stop() 시 스트림 트랙 중지
- stop() 시 worklet에 flush 메시지 전송

### Unhandled Errors (3건, MeetingPage.test.tsx 발생)
- TypeError: n is not a constructor (react-resizable-panels)
- TypeError: window.matchMedia is not a function (@mantine/core)
- TypeError: window.matchMedia is not a function (@mantine/core cleanup)
