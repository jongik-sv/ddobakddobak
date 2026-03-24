# TSK-03-04: 회의 진행 페이지 - 설계

## 구현 방향
MeetingLivePage는 3영역 레이아웃(실시간 자막 | AI 요약 | 메모)을 제공한다.
회의 시작 버튼 클릭 시 API 호출 → AudioRecorder + useTranscription 활성화.
회의 종료 시 녹음 중지 → 오디오 Blob 업로드 → 최종 요약 트리거.
meetings.ts API 클라이언트로 start/stop/uploadAudio 엔드포인트를 래핑한다.

## 파일 계획
| 파일 경로 | 역할 | 신규/수정 |
|---|---|---|
| frontend/src/api/meetings.ts | 회의 관련 API 클라이언트 | 신규 |
| frontend/src/pages/MeetingLivePage.tsx | 회의 진행 페이지 | 신규 |
| frontend/src/pages/MeetingLivePage.test.tsx | 페이지 단위 테스트 | 신규 |
| frontend/src/App.tsx | /meetings/:id/live 라우트 추가 | 수정 |

## 주요 구조
- `startMeeting(id)` / `stopMeeting(id)` / `uploadAudio(id, blob)` – API 함수
- `MeetingLivePage` – URL 파라미터에서 meetingId 추출, 회의 상태(idle/recording/stopped) 관리
- 3영역: LiveTranscript | AI 요약 패널 | 메모 텍스트에어리어
- 녹음 상태 표시: 🔴 + "녹음 중" 인디케이터

## 데이터 흐름
시작 버튼 → startMeeting(API) → useAudioRecorder.start() + useTranscription 활성화
종료 버튼 → useAudioRecorder.stop() → onStop(blob) → uploadAudio(API) → stopMeeting(API)

## 선행 조건
- TSK-03-01 완료 (useAudioRecorder)
- TSK-03-02 완료 (useTranscription, transcriptStore)
- TSK-03-03 완료 (LiveTranscript)
- 백엔드 POST /api/v1/meetings/:id/start, :id/stop 엔드포인트
