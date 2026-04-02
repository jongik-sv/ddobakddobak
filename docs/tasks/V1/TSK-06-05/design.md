# TSK-06-05: 오디오 업로드 처리 (서버) - 설계

## 구현 방향

`POST /api/v1/meetings/:id/audio` 엔드포인트를 신규 생성하여 클라이언트가 보내는 WebM/Opus 파일을 수신한다. 수신된 파일은 ActiveStorage(로컬 디스크)를 통해 `storage/audio/{meeting_id}.webm` 경로에 저장하고, `meetings.audio_file_path` 컬럼에 해당 경로를 기록한다. 저장 완료 후 `AudioUploadJob`을 `perform_later`로 큐에 넣어 후처리(필요 시 트랜스크립션 트리거 등) 를 비동기로 수행한다. `GET /api/v1/meetings/:id/audio` 엔드포인트는 저장된 파일을 스트리밍 방식(`send_file`)으로 응답한다.

---

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|---|---|---|
| `backend/app/controllers/api/v1/meetings_audio_controller.rb` | 업로드(POST) 및 스트리밍(GET) 엔드포인트 | 신규 |
| `backend/app/jobs/audio_upload_job.rb` | 업로드 후처리 비동기 Job | 신규 |
| `backend/app/models/meeting.rb` | `has_one_attached :audio_file` 연관 추가 | 수정 |
| `backend/config/routes.rb` | audio 라우트 등록 | 수정 |
| `backend/spec/controllers/api/v1/meetings_audio_controller_spec.rb` | 업로드/스트리밍 컨트롤러 테스트 | 신규 |
| `backend/spec/jobs/audio_upload_job_spec.rb` | AudioUploadJob 단위 테스트 | 신규 |

---

## 주요 구조

```ruby
# app/controllers/api/v1/meetings_audio_controller.rb
module Api
  module V1
    class MeetingsAudioController < ApplicationController
      before_action :authenticate_user!
      before_action :set_meeting
      before_action :authorize_meeting_member!

      # POST /api/v1/meetings/:id/audio
      def create
        audio_file = params.require(:audio)

        unless valid_audio_content_type?(audio_file.content_type)
          render json: { error: "Invalid file type. Only WebM/Opus is supported." },
                 status: :unprocessable_entity
          return
        end

        dest_path = audio_dest_path(@meeting.id)
        FileUtils.mkdir_p(File.dirname(dest_path))
        FileUtils.cp(audio_file.tempfile.path, dest_path)

        @meeting.update!(audio_file_path: dest_path)

        AudioUploadJob.perform_later(meeting_id: @meeting.id)

        render json: { audio_file_path: @meeting.audio_file_path }, status: :created
      end

      # GET /api/v1/meetings/:id/audio
      def show
        path = @meeting.audio_file_path
        if path.blank? || !File.exist?(path)
          render json: { error: "Audio not found" }, status: :not_found
          return
        end

        send_file path,
                  type:        "audio/webm",
                  disposition: "inline",
                  filename:    "#{@meeting.id}.webm"
      end

      private

      def set_meeting
        @meeting = Meeting.find(params[:id])
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Meeting not found" }, status: :not_found
      end

      def authorize_meeting_member!
        unless @meeting.team.team_memberships.exists?(user: current_user)
          render json: { error: "Forbidden" }, status: :forbidden
        end
      end

      def valid_audio_content_type?(content_type)
        %w[audio/webm audio/ogg video/webm].include?(content_type)
      end

      def audio_dest_path(meeting_id)
        Rails.root.join("storage", "audio", "#{meeting_id}.webm").to_s
      end
    end
  end
end
```

```ruby
# app/jobs/audio_upload_job.rb
class AudioUploadJob < ApplicationJob
  queue_as :default

  def perform(meeting_id:)
    meeting = Meeting.find(meeting_id)
    return unless meeting.audio_file_path.present?

    Rails.logger.info "[AudioUploadJob] Audio ready for meeting=#{meeting_id} path=#{meeting.audio_file_path}"
    # 후처리 확장 포인트:
    # - 향후 트랜스크립션 완료 후 오디오가 없는 경우 재트리거
    # - 파일 유효성 검증 (크기, 재생 시간 등)
  rescue ActiveRecord::RecordNotFound
    Rails.logger.error "[AudioUploadJob] Meeting not found: #{meeting_id}"
  end
end
```

```ruby
# config/routes.rb (추가 부분)
resources :meetings, only: [] do
  member do
    post   :audio, to: "meetings_audio#create"
    get    :audio, to: "meetings_audio#show"
  end
end
```

```ruby
# app/models/meeting.rb (수정 부분)
class Meeting < ApplicationRecord
  # ... 기존 코드 ...
  has_one_attached :audio_file   # ActiveStorage 연관 (선택적 활용)
end
```

---

## 데이터 흐름

**업로드**: 클라이언트 `multipart/form-data POST /api/v1/meetings/:id/audio` → `MeetingsAudioController#create` → 파일을 `storage/audio/{id}.webm`에 복사 → `meetings.audio_file_path` 업데이트 → `AudioUploadJob.perform_later` → `{ audio_file_path }` JSON 응답

**스트리밍**: 클라이언트 `GET /api/v1/meetings/:id/audio` → `MeetingsAudioController#show` → `audio_file_path` 존재 확인 → `send_file` → `audio/webm` 스트리밍 응답

---

## 저장 경로 설계

| 항목 | 값 |
|---|---|
| 저장 루트 | `Rails.root/storage/audio/` |
| 파일명 형식 | `{meeting_id}.webm` |
| 예시 경로 | `storage/audio/42.webm` |
| `audio_file_path` 컬럼 저장값 | 절대 경로 문자열 (e.g. `/app/backend/storage/audio/42.webm`) |

`meetings` 테이블에는 이미 `audio_file_path string` 컬럼이 존재하므로 마이그레이션 불필요.

---

## API 스펙

### POST /api/v1/meetings/:id/audio

- **인증**: Bearer JWT 필수
- **Content-Type**: `multipart/form-data`
- **파라미터**: `audio` (file, 필수) — WebM/Opus 파일
- **성공 응답** `201 Created`:
  ```json
  { "audio_file_path": "/path/to/storage/audio/42.webm" }
  ```
- **오류 응답**:
  - `401 Unauthorized` — 인증 실패
  - `403 Forbidden` — 팀 비멤버
  - `404 Not Found` — 회의 없음
  - `422 Unprocessable Entity` — 파일 타입 오류

### GET /api/v1/meetings/:id/audio

- **인증**: Bearer JWT 필수
- **성공 응답** `200 OK`: `Content-Type: audio/webm`, 파일 스트리밍
- **오류 응답**:
  - `401 Unauthorized`
  - `403 Forbidden`
  - `404 Not Found` — 회의 없음 또는 오디오 미존재

---

## 선행 조건

- TSK-00-04: Rails API 서버 기본 구성 완료 (ApplicationController, 인증, routes 구조)
- `meetings` 테이블에 `audio_file_path string` 컬럼 존재 (이미 마이그레이션 완료)
- ActiveStorage 설정 완료 (`config/storage.yml`, 환경별 `config.active_storage.service`)
