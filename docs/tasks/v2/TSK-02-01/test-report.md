# TSK-02-01: 테스트 보고서

> updated: 2026-04-02

## 테스트 결과 요약

| 항목 | 결과 |
|------|------|
| 전체 테스트 수 | 252 |
| 통과 | 200 |
| 실패 | 52 |
| TSK-02-01 관련 테스트 | 12/12 통과 |
| Rust cargo check | 성공 |

## TSK-02-01 테스트 상세

### deepLinkParser.test.ts (7/7 통과)
- [PASS] 유효한 callback URL에서 token을 추출한다
- [PASS] token이 없으면 null을 반환한다
- [PASS] hostname이 callback이 아니면 null을 반환한다
- [PASS] protocol이 ddobak이 아니면 null을 반환한다
- [PASS] 잘못된 URL이면 null을 반환한다
- [PASS] URL-encoded token을 올바르게 처리한다
- [PASS] 빈 문자열이면 null을 반환한다

### useDeepLink.test.ts (5/5 통과)
- [PASS] onOpenUrl 리스너를 등록한다
- [PASS] 유효한 URL 수신 시 token을 localStorage에 저장한다
- [PASS] onToken 콜백을 호출한다
- [PASS] 잘못된 URL은 무시한다
- [PASS] 언마운트 시 리스너를 해제한다

## 기존 테스트 영향
- TSK-02-01 변경으로 인해 기존 테스트에 새롭게 발생한 실패는 없음
- 기존 52건의 실패는 모두 TSK-02-01 이전부터 존재하던 실패로, 이 태스크와 무관함

### 기존 실패 테스트 파일 목록 (14개 파일, 52건)
| 테스트 파일 | 실패 수 | 주요 원인 |
|-------------|---------|-----------|
| AudioPlayer.test.tsx | 6 | wavesurfer 모킹 이슈 |
| Sidebar.test.tsx | 1 | CSS 클래스 불일치 |
| MeetingLivePage.test.tsx | 6 | 컴포넌트 렌더링 이슈 |
| useAudioPlayer.test.ts | 6 | wavesurfer 모킹 이슈 |
| meetings.test.ts | 4 | API 모킹 이슈 |
| AiSummaryPanel.test.tsx | 4 | 컴포넌트 렌더링 이슈 |
| useBlockSync.test.ts | 1 | 빈 블록 배열 처리 |
| useTranscription.test.ts | 3 | 이벤트 스토어 이슈 |
| ExportButton.test.tsx | 2 | UI 상호작용 이슈 |
| MeetingEditor.test.tsx | 0 (에러) | 모듈 로드 에러 |
| App.test.tsx | 0 (에러) | 모듈 로드 에러 |
| MeetingPage.test.tsx | 9 | react-resizable-panels 모킹 이슈 |
| DashboardPage.test.tsx | 7 | 렌더링 타임아웃 |
| useMediaRecorder.test.ts | 3 | MediaStream 모킹 이슈 |

## 특이사항
- Rust `cargo check` 정상 통과 (0 errors, 0 warnings)
- TSK-02-01 관련 테스트 12건 전부 통과, 수정 필요 없음
- 기존 실패 52건은 주로 외부 라이브러리(wavesurfer, react-resizable-panels, mantine) 모킹 부족 및 jsdom 환경 제약(window.matchMedia 미지원 등)에서 기인
