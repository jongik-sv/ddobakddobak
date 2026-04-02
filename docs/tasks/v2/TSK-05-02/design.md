# TSK-05-02: 실시간 전사 브로드캐스트 - 설계

## 구현 방향
- TranscriptionChannel의 `subscribed` 콜백을 확장하여, 회의 소유자뿐 아니라 MeetingParticipant에 등록된 활성 참여자(viewer)도 구독할 수 있도록 권한 검증 로직을 추가한다.
- MeetingParticipant 모델에 `after_create_commit` / `after_update_commit` 콜백을 추가하여 participant_joined, participant_left 이벤트를 TranscriptionChannel 스트림으로 자동 브로드캐스트한다.
- MeetingsController#stop 액션에 recording_stopped 이벤트 브로드캐스트를 추가하여 viewer에게 녹음 종료를 알린다.
- MeetingShareService의 transfer_host에서 host_transferred 이벤트를 브로드캐스트한다.
- 참여자 수 제한(20명)은 이미 MeetingShareService에 구현되어 있으므로 추가 작업 불필요.

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `backend/app/channels/transcription_channel.rb` | subscribed 콜백에 참여자 권한 검증 추가 (소유자 OR 활성 참여자), viewer의 audio_chunk 전송 차단 | 수정 |
| `backend/app/models/meeting_participant.rb` | after_create_commit / after_update_commit 콜백 추가 → participant_joined / participant_left 브로드캐스트 | 수정 |
| `backend/app/services/meeting_share_service.rb` | transfer_host에 host_transferred 브로드캐스트 추가, leave_meeting 자동 위임 시 host_transferred 브로드캐스트 | 수정 |
| `backend/app/controllers/api/v1/meetings_controller.rb` | stop 액션에 recording_stopped 이벤트 브로드캐스트 추가 | 수정 |
| `frontend/src/channels/transcription.ts` | recording_stopped, host_transferred 이벤트 핸들러 추가 (BackendMessage 타입 확장) | 수정 |
| `frontend/src/stores/sharingStore.ts` | recordingStopped 상태/액션 추가 | 수정 |
| `backend/spec/channels/transcription_channel_spec.rb` | viewer 구독 허용/거부, 소유자 구독, 미인증 거부 테스트 | 신규 |
| `backend/spec/models/meeting_participant_spec.rb` | 콜백 브로드캐스트 테스트 (participant_joined, participant_left) | 수정 |
| `backend/spec/services/meeting_share_service_spec.rb` | host_transferred 브로드캐스트 테스트 | 수정 |

## 주요 구조

### TranscriptionChannel#subscribed (수정)
- 기존: `Meeting.find_by(id:)` 후 무조건 `stream_from`
- 변경: 권한 검증 추가
  - `meeting.created_by_id == current_user.id` (소유자) → 허용
  - `MeetingParticipant.exists?(meeting_id:, user_id: current_user.id, left_at: nil)` (활성 참여자) → 허용
  - 그 외 → `reject`
- `@role` 인스턴스 변수 저장 (host/viewer/owner)
- `audio_chunk` 액션에서 `@role`이 viewer이면 전송 차단 (owner 또는 host만 오디오 전송 가능)

### MeetingParticipant 콜백 (수정)
- `after_create_commit :broadcast_participant_joined`
  - `ActionCable.server.broadcast("meeting_#{meeting_id}_transcription", { type: "participant_joined", participant_id: id, user_id: user_id, user_name: user.name, role: role, joined_at: joined_at })`
- `after_update_commit :broadcast_participant_left, if: -> { saved_change_to_left_at? && left_at.present? }`
  - `ActionCable.server.broadcast("meeting_#{meeting_id}_transcription", { type: "participant_left", user_id: user_id, user_name: user.name })`

### MeetingShareService#transfer_host (수정)
- 트랜잭션 후 `ActionCable.server.broadcast("meeting_#{meeting.id}_transcription", { type: "host_transferred", new_host_id: target_user_id, new_host_name: target_user.name })`
- `auto_delegate_host!` 메서드에도 동일한 host_transferred 브로드캐스트 추가

### MeetingsController#stop (수정)
- `@meeting.update!` 후 `ActionCable.server.broadcast("meeting_#{@meeting.id}_transcription", { type: "recording_stopped", meeting_id: @meeting.id })`

### 프론트엔드 이벤트 핸들러 (수정)
- `transcription.ts`의 `received` 핸들러에 `recording_stopped`, `host_transferred` case 추가
- `sharingStore.ts`에 `recordingStopped: boolean` 상태 + `setRecordingStopped` 액션 추가

## 데이터 흐름

### 참여자 입장 브로드캐스트
뷰어 → POST /meetings/join → MeetingShareService#join_meeting → MeetingParticipant.create! → after_create_commit → ActionCable broadcast(participant_joined) → 모든 구독자의 received 콜백 → sharingStore.addParticipant

### 참여자 퇴장 브로드캐스트
뷰어 → POST /meetings/:id/leave → MeetingShareService#leave_meeting → participant.update!(left_at:) → after_update_commit → ActionCable broadcast(participant_left) → 모든 구독자의 received 콜백 → sharingStore.removeParticipant

### 녹음 종료 브로드캐스트
호스트 → POST /meetings/:id/stop → MeetingsController#stop → @meeting.update!(status: completed) → ActionCable broadcast(recording_stopped) → viewer의 received 콜백 → sharingStore.setRecordingStopped(true) → UI에서 종료 안내 표시

### 호스트 위임 브로드캐스트
호스트 → POST /meetings/:id/transfer_host → MeetingShareService#transfer_host → role 변경 트랜잭션 → ActionCable broadcast(host_transferred) → 모든 구독자의 received 콜백 → sharingStore.updateParticipantRole

### viewer의 채널 구독 (실시간 전사 수신)
뷰어 → ActionCable subscribe(TranscriptionChannel, meeting_id) → subscribed 콜백 → MeetingParticipant.exists?(active) 검증 → stream_from "meeting_{id}_transcription" → 이후 모든 전사 이벤트(partial, final, speaker_change, meeting_notes_update) 수신

## 선행 조건
- TSK-05-01 (회의 공유 모델 및 API) [xx] -- 완료됨
  - MeetingParticipant 모델, MeetingShareService, share_code, Meeting#sharing? 등 모두 구현됨
  - 프론트엔드 sharingStore, transcription.ts의 participant_joined/participant_left/host_changed 핸들러도 이미 존재
