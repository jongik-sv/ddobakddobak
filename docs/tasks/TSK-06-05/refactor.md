# TSK-06-05: 리팩토링 내역

## 변경 사항

| 파일 | 변경 내용 |
|------|-----------|
| `backend/app/controllers/api/v1/meetings_audio_controller.rb` | 허용 content type을 `ALLOWED_AUDIO_CONTENT_TYPES` 상수로 추출; 파일 저장 로직을 `save_audio_file` 메서드로, 파일 접근 검증을 `audio_file_accessible?` 메서드로 분리 |
| `backend/spec/requests/api/v1/meetings_audio_spec.rb` | `Rack::Test::UploadedFile` 생성 중복 코드를 `uploaded_file` 헬퍼로 통합; `webm_fixture`가 헬퍼를 위임하도록 변경; video/webm, audio/ogg, audio/mpeg 테스트 케이스에서 중복 제거 |

## 테스트 확인
- 결과: PASS
- TSK-06-05 관련 (meetings_audio_spec): 16 examples, 0 failures
- 전체 RSpec: 201 examples, 0 failures, 1 pending
