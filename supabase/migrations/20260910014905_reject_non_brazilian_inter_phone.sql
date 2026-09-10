begin;

create or replace function apticket_finance_private.normalize_inter_phone(value text)
returns text[]
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  raw_value text := btrim(coalesce(value, ''));
  digits text := regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g');
begin
  -- Um prefixo internacional explícito nunca pode ser interpretado como DDD.
  if left(raw_value, 1) = '+' and left(digits, 2) <> '55' then
    return array[null::text, null::text];
  end if;

  if length(digits) in (12, 13) and left(digits, 2) = '55' then
    digits := substring(digits from 3);
  end if;

  if length(digits) in (10, 11) then
    return array[left(digits, 2), substring(digits from 3)];
  end if;

  return array[null::text, null::text];
end
$$;

revoke all on function apticket_finance_private.normalize_inter_phone(text)
  from public, anon, authenticated, service_role;

commit;
