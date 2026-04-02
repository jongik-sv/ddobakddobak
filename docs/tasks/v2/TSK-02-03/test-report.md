# TSK-02-03 테스트 리포트

**작성일**: 2026-04-02
**테스트 환경**: Vitest v4.1.1

---

## 전체 테스트 결과 요약

| 항목 | 수치 |
|------|------|
| 전체 테스트 파일 | 38 |
| 통과 파일 | 24 |
| 실패 파일 | 14 |
| 전체 테스트 수 | 309 |
| 통과 | 257 |
| 실패 | 52 |
| 에러 | 3 |

---

## TSK-02-03 관련 테스트 결과

**결과: 전체 통과 (8 파일, 69 테스트)**

| 테스트 파일 | 테스트 수 | 결과 |
|------------|----------|------|
| `src/__tests__/config.test.ts` | 통과 | PASS |
| `src/stores/__tests__/authStore.test.ts` | 통과 | PASS |
| `src/api/__tests__/auth.test.ts` | 통과 | PASS |
| `src/api/__tests__/client.test.ts` | 통과 | PASS |
| `src/__tests__/lib/deepLinkParser.test.ts` | 통과 | PASS |
| `src/__tests__/hooks/useDeepLink.test.ts` | 통과 | PASS |
| `src/hooks/__tests__/useAuth.test.ts` | 통과 | PASS |
| `src/components/auth/__tests__/LoginPage.test.tsx` | 통과 | PASS |

---

## Pre-existing 실패 목록 (TSK-02-03 무관)

아래 14개 파일은 TSK-02-03 변경 사항과 관련 없는 기존 실패입니다.

| 테스트 파일 | 실패 수 / 전체 | 원인 요약 |
|------------|---------------|----------|
| `src/components/meeting/AudioPlayer.test.tsx` | 6/8 | WaveSurfer mock 관련 |
| `src/pages/MeetingLivePage.test.tsx` | 6/6 | 컴포넌트 렌더링 실패 |
| `src/components/layout/Sidebar.test.tsx` | 1/6 | CSS 클래스 검증 실패 |
| `src/hooks/useAudioPlayer.test.ts` | 6/6 | WaveSurfer mock 관련 |
| `src/hooks/__tests__/useBlockSync.test.ts` | 1/11 | 빈 블록 배열 초기화 |
| `src/components/meeting/AiSummaryPanel.test.tsx` | 4/4 | 컴포넌트 렌더링 실패 |
| `src/api/meetings.test.ts` | 4/11 | API client mock 불일치 |
| `src/components/meeting/ExportButton.test.tsx` | 2/6 | 이벤트 핸들러 검증 실패 |
| `src/App.test.tsx` | 0 (에러) | 테스트 실행 에러 |
| `src/components/editor/MeetingEditor.test.tsx` | 0 (에러) | import 에러 |
| `src/pages/MeetingPage.test.tsx` | 9/9 | react-resizable-panels 호환 문제 |
| `src/pages/MeetingsPage.test.tsx` | 7/11 | 컴포넌트 렌더링 실패 |
| `src/hooks/useAudioRecorder.test.ts` | 3/11 | AudioWorklet mock 관련 |
| `src/hooks/useTranscription.test.ts` | 3/8 | WebSocket mock 관련 |

---

## 수정 이력

수정 없음. TSK-02-03 관련 테스트 69개 모두 첫 실행에서 통과.

---

## 결론

TSK-02-03 (로그인 흐름 구현) 관련 테스트는 모두 정상 통과합니다.
실패한 52개 테스트는 모두 pre-existing 실패로, TSK-02-03 작업과 무관합니다.
