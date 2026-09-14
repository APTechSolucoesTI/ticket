-- Valores de configuração e precificação aceitam nove dígitos inteiros e
-- quatro casas decimais. Quantidades continuam limitadas a duas casas.
alter table apticket.contract_types
  alter column default_monthly_value type numeric(18,4),
  alter column price_per_equipment type numeric(18,4);

alter table apticket.contracts
  alter column extra_hour_price type numeric(18,4),
  alter column monthly_value type numeric(18,4);

alter table apticket.tabela_precos_avulso
  alter column valor_fixo type numeric(18,4),
  alter column valor_hora_tecnica type numeric(18,4);

alter table apticket.supplier_contracts
  alter column base_amount type numeric(18,4),
  alter column unit_price type numeric(18,4);

alter table apticket.operating_bank_accounts
  alter column opening_balance type numeric(18,4);

alter table apticket.supplier_approval_policies
  alter column minimum_amount type numeric(18,4),
  alter column maximum_amount type numeric(18,4);

alter table apticket.contracts
  drop constraint if exists contracts_dia_vencimento_check;

alter table apticket.contracts
  add constraint contracts_dia_vencimento_check
  check (dia_vencimento between 1 and 31);

create or replace function apticket.calcular_vencimento_medicao(
  p_competencia date,
  p_tipo_vencimento apticket.tipo_vencimento_contrato,
  p_dia_vencimento smallint,
  p_tenant_id uuid
)
returns date
language plpgsql
stable
strict
set search_path = pg_catalog, apticket
as $$
declare
  v_inicio_mes date := date_trunc('month', p_competencia)::date;
  v_ultimo_dia date := (v_inicio_mes + interval '1 month - 1 day')::date;
  v_data date;
  v_dias_uteis integer := 0;
begin
  if p_dia_vencimento not between 1 and 31 then
    raise exception using errcode = '22023', message = 'O dia de vencimento deve estar entre 1 e 31.';
  end if;

  if p_tipo_vencimento = 'fixo' then
    return make_date(
      extract(year from v_inicio_mes)::integer,
      extract(month from v_inicio_mes)::integer,
      least(p_dia_vencimento::integer, extract(day from v_ultimo_dia)::integer)
    );
  end if;

  v_data := v_inicio_mes;
  loop
    if apticket.eh_dia_util(v_data, p_tenant_id) then
      v_dias_uteis := v_dias_uteis + 1;
      if v_dias_uteis = p_dia_vencimento then
        return v_data;
      end if;
    end if;
    v_data := v_data + 1;
  end loop;

  return v_data;
end
$$;

revoke all on function apticket.calcular_vencimento_medicao(
  date,
  apticket.tipo_vencimento_contrato,
  smallint,
  uuid
) from public, anon;

grant execute on function apticket.calcular_vencimento_medicao(
  date,
  apticket.tipo_vencimento_contrato,
  smallint,
  uuid
) to authenticated, service_role;
