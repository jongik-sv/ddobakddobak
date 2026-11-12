# brief: be-server (sonnet)
target_repo: /Users/jji/project/ddobakddobak · write_scope: backend/app/**, backend/config/routes.rb, backend/db/migrate/(1건)·db/schema.rb, backend/spec/**
정본: tasks/whiteboard-export/design.md §3·§5·§7·§11 (전부 읽을 것). 참고: frontend/src/lib/whiteboard/{prompt,material,schema,failure}.ts(TS 원본), meetings_controller.rb export(권한 before_action), card_extraction_job.rb(broadcast), llm_service.rb run_cli·claude_cli_available?
## 할 일
- 마이그(새 테이블 meeting_whiteboards) + 모델(Meeting has_one). dev 서버는 내려가 있음 → `bin/rails db:migrate`로 schema.rb 갱신 허용(새 테이블만).
- Whiteboard::Prompt(sha 고정 spec), material·digest, Whiteboard 파서/검증기, 실패 분류.
- LlmService: run_cli timeout 키워드, 공개 run_claude_whiteboard(§11.4 플래그, --system-prompt-file 임시파일·삭제).
- 컨트롤러 POST/GET + routes, WhiteboardExportJob(재요청 1회·broadcast).
## 테스트(rspec, CLI는 stub — 실제 claude 금지)
POST 403(copy·claude 없음)·422·200 캐시 적중·202 enqueue·running 중복 없음, GET none/done/stale, 비협업자 404/403, 잡 성공·펜스 제거·재요청 후 성공·format 실패·auth 분류·timeout, sha spec, LlmService 플래그 배열(--bare 없음, maybe_fallback 미호출).
⚠️ AppSettings는 tmp 파일로 격리(settings_whiteboard_spec 방식). 실제 settings.yaml 쓰기 금지.
## Do NOT
프론트 수정, 커밋, dev 서버 기동·요청.
## 리포트
마이그 파일명, 새 spec·전체 rspec 결과, settings.yaml 무변경 확인.
