# brief — impl (sonnet subagent)

role: D'Flow Supabase 함수 `wiki_fnv1a64` O(n) 재작성 마이그레이션 초안 + 동등성·성능 검증
target_repo: /Users/jji/project/wbs-web (읽기 전용 참조. 절대 수정 금지)
write_scope: tasks-only → /Users/jji/project/ddobakddobak/tasks/dflow-fnv-hash-fix/artifacts/

## 배경
- 현재 정의: wbs-web `supabase/migrations/0045_minutes_wiki.sql` 의 `create or replace function public.wiki_fnv1a64(p_text text)` (그 아래 revoke/grant 2줄 포함). 사본: 스크래치 `fnv.sql`.
- 문제: `for i in 1..char_length loop ascii(substr(p_text,i,1))` → 멀티바이트에서 O(n²). 28.8k 한글 2.18s(맥). RPC가 2회 호출 → Supabase 8s statement_timeout 초과.
- JS 정본: wbs-web `src/lib/minutes/blocks.ts` `fnv1a64` (UTF-16 code unit 순회, 64-bit FNV-1a, 16자리 소문자 hex).

## 요구
1. `artifacts/0093_wiki_fnv1a64_linear.sql`: 같은 시그니처·속성(immutable strict parallel safe, set search_path = pg_catalog)으로 O(n) 재작성. 권장: `foreach v_ch in array string_to_array(p_text, null)` 순회(FOREACH 는 순차라 O(n)). 산술은 기존 numeric 방식 유지해도 되고 더 빠른 방법이 있으면 채택하되 결과 동일해야 함. surrogate pair(U+10000 이상) 처리 유지. 헤더 주석은 0092 스타일(원인·이유·되돌림 여부) 한국어로. revoke/grant 재선언 포함.
2. `artifacts/0093_wiki_fnv1a64_linear_rollback.sql`: 0045 원본 정의 복원.
3. `artifacts/verify.sh`: 임시 Postgres에서 (a) 원본 함수(`old`)와 신규 함수 결과 비교 — 빈 문자열, ASCII, 한글, 이모지(U+1F600 등 surrogate), 혼합, 20k~30k 한글 장문 (b) node 로 JS fnv1a64 를 같은 입력에 실행해 비교 (c) 5k/10k/20k/28.8k 한글 timing. 결과를 `artifacts/verify-result.md`에 기록.
4. `artifacts/README.md`: D'Flow 팀 전달용 — 증상·원인·근거 수치·적용 순서(supabase db push 또는 SQL editor)·되돌리기. 짧게.

## 임시 Postgres
- 바이너리 /opt/homebrew/opt/postgresql@18/bin. 데이터 디렉터리 이미 초기화됨: `<scratch>/pgdata` (중지 상태).
- 기동: `pg_ctl -D <scratch>/pgdata -o "-p 5499 -c unix_socket_directories='' -c listen_addresses=127.0.0.1" -l <scratch>/pg.log start`, 접속 `psql -h 127.0.0.1 -p 5499 -d postgres -X`. 끝나면 `pg_ctl ... stop -m fast`.
- scratch = /private/tmp/claude-501/-Users-jji-project-ddobakddobak/37189b71-b491-4b68-9c3f-414ab399cd2c/scratchpad

## Do NOT
- wbs-web 파일 수정·git 조작 금지. 커밋 금지.
- 해시 알고리즘 변경 금지(저장된 body_hash 호환 필수).

## output_format
최종 응답: 생성 파일 목록 + verify-result 요약(동등성 pass/fail 건수, timing 표) + 미해결 사항.
