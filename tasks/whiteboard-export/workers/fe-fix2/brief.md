# brief: fe-fix2 (sonnet)
target_repo: /Users/jji/project/ddobakddobak · write_scope: frontend/src/stores/whiteboardStore.ts, frontend/src/components/meeting/ExportButton.tsx, 로그아웃 시 정리 호출 1곳(authStore 등), 관련 테스트, frontend/src-tauri/src/whiteboard.rs(인자 1개 추가만)
근거: tasks/whiteboard-export/workers/review-2/result.md 1·3·9·10번
## 할 일
1. 서버 running 동안 GET 폴링(15초 간격, 최대 10분) — 채널 보조. GET이 done/error 주면 반영, 폴링 종료.
3. 채널 구독 rejected 콜백 → unwatch 후 폴링만으로 진행.
9. 서버 경로 done 상태 "다시 만들기"는 stale일 때만 노출(아니면 숨김). error면 "다시 시도" 유지.
10. disposeAll(): 모든 watcher·폴링 타이머 정리. 로그아웃 시와 store reset 시 호출.
11. Tauri run_claude_whiteboard 인자에 `--no-session-persistence` 추가(기존 테스트 유지), cargo check·cargo test whiteboard.
## 테스트
폴링 done 전이(가짜 타이머), rejected→폴링, 다시 만들기 노출 조건, disposeAll.
## Do NOT
백엔드·lib/whiteboard·api 수정, 커밋, dev 서버.
## 리포트
vitest(관련+전체), tsc -p tsconfig.app.json, vite build, cargo 결과.
