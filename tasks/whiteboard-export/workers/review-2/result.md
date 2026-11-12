# review-2 (상위 모델) — 10건 전부 수용
1 high running 고착(잡 사망·puma 재시작) → 7분 초과 running=죽은 것, POST 재enqueue, GET error(timeout), 프론트 GET 폴링
2 med-high requested_by_id FK on_delete 없음 → 사용자 삭제 500
3 med 협업자 채널 구독 거부(determine_role) → rejected 처리+폴링
4 med 동시 POST RecordNotUnique 500·중복 enqueue·옛 잡이 새 row 덮어씀 → lock/create_or_find_by, run_token CAS
5 med default 큐 3스레드 점유 → 전용 whiteboard 큐(threads 1) queue.yml 등록
6 low-med Rails cwd에서 claude 실행(CLAUDE.md·세션 기록) → tmpdir chdir, --no-session-persistence
7 low-med CliError stdout 버림 → stdout_tail로 auth/rate 판정
8 low-med Ruby strip 유니코드 공백 미처리 → 영구 format 오류 캐시. bullets 비문자열 처리 TS와 불일치
9 low 서버 '다시 만들기'가 캐시 반환 → stale/error일 때만 노출
10 low watcher 정리(로그아웃·reset)
확인함: 인가·클라 입력 미사용·인자 주입·sha·digest·재료·분류·기본값·KST 파급(export json만)·자동다운로드 없음·403/422·stale
