# wiki_fnv1a64 — O(n) 재작성 패치

## 증상

회의록 본문이 대략 2만 자를 넘으면 위키 전송(`commit_minute_body_version` RPC)이
"서버 오류가 발생했습니다" 500 으로 실패한다. 2026-09-03 또박또박 #176(22,837자)에서 실증.

## 원인

`supabase/migrations/0045_minutes_wiki.sql` 의 `public.wiki_fnv1a64(text)` 가

```sql
for v_index in 1..char_length(p_text) loop
  v_codepoint := ascii(substr(p_text, v_index, 1));
  ...
```

형태로, 문자를 한 글자씩 `substr` 로 꺼낸다. PostgreSQL 의 UTF8 text 는 문자 경계를 찾으려면
앞에서부터 훑어야 해서 `substr(p_text, i, 1)` 자체가 이미 O(i) 다. 이를 n 번 반복하므로 전체는
O(n²) 이 된다. `commit_minute_body_version` 이 본문마다 이 함수를 2회 호출하는데, 본문이
길어지면 service_role 기본 statement_timeout(8초)을 넘겨 버린다.

## 근거 수치 (로컬 임시 Postgres 18, 한글 본문)

| 길이 | 기존(O(n²)) | 수정 후(O(n)) |
|---|---:|---:|
| 5,000자 | 109 ms | 5 ms |
| 10,000자 | 441 ms | 13 ms |
| 20,000자 | 1,863 ms | 17 ms |
| 28,800자 | 3,812 ms | 26 ms |

28,800자 기준 약 145배 빨라진다. RPC 가 함수를 2회 호출해도 새 버전은 총 60ms 안팎이라
8초 타임아웃과 무관해진다. 전체 실측 표는 `verify-result.md` 참고.

## 고침

`string_to_array(p_text, null)` 로 문자열 전체를 한 번에 문자 배열로 분해(단일 O(n) 패스)한 뒤
`FOREACH` 로 순회한다. 각 원소가 이미 한 글자이므로 `ascii()` 호출이 O(1) 이 되어 전체가 O(n) 이
된다. 해시 알고리즘·surrogate pair 처리·64비트 산술은 원본과 완전히 동일하게 유지했다 — 저장된
`body_hash` 및 회의록 원문 앵커 호환이 걸려 있으므로 결과값은 한 비트도 달라지면 안 된다.

빈 문자열·ASCII·한글·이모지(서로게이트 쌍 포함)·혼합 텍스트·2~3만자 한글 장문 7건에서
- 기존 함수(old)
- 새 함수(new)
- JS 정본 `fnv1a64`(`src/lib/minutes/blocks.ts`)

세 값이 모두 일치함을 확인했다(7/7 PASS). 상세 절차는 `verify.sh`, 결과는 `verify-result.md`.

## 적용 순서

1. `0093_wiki_fnv1a64_linear.sql` 을 D'Flow 프로젝트의 `supabase/migrations/` 에 그대로 추가
   (파일명 그대로 사용, 마이그레이션 번호가 이미 0093 이상이면 다음 번호로 재명명).
2. `npm run db:apply --target <staging|prod> (이 리포 규칙, supabase db push 아님)` 로 적용하거나, Supabase 대시보드 SQL editor 에서 파일 내용을 그대로 실행.
3. 함수는 `create or replace` 라 다운타임 없이 즉시 교체된다. 기존 `body_hash` 값과의 호환은
   깨지지 않는다(알고리즘 동일, 위 검증 참고).

## 되돌리기

`0093_wiki_fnv1a64_linear_rollback.sql` 을 실행하면 0045 원본(O(n²)) 정의로 복원된다.
결과값은 동일하고 성능만 원래대로 되돌아간다(= 2만 자 이상 본문에서 타임아웃 재발).

## 참고

- 원본 함수: `supabase/migrations/0045_minutes_wiki.sql` (`public.wiki_fnv1a64`)
- JS 정본: `src/lib/minutes/blocks.ts` (`fnv1a64`, `FNV_OFFSET`/`FNV_PRIME`)
- 검증 스크립트: `verify.sh` (+ `gen_fixtures.mjs`, `fnv1a64.mjs`) — 로컬에 임시 Postgres 를
  띄워 재실행할 수 있다. wbs-web 워킹트리는 0045 원본 함수 본문을 읽기만 하고 아무것도 쓰지 않는다.
