# brief: be-settings (sonnet)
target_repo: /Users/jji/project/ddobakddobak · write_scope: backend/app/controllers/api/v1/settings_controller.rb, backend/app/services/llm_service.rb, backend/config/routes.rb, backend/spec/**
정본: tasks/whiteboard-export/design.md §9 (반드시 읽을 것). 참고: settings_controller.rb의 dflow/update_dflow 패턴, application_controller.rb require_admin!, app/services/app_settings.rb
## 할 일
- GET /api/v1/settings/whiteboard(로그인 전원), PUT(require_admin!, web_mode 검증·422) — routes 233행 부근 settings 묶음에 추가.
- LlmService.claude_cli_available? 공개 클래스 메서드. 기존 private cli_available?/cli_binary_for 로직을 클래스 메서드로 올리고 인스턴스는 위임(동작 무변경).
- 기본값 copy.
## 테스트(rspec, request spec)
GET 기본값 copy, server_claude_available true/false(stub), PUT admin 저장·비admin 403(server_mode 켠 상태)·잘못된 값 422. 기존 llm_service spec 회귀 없음.
⚠️ AppSettings.load/save! 또는 SETTINGS_PATH를 tmp 파일로 격리 — 실제 settings.yaml을 절대 쓰지 말 것(기존 spec의 격리 방식 grep해 재사용).
## Do NOT
- dev 서버 요청 금지, 마이그 금지, 커밋 금지.
## 검증·리포트
새 spec + settings·llm_service 관련 spec 실행 결과, 응답 JSON 예시.
