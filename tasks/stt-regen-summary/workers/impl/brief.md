# brief: impl (sonnet)
작업 위치(전부 여기서): /Users/jji/project/ddobakddobak-stt-summary (git worktree, 브랜치 feature/stt-regen-summary)
write_scope: backend/app/controllers/api/v1/meetings_controller.rb(regenerate_stt만), backend/app/jobs/file_transcription_job.rb, backend/spec/**, frontend/src/pages/MeetingPage.tsx(STT 확인 문구), frontend/src/components/meeting/AudioAppendFlowDialog.tsx(문구), 관련 테스트
## 현재
FileTranscriptionJob: 화자분리 ON이면 generate_summary 생략("화자 이름 지정 후 회의록을 생성하세요").
## 할 일
1. FileTranscriptionJob#perform(meeting_id, force_summary = false). force_summary면 화자분리 ON이어도 generate_summary 실행. 요약 직전 progress "AI 회의록(요약) 생성 중…" broadcast, 완료 메시지 기존 유지. 파일 업로드 등 기존 호출 동작 무변경.
2. regenerate_stt: perform_later(@meeting.id, true).
3. 문구: MeetingPage STT 재생성 ConfirmDialog → "기존 트랜스크립트와 회의록이 모두 삭제되고, 저장된 오디오로 처음부터 다시 생성됩니다. 음성 인식이 끝나면 AI 회의록(요약)도 이어서 자동으로 생성합니다. 계속하시겠습니까?" AudioAppendFlowDialog ask-retranscribe·retranscribing에도 "요약까지 이어서 생성" 안내 추가.
## 테스트
rspec: force_summary true+화자분리 ON → generate_summary 호출, false+ON → 미호출(기존), regenerate_stt가 true로 enqueue. vitest: 문구 존재.
## 준비
worktree는 새 체크아웃: backend에서 `RAILS_ENV=test bin/rails db:test:prepare` 후 rspec. frontend node_modules는 심볼릭 링크됨. settings.yaml 쓰기·dev 서버 요청·커밋 금지.
## 리포트
관련 rspec·vitest, tsc -p tsconfig.app.json 결과, 변경 요약.
