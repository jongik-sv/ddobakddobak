# wiki_fnv1a64 O(n) 재작성 — 검증 결과

측정 환경: 로컬 임시 Postgres 18(포트 5499), macOS. 2026-09-03 13:37 KST

## 동등성 (old 0045 원본 vs new 0093 vs JS fnv1a64)

| case | 길이(문자) | old | new | js | 결과 |
|---|---:|---|---|---|---|
| empty | 0 | `cbf29ce484222325` | `cbf29ce484222325` | `cbf29ce484222325` | PASS |
| ascii | 76 | `621962db54f63315` | `621962db54f63315` | `621962db54f63315` | PASS |
| korean | 35 | `ae02542c65669f18` | `ae02542c65669f18` | `ae02542c65669f18` | PASS |
| emoji | 40 | `e236ed7f1c9c4ef4` | `e236ed7f1c9c4ef4` | `e236ed7f1c9c4ef4` | PASS |
| mixed | 73 | `8ae50a65c4a120a5` | `8ae50a65c4a120a5` | `8ae50a65c4a120a5` | PASS |
| long20000 | 20000 | `040e2a0957cccb5a` | `040e2a0957cccb5a` | `040e2a0957cccb5a` | PASS |
| long28837 | 28837 | `826243d6ce830eee` | `826243d6ce830eee` | `826243d6ce830eee` | PASS |


합계: PASS 7 / FAIL 0 (총 7건)

## 성능 (한글, psql \timing)

| 길이 | 문자수 | old(0045) | new(0093) |
|---|---:|---:|---:|
| kr5000 | 5000 | 108.950 ms | 5.465 ms |
| kr10000 | 10000 | 441.142 ms | 12.786 ms |
| kr20000 | 20000 | 1863.284 ms | 16.798 ms |
| kr28800 | 28800 | 3811.641 ms | 26.202 ms |

