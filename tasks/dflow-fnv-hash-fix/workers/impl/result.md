# result — impl (sonnet subagent, 2026-09-03)

생성: artifacts/0093_wiki_fnv1a64_linear.sql, 0093_wiki_fnv1a64_linear_rollback.sql, README.md, verify.sh, gen_fixtures.mjs, fnv1a64.mjs, verify-result.md
방식: string_to_array(p_text, null) + FOREACH 순회. 알고리즘·surrogate·numeric 산술·시그니처·grant 는 0045 원본과 동일.
동등성: old(0045)/new(0093)/JS(blocks.ts fnv1a64) 7건 전부 일치 (빈문자열·ASCII·한글·이모지·혼합·20k·28.8k).
성능(한글): 5k 109ms→5ms, 10k 441→13ms, 20k 1863→17ms, 28.8k 3812→26ms.
wbs-web 미수정. 임시 Postgres 정지 확인.

## Verification Checklist
- [x] output_format 일치(파일 목록·동등성·timing·미해결)
- [x] 파일 경로 실존
- [x] task.md constraints(해시 동일·속성 유지·wbs-web 미수정)
- [x] Do NOT 위반 없음
