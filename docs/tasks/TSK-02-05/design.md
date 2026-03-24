# TSK-02-05: Rails TranscriptionChannel 구현 - 설계

## 구현 방향
ActionCable `TranscriptionChannel`로 브라우저 오디오 청크를 수신하고 `TranscriptionJob`을 통해 Sidecar에 전달한다.
STT 결과는 `transcripts` 테이블에 저장하고 `meeting_<id>_transcription` 스트림으로 브로드캐스트한다.
ApplicationCable::Connection은 JWT 토큰으로 인증하며, 채널 구독은 meeting_id 파라미터로 스트림을 식별한다.

## 파일 계획
| 파일 경로 | 역할 | 신규/수정 |
|---|---|---|
| `backend/app/channels/application_cable/connection.rb` | JWT 인증 ActionCable 연결 | 신규 |
| `backend/app/channels/application_cable/channel.rb` | 기본 채널 클래스 | 신규 |
| `backend/app/channels/transcription_channel.rb` | 오디오 수신 및 Job 디스패치 | 신규 |
| `backend/app/jobs/transcription_job.rb` | Sidecar 호출, DB 저장, 브로드캐스트 | 신규 |
| `backend/app/models/meeting.rb` | Meeting AR 모델 | 신규 |
| `backend/app/models/transcript.rb` | Transcript AR 모델 | 신규 |
| `backend/config/routes.rb` | ActionCable 마운트 추가 | 수정 |
| `backend/spec/channels/transcription_channel_spec.rb` | 채널 RSpec 테스트 | 신규 |
| `backend/spec/jobs/transcription_job_spec.rb` | Job RSpec 테스트 | 신규 |
| `backend/spec/factories/meetings.rb` | Meeting 팩토리 | 신규 |
| `backend/spec/factories/transcripts.rb` | Transcript 팩토리 | 신규 |

## 주요 구조
- `ApplicationCable::Connection` — JWT 파라미터 파싱, User 조회, identified_by :current_user
- `TranscriptionChannel#subscribed` — meeting_id 파라미터로 Meeting 조회, 스트림 등록
- `TranscriptionChannel#audio_chunk` — TranscriptionJob 비동기 큐잉
- `TranscriptionJob#perform` — SidecarClient 호출, Transcript 저장, ActionCable 브로드캐스트
- `Meeting` / `Transcript` — DB 스키마 기반 ActiveRecord 모델

## 데이터 흐름
브라우저 오디오청크 → `TranscriptionChannel#audio_chunk` → `TranscriptionJob` → `SidecarClient#transcribe` → `Transcript.create!` → `ActionCable.server.broadcast`

## 선행 조건
- TSK-02-06 SidecarClient 구현 완료
- DB 스키마: meetings, transcripts 테이블 존재 (TSK-00-04 설계 완료)
