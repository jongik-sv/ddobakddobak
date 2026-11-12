# brief: tauri (sonnet)
target_repo: /Users/jji/project/ddobakddobak · write_scope: frontend/src-tauri/src/whiteboard.rs(신규), frontend/src-tauri/src/lib.rs(등록·종료 kill만)
정본: tasks/whiteboard-export/design.md §8 (반드시 읽을 것). 참고: frontend/src-tauri/src/environment.rs(resolve_shell_path, which), lib.rs의 desktop invoke_handler·Destroyed 처리, backend/app/services/llm_service.rb call_claude_cli(플래그 원본)
## 할 일
- detect_claude, run_claude_whiteboard 커맨드 구현(§8 그대로). std::process + 스레드, tokio feature 추가 금지. spawn_blocking으로 UI 비차단.
- 진행 중 child 레지스트리(managed state) + 창 Destroyed 시 kill.
- desktop handler 블록에만 등록(Android/모바일 블록 건드리지 말 것). cfg 게이트가 모바일 빌드를 깨지 않게.
- Windows 분기(.cmd·CREATE_NO_WINDOW)는 cfg(windows)로 컴파일만 되게.
- 단위 테스트: 시간 초과 kill(가짜 실행 파일 `sleep` 스크립트 경로를 주입할 수 있게 내부 함수에 binary 경로 인자), 실행 파일 없음→not_found, stdin 전달·stdout 수집(cat 스크립트).
## Do NOT
- Cargo.toml 수정 금지(필요하면 리포트로 제안). 실제 claude 실행 금지. 커밋 금지.
## 검증·리포트
`cd frontend/src-tauri && cargo check` 와 `cargo test whiteboard` 결과, 커맨드 시그니처, 에러 JSON 형태.
