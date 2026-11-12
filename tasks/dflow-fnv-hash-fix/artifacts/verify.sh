#!/usr/bin/env bash
# wiki_fnv1a64 O(n) 재작성 검증 스크립트.
#
# 1) 임시 Postgres(5499)를 띄우고 0045 원본 함수를 wiki_fnv1a64_old 로, 0093 신규 함수를
#    wiki_fnv1a64 로 각각 등록한다.
# 2) 빈 문자열/ASCII/한글/이모지(서로게이트)/혼합/2~3만자 장문에서 old·new·JS(node) 세 값을 비교한다.
# 3) 5k/10k/20k/28.8k 한글에서 old·new 실행 시간을 \timing 으로 측정한다.
# 4) 결과를 artifacts/verify-result.md 에 기록하고, 끝나면 임시 Postgres 를 정지한다.
#
# wbs-web 워킹트리는 읽기 전용으로만 참조한다(0045 원본 함수 본문 추출). 아무것도 쓰지 않는다.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRATCH="/private/tmp/claude-501/-Users-jji-project-ddobakddobak/37189b71-b491-4b68-9c3f-414ab399cd2c/scratchpad"
PGDATA="$SCRATCH/pgdata"
PGBIN="/opt/homebrew/opt/postgresql@18/bin"
PORT=5499
HOST=127.0.0.1
NODE=/opt/homebrew/bin/node
WBS_MIGRATION="/Users/jji/project/wbs-web/supabase/migrations/0045_minutes_wiki.sql"
RESULT_MD="$SCRIPT_DIR/verify-result.md"

WORKDIR="$(mktemp -d "$SCRATCH/fnv_verify.XXXXXX")"
FIXDIR="$WORKDIR/fixtures"
PSQL=("$PGBIN/psql" -h "$HOST" -p "$PORT" -d postgres -X -v ON_ERROR_STOP=1)

cleanup() {
  "$PGBIN/pg_ctl" -D "$PGDATA" stop -m fast >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== 0. 픽스처 생성 ==" >&2
"$NODE" "$SCRIPT_DIR/gen_fixtures.mjs" "$FIXDIR"

echo "== 1. 임시 Postgres 기동 ==" >&2
"$PGBIN/pg_ctl" -D "$PGDATA" \
  -o "-p $PORT -c unix_socket_directories='' -c listen_addresses=127.0.0.1" \
  -l "$WORKDIR/pg.log" start
for i in $(seq 1 30); do
  "$PGBIN/pg_isready" -h "$HOST" -p "$PORT" >/dev/null 2>&1 && break
  sleep 0.5
done

echo "== 2. Supabase 역할 스텁 생성 (임시 DB에는 anon/authenticated/service_role 이 없다) ==" >&2
"${PSQL[@]}" -q -c "
do \$\$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role; end if;
end \$\$;
"

echo "== 3. old(0045 원본)/new(0093) 함수 등록 ==" >&2
awk '/^create or replace function public\.wiki_fnv1a64\(p_text text\)$/{flag=1} flag{print} flag && /^\$\$;$/{exit}' \
  "$WBS_MIGRATION" \
  | sed 's/function public\.wiki_fnv1a64(/function public.wiki_fnv1a64_old(/' \
  > "$WORKDIR/old_fn.sql"

"${PSQL[@]}" -q -f "$WORKDIR/old_fn.sql"
"${PSQL[@]}" -q -f "$SCRIPT_DIR/0093_wiki_fnv1a64_linear.sql"

# -- 동등성 검증 --
EQUIV_CASES=(empty ascii korean emoji mixed long20000 long28837)
PASS=0
FAIL=0
EQUIV_ROWS=""

for case in "${EQUIV_CASES[@]}"; do
  file="$FIXDIR/$case.txt"
  cat > "$WORKDIR/$case.sql" <<EOF
\set content \`cat $file\`
select public.wiki_fnv1a64_old(:'content') as old_hash, public.wiki_fnv1a64(:'content') as new_hash;
EOF
  row="$("${PSQL[@]}" -q -t -A -F'|' -f "$WORKDIR/$case.sql")"
  old_hash="$(echo "$row" | cut -d'|' -f1)"
  new_hash="$(echo "$row" | cut -d'|' -f2)"
  js_hash="$("$NODE" "$SCRIPT_DIR/fnv1a64.mjs" "$file")"

  if [[ "$old_hash" == "$new_hash" && "$new_hash" == "$js_hash" ]]; then
    status="PASS"
    PASS=$((PASS + 1))
  else
    status="FAIL"
    FAIL=$((FAIL + 1))
  fi
  len="$(wc -m < "$file" | tr -d ' ')"
  echo "[$status] $case (len=$len) old=$old_hash new=$new_hash js=$js_hash" >&2
  EQUIV_ROWS+="| $case | $len | \`$old_hash\` | \`$new_hash\` | \`$js_hash\` | $status |
"
done

# -- 성능 측정 --
TIMING_CASES=(kr5000 kr10000 kr20000 kr28800)
TIMING_ROWS=""

for case in "${TIMING_CASES[@]}"; do
  file="$FIXDIR/$case.txt"
  cat > "$WORKDIR/${case}_time.sql" <<EOF
\set content \`cat $file\`
\timing on
select public.wiki_fnv1a64_old(:'content');
select public.wiki_fnv1a64(:'content');
EOF
  out="$("${PSQL[@]}" -q -f "$WORKDIR/${case}_time.sql")"
  # 쿼리가 old, new 순서로 실행되므로 Time: 줄도 그 순서로 나온다 (1번째=old, 2번째=new).
  times=($(echo "$out" | grep -oE 'Time: [0-9.]+ ms' | grep -oE '[0-9.]+' || true))
  old_ms="${times[0]:-N/A}"
  new_ms="${times[1]:-N/A}"
  n="$(wc -m < "$file" | tr -d ' ')"
  echo "[TIMING] $case (n=$n): old=${old_ms}ms new=${new_ms}ms" >&2
  TIMING_ROWS+="| $case | $n | ${old_ms} ms | ${new_ms} ms |
"
done

echo "== 3. 임시 Postgres 정지 ==" >&2
"$PGBIN/pg_ctl" -D "$PGDATA" stop -m fast
trap - EXIT

cat > "$RESULT_MD" <<EOF
# wiki_fnv1a64 O(n) 재작성 — 검증 결과

측정 환경: 로컬 임시 Postgres 18(포트 $PORT), macOS. $(date '+%Y-%m-%d %H:%M %Z')

## 동등성 (old 0045 원본 vs new 0093 vs JS fnv1a64)

| case | 길이(문자) | old | new | js | 결과 |
|---|---:|---|---|---|---|
$EQUIV_ROWS

합계: PASS $PASS / FAIL $FAIL (총 ${#EQUIV_CASES[@]}건)

## 성능 (한글, psql \\timing)

| 길이 | 문자수 | old(0045) | new(0093) |
|---|---:|---:|---:|
$TIMING_ROWS
EOF

echo "== 완료: $RESULT_MD ==" >&2
echo "PASS=$PASS FAIL=$FAIL"
