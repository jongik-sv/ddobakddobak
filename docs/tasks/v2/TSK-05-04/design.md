# TSK-05-04: 회의 참여 UI (뷰어) - 설계

## 구현 방향
- 메인 화면(MeetingsPage)에 "회의 참여" 버튼을 추가하고, 공유 코드 입력 다이얼로그(JoinMeetingDialog)를 신규 생성한다.
- 뷰어 전용 페이지(MeetingViewerPage)를 신규 생성하여, 실시간 전사와 AI 요약만 읽기 전용으로 표시한다. 호스트의 MeetingLivePage와 레이아웃 구조를 공유하되, 녹음 컨트롤/편집/메모/내보내기/피드백 등 모든 조작 UI를 제거한다.
- `joinMeeting` API(TSK-05-01에서 구현 완료)로 회의에 참여 후, `useTranscription` 훅으로 TranscriptionChannel에 구독하여 실시간 전사 이벤트(partial, final, speaker_change, meeting_notes_update)를 수신한다.
- 녹음 종료 시 `recording_stopped` 이벤트(TSK-05-02에서 구현 완료)를 수신하여 종료 안내를 표시하고, 최종 회의록을 읽기 전용으로 열람할 수 있도록 한다.

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `frontend/src/pages/MeetingViewerPage.tsx` | 뷰어 전용 읽기 전용 페이지 (실시간 전사 + AI 요약 표시) | 신규 |
| `frontend/src/components/meeting/JoinMeetingDialog.tsx` | 공유 코드 입력 다이얼로그 | 신규 |
| `frontend/src/pages/MeetingsPage.tsx` | 헤더에 "회의 참여" 버튼 추가 → JoinMeetingDialog 열기 | 수정 |
| `frontend/src/App.tsx` | `/meetings/:id/viewer` 라우트 추가 | 수정 |
| `frontend/src/stores/sharingStore.ts` | 뷰어 모드 상태 추가 (viewerMeetingId) | 수정 |
| `frontend/src/components/meeting/ViewerHeader.tsx` | 뷰어 페이지 헤더 (회의 제목, 참여자 수, 종료 안내, 나가기 버튼) | 신규 |

## 주요 구조

### JoinMeetingDialog
- **Props:** `{ open: boolean; onClose: () => void }`
- 6자리 영숫자 공유 코드 입력 필드 (대문자 자동 변환, 최대 6자)
- "참여" 버튼 클릭 → `joinMeeting(shareCode)` API 호출
  - 성공 → `navigate(`/meetings/${meeting.id}/viewer`)` 로 뷰어 페이지 진입
  - 실패 → 에러 메시지 표시 ("유효하지 않은 코드입니다", "참여자 수가 초과되었습니다")
- 스타일: MeetingsPage의 CreateMeetingModal과 동일한 다이얼로그 패턴 사용

### MeetingViewerPage
- 뷰어 전용 읽기 전용 페이지. MeetingLivePage의 3영역 레이아웃 중 기록(좌) + AI 회의록(우) 2영역만 사용한다.
- **초기화 흐름:**
  1. `getMeeting(meetingId)` → 회의 정보 로드 (제목, 상태)
  2. `getTranscripts(meetingId)` → 기존 전사 기록 로드 → `transcriptStore.loadFinals`
  3. `getSummary(meetingId)` → 기존 AI 회의록 로드 → `transcriptStore.setMeetingNotes`
  4. `getParticipants(meetingId)` → 참여자 목록 로드 → `sharingStore`
  5. `useTranscription(meetingId)` → TranscriptionChannel 구독 (sendChunk는 사용하지 않음)
- **읽기 전용 제약:**
  - RecordTabPanel: 전사 목록만 표시 (삭제/편집 버튼 숨김)
  - AiSummaryPanel: onNotesChange 미전달 (편집 비활성화)
  - 메모 패널, 피드백 패널, 첨부 파일 섹션: 렌더링하지 않음
  - 녹음 컨트롤 (시작/정지/일시정지): 렌더링하지 않음
  - 공유 버튼, 초기화 버튼, 설정 버튼: 렌더링하지 않음
  - 내보내기 기능: 렌더링하지 않음
- **녹음 종료 처리:**
  - `recording_stopped` 이벤트 수신 → `sharingStore.recordingStopped === true`
  - 헤더에 "회의가 종료되었습니다" 안내 배너 표시
  - 최종 회의록은 계속 읽기 전용으로 열람 가능
  - 나가기 버튼으로 회의 목록으로 복귀

### ViewerHeader
- **Props:** `{ meetingId: number; title: string; participantCount: number; isRecordingStopped: boolean; onLeave: () => void }`
- 좌측: 뒤로가기(ArrowLeft) + "회의 참여 중" 라벨
- 중앙: 회의 제목 + 참여자 수 배지 + 녹음 상태 인디케이터 (실시간 녹음 중: 빨간 점 깜빡임 / 종료: "종료됨" 텍스트)
- 우측: "나가기" 버튼
- 녹음 종료 시: 헤더 하단에 파란색 안내 배너 "회의가 종료되었습니다. 최종 회의록을 확인하세요."

### sharingStore 확장
- `viewerMeetingId: number | null` — 뷰어로 참여 중인 회의 ID (뷰어 페이지 진입 시 설정, 나가기 시 null)
- `setViewerMeetingId: (id: number | null) => void`

### App.tsx 라우트 추가
```
<Route path="/meetings/:id/viewer" element={<AppLayout><MeetingViewerPage /></AppLayout>} />
```

## 데이터 흐름

### 회의 참여 진입
사용자 "회의 참여" 클릭 → JoinMeetingDialog 열림 → 공유 코드 입력 → `joinMeeting(shareCode)` API → 성공 응답 `{ meeting, participant }` → `navigate(`/meetings/${meeting.id}/viewer`)` → MeetingViewerPage 마운트 → 회의/전사/요약/참여자 로드 + TranscriptionChannel 구독 → 실시간 전사 수신 시작

### 실시간 전사 표시
호스트 녹음 → TranscriptionChannel broadcast(partial/final) → 뷰어 TranscriptionChannel received → transcriptStore.setPartial / addFinal → RecordTabPanel + AiSummaryPanel 자동 업데이트

### 녹음 종료 알림
호스트 "회의 종료" → MeetingsController#stop → ActionCable broadcast(recording_stopped) → 뷰어 received → sharingStore.setRecordingStopped(true) → ViewerHeader에 종료 안내 배너 표시 + 최종 회의록 유지

### 나가기
사용자 "나가기" 클릭 → transcriptStore.reset() + sharingStore.reset() → navigate('/meetings')

## 레이아웃

```
[ViewerHeader]
┌─ 좌: ArrowLeft "회의 참여 중" ─── 중: 회의제목 + 참여자(3) + 🔴녹음중 ─── 우: [나가기] ─┐

[녹음 종료 시 안내 배너]
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ℹ️ 회의가 종료되었습니다. 최종 회의록을 확인하세요.                                       │
└──────────────────────────────────────────────────────────────────────────────────────┘

[2영역 레이아웃]
┌─ 전사 기록 (30%) ──────────┬─ AI 회의록 (70%) ─────────────────┐
│                            │                                   │
│  RecordTabPanel            │  AiSummaryPanel (읽기 전용)         │
│  (읽기 전용, 삭제 버튼 없음)  │  (편집 비활성화)                    │
│                            │                                   │
│  SpeakerPanel (읽기 전용)   │                                   │
│                            │                                   │
│  ParticipantList           │                                   │
│  (넘기기 버튼 없음)          │                                   │
└────────────────────────────┴───────────────────────────────────┘

[하단 상태바]
┌─ 좌: 상태 ──────────────────────────────────────────── 우: 상태 메시지 ─┐
```

## 읽기 전용 구현 전략

기존 컴포넌트를 재사용하되 Props로 읽기 전용 모드를 제어한다:

| 컴포넌트 | 재사용 방식 |
|---------|-----------|
| RecordTabPanel | `readOnly` prop 추가 → 삭제/적용 버튼 숨김 |
| AiSummaryPanel | `onNotesChange`를 undefined로 전달 → 편집 비활성화 |
| SpeakerPanel | 그대로 사용 (이름 변경은 API 권한으로 차단됨) |
| ParticipantList | `isHost={false}` 전달 → 넘기기 버튼 숨김 |
| useTranscription | 그대로 사용 (sendChunk 미호출, 구독만 활용) |

## 선행 조건
- TSK-05-01 (회의 공유 모델 및 API) [xx] — joinMeeting, getParticipants API 구현 완료
- TSK-05-02 (실시간 전사 브로드캐스트) [xx] — viewer의 TranscriptionChannel 구독 허용, recording_stopped 이벤트 구현 완료
- TSK-05-03 (회의 공유 UI 호스트) [xx] — ShareButton, ParticipantList, sharingStore, transcription.ts 이벤트 핸들링 구현 완료
