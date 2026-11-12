# result: tauri (요약 원문 보존)
- whiteboard.rs 신규, lib.rs: #[cfg(desktop)] mod, manage(WhiteboardState), desktop generate_handler 2개, Destroyed→kill_all
- detect_claude() -> Option<String> (sync) / run_claude_whiteboard(systemPrompt, userContent, timeoutSecs?) async+spawn_blocking
- reject: {kind: not_found|spawn|timeout|exit, message, stderr_tail, stdout_tail}
- cargo check OK, cargo test whiteboard 6/6
- 설계 차이: find_in_path(split_paths, win: claude.exe/.cmd/claude), stdin 별도 스레드, 시간 초과 시 프로세스 그룹 kill 안 함
- 미검증: Windows 컴파일, 실제 claude 인증
