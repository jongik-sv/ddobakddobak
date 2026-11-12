# brief: fix-rust (sonnet)
target_repo: /Users/jji/project/ddobakddobak · write_scope: frontend/src-tauri/src/whiteboard.rs, frontend/src-tauri/src/environment.rs(build_path만)
근거: tasks/whiteboard-export/workers/review-1/result.md 1·2·5·6번
## 할 일
1. 프로세스 트리 종료: Unix는 자식을 새 프로세스 그룹(process_group(0) 또는 setsid)으로 띄우고 timeout·kill_all 때 killpg. Windows는 `taskkill /T /F /PID` (CREATE_NO_WINDOW). kill 뒤 reader join에 상한(예: 3초) 두고 넘으면 버림.
2. 시스템 프롬프트는 임시 파일에 써서 `--system-prompt-file <path>`로 전달, 실행 후 삭제. Windows는 claude.exe 우선, .cmd도 `cmd /C` 없이 Command::new 직접.
3. 인자에 `--tools ""` 추가(나머지 플래그 유지, --bare 금지).
4. environment.rs build_path: `std::env::split_paths`/`join_paths`로 OS 구분자 처리(Unix 동작 무변경).
5. detect_claude 결과 캐시: 성공 경로를 WhiteboardState에 저장해 재사용(실패는 캐시 안 함).
## 테스트
기존 6개 유지 + 프로세스 그룹 kill(자식이 sleep 손자를 띄우는 sh 스크립트 → timeout 후 손자도 죽고 함수가 상한 내 반환), 프롬프트 파일 전달(스크립트가 인자 파일 내용 출력), build_path Unix 회귀.
## Do NOT
Cargo.toml 수정(필요시 리포트), 실제 claude 실행, 커밋. 프론트 파일 수정 금지(다른 워커).
## 리포트
cargo check·cargo test 결과, 변경 요약.
