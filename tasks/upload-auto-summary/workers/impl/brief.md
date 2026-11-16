# brief: impl
- target_repo: /Users/jji/project/ddobakddobak-upload-summary (이 worktree에서만 작업, 커밋 금지)
- write_scope: backend/**, frontend/src/**
## 목표
파일 업로드 후 FileTranscriptionJob이 화자분리 ON이어도 AI 회의록(요약)까지 자동 생성.
## 할 일
1. backend/app/jobs/file_transcription_job.rb: `diarization_config["enable"] && !force_summary` 스킵 분기 제거, 항상 generate_summary. perform(meeting_id, force_summary = false) 시그니처는 유지(구 큐 잡 호환, 인자 무시 주석).
2. regenerate_stt(meetings_controller.rb:489)의 `true` 인자는 제거해도 됨.
3. frontend/src에서 업로드 흐름 문구 중 "화자 이름 지정 후 회의록 생성" 류 수동 생성 안내가 있으면 "요약까지 자동 생성"으로 정정. 없으면 변경 없음.
4. 관련 spec(backend/spec/jobs/file_transcription_job_spec.rb, requests meetings_spec) 갱신: 화자분리 ON 업로드도 요약 호출 검증.
## Do NOT
- 러닝 dev 서버에 실요청, 실 settings.yaml 수정 금지(spec stub만)
- 화자분리 설정 로직·re_diarize_job 변경 금지
## 검증
- `cd backend && bundle exec rspec spec/jobs/file_transcription_job_spec.rb spec/requests/api/v1/meetings_spec.rb`
- 프론트 변경 시 `cd frontend && npx tsc -p tsconfig.app.json --noEmit` 및 관련 vitest
## output_format
변경 파일 목록, diff 요약, 실행한 테스트 결과 원문 요약.
