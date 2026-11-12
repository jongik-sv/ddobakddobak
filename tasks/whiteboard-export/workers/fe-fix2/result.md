# result: fe-fix2 (요약)
- 서버 running GET 폴링 15초·최대 10분, rejected→unwatch+폴링, disposeAll(authStore 구독으로 로그아웃 시)
- 서버 done '다시 만들기'는 stale일 때만
- Tauri --no-session-persistence
- vitest 241 files/2244 pass, tsc 0, build OK, cargo check OK, cargo test whiteboard 9
