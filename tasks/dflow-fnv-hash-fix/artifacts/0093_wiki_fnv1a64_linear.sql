-- 0093: wiki_fnv1a64 O(n) 재작성 — 멀티바이트 본문 500 오류 수정
--
-- 0045 의 구현은 `for i in 1..char_length(p_text) loop ascii(substr(p_text,i,1)) end loop` 로
-- 문자를 하나씩 substr 로 꺼낸다. PostgreSQL 의 멀티바이트(UTF8) text 는 문자 경계를 찾으려면
-- 앞에서부터 훑어야 하므로, substr(p_text, i, 1) 자체가 이미 O(i) 다. 이를 n 번 반복하면 전체는
-- O(n²) 이 된다. 실측(맥 로컬, 한글 28.8k자) 약 2.18초 — commit_minute_body_version RPC 가
-- 본문마다 이 함수를 2회 호출하므로, service_role 기본 statement_timeout(8s) 을 넘겨
-- "서버 오류가 발생했습니다" 500 으로 실패한다. 2026-09-03 또박또박 #176(22,837자) 전송 실패로 확인.
--
-- 고침: `string_to_array(p_text, null)` 로 문자열 전체를 한 번에 문자 배열로 분해(단일 O(n) 패스)한
-- 뒤 FOREACH 로 순회한다. 각 원소는 이미 한 글자이므로 ascii() 호출이 O(1) 이다. 해시 알고리즘·
-- surrogate pair 처리·산술(numeric mod 2^64 에뮬레이션)은 0045 원본과 완전히 동일하게 유지했다 —
-- 저장된 body_hash·원문 앵커 호환이 걸려 있어 결과값은 한 비트도 달라지면 안 된다. JS 정본
-- (src/lib/minutes/blocks.ts 의 fnv1a64) 및 0045 원본 함수와 빈 문자열·ASCII·한글·이모지(서로게이트
-- 쌍)·혼합·2~3만자 한글 장문에서 결과 동일함을 확인했다(verify.sh, verify-result.md).
--
-- 되돌리기: 0093_wiki_fnv1a64_linear_rollback.sql 로 0045 원본 정의를 복원한다(동작 동일, 성능만 원복).

create or replace function public.wiki_fnv1a64(p_text text)
returns text
language plpgsql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
declare
  v_hash       bigint := -3750763034362895579; -- 0xcbf29ce484222325 의 signed bigint 표현
  v_prime      constant numeric := 1099511628211;
  v_modulus    constant numeric := 18446744073709551616; -- 2^64
  v_sign       constant numeric := 9223372036854775808;  -- 2^63
  v_product    numeric;
  v_codepoint  integer;
  v_unit       integer;
  v_low_unit   integer;
  v_ch         text;
begin
  if p_text = '' then
    return 'cbf29ce484222325';
  end if;

  foreach v_ch in array string_to_array(p_text, null) loop
    v_codepoint := ascii(v_ch);

    -- JavaScript charCodeAt 은 U+10000 이상 문자를 surrogate pair 두 단위로 순회한다.
    if v_codepoint > 65535 then
      v_unit := 55296 + ((v_codepoint - 65536) / 1024);
      v_low_unit := 56320 + mod(v_codepoint - 65536, 1024);
    else
      v_unit := v_codepoint;
      v_low_unit := null;
    end if;

    v_hash := v_hash # v_unit::bigint;
    v_product := mod(v_hash::numeric * v_prime, v_modulus);
    if v_product < 0 then v_product := v_product + v_modulus; end if;
    if v_product >= v_sign then
      v_hash := (v_product - v_modulus)::bigint;
    else
      v_hash := v_product::bigint;
    end if;

    if v_low_unit is not null then
      v_hash := v_hash # v_low_unit::bigint;
      v_product := mod(v_hash::numeric * v_prime, v_modulus);
      if v_product < 0 then v_product := v_product + v_modulus; end if;
      if v_product >= v_sign then
        v_hash := (v_product - v_modulus)::bigint;
      else
        v_hash := v_product::bigint;
      end if;
    end if;
  end loop;

  return lpad(to_hex(v_hash), 16, '0');
end
$$;

revoke all on function public.wiki_fnv1a64(text) from public, anon, authenticated;
grant execute on function public.wiki_fnv1a64(text) to service_role;
