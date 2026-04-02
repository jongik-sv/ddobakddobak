# TSK-05-02: 리팩토링 내역

## 변경 사항

| 파일 | 변경 내용 |
|------|-----------|
| `backend/app/models/meeting.rb` | `transcription_stream` 메서드 추가 — 스트림명 일원화 |
| `backend/app/channels/transcription_channel.rb` | 하드코딩 스트림명을 `meeting.transcription_stream`으로 교체 |
| `backend/app/models/meeting_participant.rb` | 하드코딩 스트림명을 `meeting.transcription_stream`으로 교체 |
| `backend/app/services/meeting_share_service.rb` | 하드코딩 스트림명을 `meeting.transcription_stream`으로 교체 |
| `backend/app/controllers/api/v1/meetings_controller.rb` | stop, feedback 액션의 하드코딩 스트림명을 `@meeting.transcription_stream`으로 교체 |
| `backend/app/jobs/transcription_job.rb` | 하드코딩 스트림명을 `meeting.transcription_stream`으로 교체 |
| `backend/app/jobs/meeting_summarization_job.rb` | 하드코딩 스트림명을 `meeting.transcription_stream`으로 교체 (2개소) |
| `backend/app/jobs/file_transcription_job.rb` | 하드코딩 스트림명을 `meeting.transcription_stream`으로 교체 (2개소) |
| `frontend/src/channels/transcription.ts` | `host_changed` -> `host_transferred` 이벤트명 수정 (백엔드와 일치), `recording_stopped` 핸들러 추가, `BackendMessage` 타입에서 불일치 필드명 수정 (`old_host_user_id`/`new_host_user_id` -> `new_host_id`/`new_host_name`/`meeting_id`) |
| `frontend/src/stores/sharingStore.ts` | `recordingStopped` 상태 + `setRecordingStopped` 액션 추가, `transferHost` 액션 추가 (기존 host를 viewer로 변경 + 새 host 설정을 단일 액션으로), `stopSharing`에서 `recordingStopped` 초기화 |

## 리팩토링 관점

### 1. 코드 중복 제거
- `"meeting_#{id}_transcription"` 스트림명이 8개 파일에 걸쳐 중복 사용됨 -> `Meeting#transcription_stream` 메서드로 일원화

### 2. 버그 수정 (동작 변경 없는 범위에서)
- 프론트엔드에서 `host_changed` 이벤트를 수신하지만 백엔드는 `host_transferred`를 전송하는 불일치 수정
- 프론트엔드에서 `recording_stopped` 이벤트 핸들러가 누락되어 있었으므로 추가
- `BackendMessage` 타입의 필드명이 백엔드 payload와 불일치 (`old_host_user_id`/`new_host_user_id` vs `new_host_id`/`new_host_name`)

### 3. 네이밍 개선
- `transferHost` 액션 신설: 기존에는 `updateParticipantRole`을 2회 호출하여 호스트 위임을 표현했으나, 단일 액션으로 의도를 명확히 전달

## 테스트 확인
- Backend (RSpec): **104 examples, 0 failures** — PASS
- Frontend (Vitest): **391 tests, 0 failures** — PASS
