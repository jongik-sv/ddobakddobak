# TSK-02-02 서버 URL 설정 UI — 테스트 리포트

- **실행일**: 2026-04-02
- **브랜치**: dev/WP-02
- **테스트 도구**: Vitest v4.1.1

---

## 1. 전체 테스트 결과

| 항목 | 결과 |
|------|------|
| 총 테스트 파일 | 32 |
| 통과 파일 | 18 |
| 실패 파일 | 14 |
| 총 테스트 케이스 | 252 |
| 통과 | 200 |
| 실패 | 52 |
| 에러 | 3 (Unhandled Errors) |

---

## 2. ServerSetup 관련 테스트 결과 (TSK-02-02)

**파일**: `src/components/auth/__tests__/ServerSetup.test.tsx`
**결과**: **22/22 통과 (100%)**

### 상세 테스트 목록

| # | 그룹 | 테스트명 | 결과 |
|---|------|---------|------|
| 1 | 초기 렌더링 | 로컬 실행 / 서버 연결 모드 선택 카드가 표시된다 | PASS |
| 2 | 초기 렌더링 | 시작하기 버튼이 표시된다 | PASS |
| 3 | 초기 렌더링 | 모드 미선택 시 시작하기 버튼이 비활성화된다 | PASS |
| 4 | 서버 연결 모드 선택 | 서버 연결 선택 시 URL 입력 필드가 표시된다 | PASS |
| 5 | 서버 연결 모드 선택 | 서버 모드에서 헬스체크 미완료 시 시작하기 버튼이 비활성화된다 | PASS |
| 6 | 로컬 실행 모드 선택 | 로컬 실행 선택 시 URL 입력 필드가 표시되지 않는다 | PASS |
| 7 | 로컬 실행 모드 선택 | 로컬 모드 선택 시 시작하기 버튼이 활성화된다 | PASS |
| 8 | 헬스체크 성공 | 서버 URL 입력 후 헬스체크 성공 시 연결 성공 메시지가 표시된다 | PASS |
| 9 | 헬스체크 성공 | 헬스체크 성공 후 시작하기 버튼이 활성화된다 | PASS |
| 10 | 헬스체크 실패 | 서버 응답 오류 시 에러 메시지가 표시된다 | PASS |
| 11 | 헬스체크 실패 | 네트워크 에러 시 연결 불가 메시지가 표시된다 | PASS |
| 12 | 헬스체크 실패 | 타임아웃 에러 시 시간 초과 메시지가 표시된다 | PASS |
| 13 | 설정 저장 | 로컬 모드 선택 후 시작하기 시 localStorage에 mode=local 저장 | PASS |
| 14 | 설정 저장 | 서버 모드에서 헬스체크 성공 후 시작하기 시 localStorage에 mode=server, server_url 저장 | PASS |
| 15 | 기존 설정 복원 | localStorage에 mode=local이 있으면 로컬 모드가 선택된 상태로 렌더링 | PASS |
| 16 | 기존 설정 복원 | localStorage에 mode=server, server_url이 있으면 서버 모드와 URL이 복원된다 | PASS |
| 17 | URL 정규화 | 후행 슬래시가 있는 URL로 헬스체크 시 슬래시 제거 후 요청 | PASS |
| 18 | URL 정규화 | 후행 슬래시가 있는 URL 저장 시 슬래시가 제거된다 | PASS |
| 19 | onComplete 콜백 | 로컬 모드에서 시작하기 클릭 시 onComplete가 호출된다 | PASS |
| 20 | onComplete 콜백 | 서버 모드에서 헬스체크 성공 후 시작하기 클릭 시 onComplete가 호출된다 | PASS |
| 21 | URL 미입력 | URL 미입력 시 연결 확인 버튼이 비활성화된다 | PASS |
| 22 | URL 변경 시 상태 리셋 | 헬스체크 성공 후 URL을 변경하면 상태가 리셋된다 | PASS |

---

## 3. 실패한 테스트 분석

### TSK-02-02 관련 여부: 없음

52개 실패 테스트 모두 TSK-02-02 이전부터 존재하는 기존 실패이다. main 브랜치에서도 동일하게 (또는 더 많이) 실패한다. TSK-02-02에서 수정한 파일(ServerSetup.tsx, ServerSetup.test.tsx)은 기존 테스트에 영향을 주지 않는다.

### 기존 실패 테스트 파일 목록 (14개)

| 파일 | 실패/전체 | 주요 원인 |
|------|-----------|----------|
| src/api/meetings.test.ts | 4/11 | API 모킹 불일치 (fetch mock) |
| src/hooks/useAudioPlayer.test.ts | 6/6 | WaveSurfer 모듈 mock 실패 |
| src/hooks/useAudioRecorder.test.ts | 3/11 | AudioWorklet 비동기 타이밍 이슈 |
| src/hooks/useTranscription.test.ts | 3/8 | ActionCable 채널 mock 불일치 |
| src/hooks/__tests__/useBlockSync.test.ts | 1/11 | 빈 블록 배열 초기화 로직 |
| src/components/meeting/AudioPlayer.test.tsx | 6/8 | useAudioPlayer mock 실패 전파 |
| src/components/meeting/AiSummaryPanel.test.tsx | 4/4 | Mantine Provider mock 미설정 |
| src/components/meeting/ExportButton.test.tsx | 2/6 | 비동기 다운로드 핸들링 |
| src/components/layout/Sidebar.test.tsx | 1/6 | 라우팅 관련 mock 누락 |
| src/components/editor/MeetingEditor.test.tsx | 0/0 | import 에러 (BlockNote 호환성) |
| src/pages/MeetingPage.test.tsx | 9/9 | react-resizable-panels + MantineProvider 호환 |
| src/pages/MeetingLivePage.test.tsx | 6/6 | MantineProvider mock 미설정 |
| src/pages/MeetingsPage.test.tsx | 7/11 | API 비동기 mock 타이밍 |
| src/App.test.tsx | 0/0 | import 에러 (의존성 충돌) |

---

## 4. 결론

- TSK-02-02 ServerSetup 컴포넌트 테스트: **22/22 전수 통과**
- 기존 코드에 대한 영향: **없음** (기존 실패 패턴 변동 없음)
- TSK-02-02 코드 수정 필요 여부: **없음**
