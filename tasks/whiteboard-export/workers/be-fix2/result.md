# result: be-fix2 (요약)
- 마이그 재작성(미배포): requested_by FK on_delete nullify, run_token. rollback→migrate
- 고착 7분: POST 재enqueue, GET error/timeout 보고(DB 미변경)
- create_or_find_by!+with_lock, run_token CAS(0행이면 broadcast 안 함), 잡 perform(meeting_id, digest, user_id=nil, run_token=nil)
- queue :whiteboard + queue.yml threads 1, run_cli chdir: tmpdir, --no-session-persistence
- CliError stdout_tail→classify, Board strip 유니코드, bullets 문자열만, 캐시 적중 재검증
- spec 176 중 1 단언 오류 수정 후 해당 5건 재통과. 전체 rspec은 오케스트레이터
