# brief: be-fix2 (sonnet)
target_repo: /Users/jji/project/ddobakddobak · write_scope: backend/app/**, backend/config/queue.yml, backend/db/migrate/2026111200000*_create_meeting_whiteboards.rb, backend/db/schema.rb, backend/spec/**
근거: tasks/whiteboard-export/workers/review-2/result.md 1·2·4·5·6·7·8번 + 원 리뷰 상세는 각 번호 설명 참고
## 할 일
1. 고착: running && updated_at < 7분 전 → POST는 재enqueue, GET은 status "error"·error_kind "timeout" 보고.
2·4. 마이그(미배포, dev 서버 down): `bin/rails db:rollback` 후 수정 → requested_by FK `on_delete: :nullify`, `run_token` string 추가 → db:migrate. 컨트롤러 판정·갱신을 `with_lock`(신규는 create_or_find_by/RecordNotUnique rescue 재조회)로 원자화, enqueue 시 새 run_token 발급·잡 인자로 전달. 잡은 시작 시 token 불일치면 종료, 결과 쓰기는 `where(id:, run_token:).update_all` CAS, 불일치면 broadcast 안 함.
5. queue_as :whiteboard + config/queue.yml 워커 `- queues: whiteboard, threads: 1` 등록.
6. run_cli에 chdir: 옵션 → run_claude_whiteboard는 Dir.mktmpdir에서 실행, 인자에 `--no-session-persistence` 추가.
7. CliError에 stdout_tail(≤2000자) → Whiteboard::Failure 판정에 포함(사용자 메시지엔 미노출).
8. Board 검증 strip을 유니코드 공백 포함(`[[:space:]]`)으로. material bullets는 문자열 원소만(TS와 동일). POST 캐시 적중 시 저장 board 재검증 실패면 미스로 처리.
## 테스트
각 항목 spec + admin users 삭제 회귀(화이트보드 요청한 사용자 삭제 200). 관련 spec만 실행(전체 rspec 금지 — 오케스트레이터가 실행).
## Do NOT
프론트·src-tauri, 실제 claude, settings.yaml, dev 서버, 커밋.
