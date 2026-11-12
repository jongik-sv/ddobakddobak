# dflow-fnv-hash-fix

status: done (운영 적용·#176 재전송 성공 확인 2026-09-03)
created: 2026-09-03
target_repo: /Users/jji/project/wbs-web (D'Flow 로컬 clone, 직접 적용 안 함)
write_scope: tasks-only

## 목적

D'Flow(wbs-web) Supabase 함수 `public.wiki_fnv1a64(text)`가 plpgsql `substr(p_text, i, 1)` 루프라
멀티바이트 본문에서 O(n²). `commit_minute_body_version` RPC가 2회 호출 → 본문 ≈ 2만 자 이상이면
service_role 기본 statement_timeout(8s) 초과 → 500 `internal_error`. 2026-09-03 또박또박 #176(22,837자) 전송 실패 실증.

## 산출물

- `artifacts/0093_wiki_fnv1a64_linear.sql` — O(n) 재작성 마이그레이션 (D'Flow 팀 전달용)
- `artifacts/0093_wiki_fnv1a64_linear_rollback.sql` — 원래 정의 복원
- `artifacts/verify.sh` + 검증 결과 — 구현 동등성(JS fnv1a64 대비) + 성능 실측
- `artifacts/README.md` — 전달용 설명(원인·근거·적용 방법)

## 제약

- 해시 결과는 기존 함수·JS `fnv1a64`(src/lib/minutes/blocks.ts)와 비트 단위 동일해야 함 (저장된 body_hash 호환)
- 시그니처·속성(immutable strict parallel safe, search_path=pg_catalog, grant to service_role) 유지
- wbs-web 워킹트리 수정 금지 — artifacts 에만 산출

## workers_approved

- subagent(sonnet, 구현) — 사용자 요청 "D'Flow 쪽 수정 패치 초안 만들어줘"(2026-09-03)로 승인
