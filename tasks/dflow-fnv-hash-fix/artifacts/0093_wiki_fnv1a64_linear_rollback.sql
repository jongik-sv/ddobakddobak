-- 0093 rollback — wiki_fnv1a64 를 0045 원본(substr 루프) 정의로 복원한다.
--
-- 결과값은 0093 과 완전히 동일하다(같은 해시 알고리즘). 되돌리는 것은 성능뿐이다 —
-- O(n) 대신 다시 O(n²) 이 되어, 2만자 이상 한글 본문에서 8초 타임아웃 문제가 재발한다.

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
  v_index      integer;
begin
  if p_text = '' then
    return 'cbf29ce484222325';
  end if;

  for v_index in 1..char_length(p_text) loop
    v_codepoint := ascii(substr(p_text, v_index, 1));

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
