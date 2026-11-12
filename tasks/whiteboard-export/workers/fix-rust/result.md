# result: fix-rust (요약)
- Unix process_group(0)+kill(-pid,9) (extern "C" kill, libc 직접 의존 없음), Windows taskkill /T /F, reader 채널+3초 상한
- --system-prompt-file 임시 파일(실행 후 삭제), --tools "", .cmd도 Command::new 직접
- environment.rs prepend_path split_paths/join_paths + 회귀 테스트
- detect_claude(app) 성공 경로 캐시(로그인 셸 PATH 해결은 매번)
- cargo check OK, test whiteboard 9/9, environment 1/1. Windows 미컴파일
