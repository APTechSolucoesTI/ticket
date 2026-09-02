do $$
begin
  create type apticket.status_medicao_contrato as enum ('gerada', 'faturada', 'cancelada');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type apticket.tipo_item_medicao as enum ('equipamento', 'servico', 'pacote_horas');
exception
  when duplicate_object then null;
end
$$;

grant usage on type apticket.status_medicao_contrato, apticket.tipo_item_medicao
  to authenticated, service_role;

create table if not exists apticket.feriados (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references apticket.tenants(id) on delete cascade,
  data date not null,
  nome text not null check (char_length(btrim(nome)) between 1 and 160),
  abrangencia text not null default 'nacional'
    check (abrangencia in ('nacional', 'estadual', 'municipal', 'tenant')),
  created_at timestamptz not null default now()
);

create unique index if not exists feriados_tenant_data_nome_uidx
  on apticket.feriados (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), data, nome);
create index if not exists feriados_data_idx on apticket.feriados (data);
create index if not exists feriados_tenant_data_idx on apticket.feriados (tenant_id, data);

alter table apticket.feriados enable row level security;

drop policy if exists "feriados select" on apticket.feriados;
create policy "feriados select" on apticket.feriados
for select to authenticated
using (
  (tenant_id is null or tenant_id = apticket.current_tenant_id())
  and apticket.has_permission(auth.uid(), 'contratos', 'view')
);

revoke all on table apticket.feriados from public, anon, authenticated;
grant select on table apticket.feriados to authenticated;
grant all on table apticket.feriados to service_role;

create or replace function apticket.data_pascoa(p_ano integer)
returns date
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
  a integer;
  b integer;
  c integer;
  d integer;
  e integer;
  f integer;
  g integer;
  h integer;
  i integer;
  k integer;
  l integer;
  m integer;
  mes integer;
  dia integer;
begin
  a := p_ano % 19;
  b := p_ano / 100;
  c := p_ano % 100;
  d := b / 4;
  e := b % 4;
  f := (b + 8) / 25;
  g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30;
  i := c / 4;
  k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  mes := (h + l - 7 * m + 114) / 31;
  dia := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(p_ano, mes, dia);
end
$$;

revoke all on function apticket.data_pascoa(integer) from public, anon;
grant execute on function apticket.data_pascoa(integer) to authenticated, service_role;

insert into apticket.feriados (tenant_id, data, nome, abrangencia)
select null, make_date(ano, mes, dia), nome, 'nacional'
from generate_series(2020, 2040) as ano
cross join (
  values
    (1, 1, 'Confraternização Universal'),
    (4, 21, 'Tiradentes'),
    (5, 1, 'Dia Mundial do Trabalho'),
    (9, 7, 'Independência do Brasil'),
    (10, 12, 'Nossa Senhora Aparecida'),
    (11, 2, 'Finados'),
    (11, 15, 'Proclamação da República'),
    (11, 20, 'Dia Nacional de Zumbi e da Consciência Negra'),
    (12, 25, 'Natal')
) as fixo(mes, dia, nome)
on conflict do nothing;

insert into apticket.feriados (tenant_id, data, nome, abrangencia)
select null, apticket.data_pascoa(ano) + deslocamento, nome, 'nacional'
from generate_series(2020, 2040) as ano
cross join (
  values
    (-48, 'Carnaval'),
    (-47, 'Carnaval'),
    (-2, 'Paixão de Cristo'),
    (60, 'Corpus Christi')
) as movel(deslocamento, nome)
on conflict do nothing;

create table if not exists apticket.medicoes_contrato (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id) on delete cascade,
  contrato_id uuid not null references apticket.contracts(id) on delete restrict,
  numero_contrato text not null,
  cliente_nome text not null,
  tipo_contrato_nome text,
  competencia date not null,
  data_medicao date not null default current_date,
  modelo_cobranca text not null
    check (modelo_cobranca in ('hours_package', 'per_equipment', 'per_service')),
  valor_total numeric(14,2) not null check (valor_total >= 0),
  emite_nf boolean not null,
  emite_boleto boolean not null,
  data_vencimento date not null,
  status apticket.status_medicao_contrato not null default 'gerada',
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint medicoes_contrato_competencia_primeiro_dia_check
    check (competencia = date_trunc('month', competencia)::date),
  constraint medicoes_contrato_contrato_competencia_key
    unique (contrato_id, competencia)
);

create index if not exists medicoes_contrato_tenant_competencia_idx
  on apticket.medicoes_contrato (tenant_id, competencia desc);
create index if not exists medicoes_contrato_contrato_idx
  on apticket.medicoes_contrato (contrato_id, competencia desc);
create index if not exists medicoes_contrato_status_idx
  on apticket.medicoes_contrato (tenant_id, status, data_vencimento);

create table if not exists apticket.medicao_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id) on delete cascade,
  medicao_id uuid not null references apticket.medicoes_contrato(id) on delete cascade,
  tipo_item apticket.tipo_item_medicao not null,
  referencia_id uuid,
  referencia text,
  descricao text not null check (char_length(btrim(descricao)) between 1 and 500),
  quantidade numeric(10,2) not null default 1 check (quantidade > 0),
  valor_unitario numeric(14,2) not null check (valor_unitario >= 0),
  valor_total numeric(14,2) not null check (valor_total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists medicao_itens_medicao_idx
  on apticket.medicao_itens (medicao_id);
create index if not exists medicao_itens_tenant_idx
  on apticket.medicao_itens (tenant_id);

alter table apticket.medicoes_contrato enable row level security;
alter table apticket.medicao_itens enable row level security;

drop policy if exists "medicoes_contrato select" on apticket.medicoes_contrato;
create policy "medicoes_contrato select" on apticket.medicoes_contrato
for select to authenticated
using (
  tenant_id = apticket.current_tenant_id()
  and apticket.has_permission(auth.uid(), 'contratos', 'view')
);

drop policy if exists "medicao_itens select" on apticket.medicao_itens;
create policy "medicao_itens select" on apticket.medicao_itens
for select to authenticated
using (
  tenant_id = apticket.current_tenant_id()
  and apticket.has_permission(auth.uid(), 'contratos', 'view')
);

revoke all on table apticket.medicoes_contrato from public, anon, authenticated;
revoke all on table apticket.medicao_itens from public, anon, authenticated;
grant select on table apticket.medicoes_contrato, apticket.medicao_itens to authenticated;
grant all on table apticket.medicoes_contrato, apticket.medicao_itens to service_role;

create or replace function apticket.eh_dia_util(p_data date, p_tenant_id uuid)
returns boolean
language sql
stable
strict
set search_path = pg_catalog, apticket
as $$
  select
    extract(isodow from p_data) not in (6, 7)
    and not exists (
      select 1
      from apticket.feriados
      where data = p_data
        and (tenant_id is null or tenant_id = p_tenant_id)
    );
$$;

revoke all on function apticket.eh_dia_util(date, uuid) from public, anon;
grant execute on function apticket.eh_dia_util(date, uuid) to authenticated, service_role;

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
  if p_dia_vencimento not between 1 and 30 then
    raise exception using errcode = '22023', message = 'O dia de vencimento deve estar entre 1 e 30.';
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
end
$$;

revoke all on function apticket.calcular_vencimento_medicao(date, apticket.tipo_vencimento_contrato, smallint, uuid)
  from public, anon;
grant execute on function apticket.calcular_vencimento_medicao(date, apticket.tipo_vencimento_contrato, smallint, uuid)
  to authenticated, service_role;

create or replace function apticket.bloquear_alteracao_medicao()
returns trigger
language plpgsql
set search_path = pg_catalog, apticket
as $$
begin
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception using errcode = '55000', message = 'A medição é histórica e não pode ser alterada.';
  end if;
  return new;
end
$$;

revoke all on function apticket.bloquear_alteracao_medicao() from public, anon;
grant execute on function apticket.bloquear_alteracao_medicao() to authenticated, service_role;

drop trigger if exists medicoes_contrato_bloquear_alteracao on apticket.medicoes_contrato;
create trigger medicoes_contrato_bloquear_alteracao
before update on apticket.medicoes_contrato
for each row execute function apticket.bloquear_alteracao_medicao();

create or replace function apticket.bloquear_alteracao_item_medicao()
returns trigger
language plpgsql
set search_path = pg_catalog, apticket
as $$
begin
  raise exception using errcode = '55000', message = 'Os itens da medição são históricos e não podem ser alterados.';
end
$$;

revoke all on function apticket.bloquear_alteracao_item_medicao() from public, anon;
grant execute on function apticket.bloquear_alteracao_item_medicao() to authenticated, service_role;

drop trigger if exists medicao_itens_bloquear_alteracao on apticket.medicao_itens;
create trigger medicao_itens_bloquear_alteracao
before update on apticket.medicao_itens
for each row execute function apticket.bloquear_alteracao_item_medicao();

create or replace function apticket.gerar_medicoes_contrato(
  p_contrato_id uuid default null,
  p_competencia date default current_date,
  p_forcar boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, apticket
as $$
declare
  v_tenant_id uuid := apticket.current_tenant_id();
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
  v_servico boolean := v_role = 'service_role';
  v_competencia date := date_trunc('month', coalesce(p_competencia, current_date))::date;
  v_contrato record;
  v_ultima_competencia date;
  v_intervalo_meses integer;
  v_elegivel boolean;
  v_medicao_id uuid;
  v_quantidade integer;
  v_valor_unitario numeric(14,2);
  v_valor_total numeric(14,2);
  v_data_vencimento date;
  v_processados integer := 0;
  v_geradas integer := 0;
  v_ignoradas integer := 0;
  v_erros integer := 0;
  v_detalhes jsonb := '[]'::jsonb;
begin
  if not v_servico then
    if auth.uid() is null or v_tenant_id is null then
      raise exception using errcode = '42501', message = 'Sessão inválida para gerar medições.';
    end if;

    if not apticket.has_permission(auth.uid(), 'contratos', 'edit') then
      raise exception using errcode = '42501', message = 'Sem permissão para gerar medições de contratos.';
    end if;
  end if;

  for v_contrato in
    select
      c.*,
      company.name as cliente_nome,
      contract_type.name as tipo_contrato_nome
    from apticket.contracts as c
    join apticket.companies as company on company.id = c.company_id
    left join apticket.contract_types as contract_type on contract_type.id = c.contract_type_id
    where c.status = 'active'
      and (p_contrato_id is null or c.id = p_contrato_id)
      and (v_servico or c.tenant_id = v_tenant_id)
      and c.starts_at <= (v_competencia + interval '1 month - 1 day')::date
      and date_trunc('month', c.ends_at)::date >= v_competencia
    order by c.tenant_id, c.created_at, c.id
  loop
    v_processados := v_processados + 1;

    begin
      select max(competencia)
      into v_ultima_competencia
      from apticket.medicoes_contrato
      where contrato_id = v_contrato.id
        and deleted_at is null;

      v_intervalo_meses := case v_contrato.tipo_medicao
        when 'mensal' then 1
        when 'trimestral' then 3
        when 'semestral' then 6
        when 'anual' then 12
        else null
      end;

      if p_forcar then
        v_elegivel := true;
      elsif v_contrato.tipo_medicao = 'unica' then
        v_elegivel := v_ultima_competencia is null and current_date >= v_contrato.starts_at;
      elsif v_ultima_competencia is null then
        v_elegivel := v_competencia >= date_trunc('month', v_contrato.starts_at)::date;
      else
        v_elegivel := v_competencia >= (v_ultima_competencia + make_interval(months => v_intervalo_meses))::date;
      end if;

      if not v_elegivel then
        v_ignoradas := v_ignoradas + 1;
        v_detalhes := v_detalhes || jsonb_build_array(jsonb_build_object(
          'contrato_id', v_contrato.id,
          'numero_contrato', v_contrato.numero_contrato,
          'resultado', 'fora_do_ciclo'
        ));
        continue;
      end if;

      if exists (
        select 1 from apticket.medicoes_contrato
        where contrato_id = v_contrato.id and competencia = v_competencia
      ) then
        v_ignoradas := v_ignoradas + 1;
        v_detalhes := v_detalhes || jsonb_build_array(jsonb_build_object(
          'contrato_id', v_contrato.id,
          'numero_contrato', v_contrato.numero_contrato,
          'resultado', 'ja_medida'
        ));
        continue;
      end if;

      if v_contrato.billing_model = 'per_equipment' then
        select count(*)::integer
        into v_quantidade
        from apticket.contract_equipments as link
        join apticket.equipments as equipment on equipment.id = link.equipment_id
        where link.contract_id = v_contrato.id
          and link.tenant_id = v_contrato.tenant_id
          and equipment.tenant_id = v_contrato.tenant_id
          and equipment.status = 'active';

        if v_quantidade = 0 then
          raise exception 'O contrato por equipamento não possui equipamentos ativos vinculados.';
        end if;

        select (tier ->> 'price')::numeric(14,2)
        into v_valor_unitario
        from jsonb_array_elements(v_contrato.equipment_tiers) as tier
        where v_quantidade between (tier ->> 'min')::integer and (tier ->> 'max')::integer
        order by (tier ->> 'min')::integer desc
        limit 1;

        if v_valor_unitario is null then
          raise exception 'A quantidade de equipamentos (%) não está coberta por uma faixa de preço.', v_quantidade;
        end if;

        v_valor_total := round(v_quantidade * v_valor_unitario, 2);
      elsif v_contrato.billing_model = 'per_service' then
        if jsonb_array_length(v_contrato.service_items) = 0 then
          raise exception 'O contrato por serviço não possui serviços vinculados.';
        end if;

        select coalesce(sum(
          coalesce((item ->> 'quantity')::numeric, 0)
          * coalesce((item ->> 'price')::numeric, 0)
        ), 0)::numeric(14,2)
        into v_valor_total
        from jsonb_array_elements(v_contrato.service_items) as item;
      elsif v_contrato.billing_model = 'hours_package' then
        v_valor_total := v_contrato.monthly_value::numeric(14,2);
      else
        raise exception 'Modelo de cobrança não suportado: %.', v_contrato.billing_model;
      end if;

      v_data_vencimento := apticket.calcular_vencimento_medicao(
        v_competencia,
        v_contrato.tipo_vencimento,
        v_contrato.dia_vencimento,
        v_contrato.tenant_id
      );

      insert into apticket.medicoes_contrato (
        tenant_id,
        contrato_id,
        numero_contrato,
        cliente_nome,
        tipo_contrato_nome,
        competencia,
        data_medicao,
        modelo_cobranca,
        valor_total,
        emite_nf,
        emite_boleto,
        data_vencimento
      ) values (
        v_contrato.tenant_id,
        v_contrato.id,
        v_contrato.numero_contrato,
        v_contrato.cliente_nome,
        v_contrato.tipo_contrato_nome,
        v_competencia,
        current_date,
        v_contrato.billing_model,
        v_valor_total,
        v_contrato.emite_nf,
        v_contrato.emite_boleto,
        v_data_vencimento
      )
      returning id into v_medicao_id;

      if v_contrato.billing_model = 'per_equipment' then
        insert into apticket.medicao_itens (
          tenant_id, medicao_id, tipo_item, referencia_id, referencia,
          descricao, quantidade, valor_unitario, valor_total
        )
        select
          v_contrato.tenant_id,
          v_medicao_id,
          'equipamento',
          equipment.id,
          coalesce(equipment.asset_tag, equipment.serial_number),
          concat_ws(' - ', equipment.name, nullif(equipment.asset_tag, ''), nullif(equipment.serial_number, '')),
          1,
          v_valor_unitario,
          v_valor_unitario
        from apticket.contract_equipments as link
        join apticket.equipments as equipment on equipment.id = link.equipment_id
        where link.contract_id = v_contrato.id
          and link.tenant_id = v_contrato.tenant_id
          and equipment.tenant_id = v_contrato.tenant_id
          and equipment.status = 'active'
        order by equipment.name, equipment.id;
      elsif v_contrato.billing_model = 'per_service' then
        insert into apticket.medicao_itens (
          tenant_id, medicao_id, tipo_item, referencia, descricao,
          quantidade, valor_unitario, valor_total
        )
        select
          v_contrato.tenant_id,
          v_medicao_id,
          'servico',
          nullif(item ->> 'reference', ''),
          coalesce(nullif(item ->> 'description', ''), nullif(item ->> 'reference', ''), 'Serviço vinculado'),
          (item ->> 'quantity')::numeric(10,2),
          (item ->> 'price')::numeric(14,2),
          round((item ->> 'quantity')::numeric * (item ->> 'price')::numeric, 2)
        from jsonb_array_elements(v_contrato.service_items) as item;
      else
        insert into apticket.medicao_itens (
          tenant_id, medicao_id, tipo_item, descricao,
          quantidade, valor_unitario, valor_total
        ) values (
          v_contrato.tenant_id,
          v_medicao_id,
          'pacote_horas',
          format('Pacote de %s horas', v_contrato.hours_monthly_quota),
          1,
          v_valor_total,
          v_valor_total
        );
      end if;

      v_geradas := v_geradas + 1;
      v_detalhes := v_detalhes || jsonb_build_array(jsonb_build_object(
        'contrato_id', v_contrato.id,
        'numero_contrato', v_contrato.numero_contrato,
        'medicao_id', v_medicao_id,
        'resultado', 'gerada',
        'valor_total', v_valor_total
      ));
    exception
      when unique_violation then
        v_ignoradas := v_ignoradas + 1;
        v_detalhes := v_detalhes || jsonb_build_array(jsonb_build_object(
          'contrato_id', v_contrato.id,
          'numero_contrato', v_contrato.numero_contrato,
          'resultado', 'ja_medida'
        ));
      when others then
        v_erros := v_erros + 1;
        v_detalhes := v_detalhes || jsonb_build_array(jsonb_build_object(
          'contrato_id', v_contrato.id,
          'numero_contrato', v_contrato.numero_contrato,
          'resultado', 'erro',
          'mensagem', sqlerrm,
          'codigo', sqlstate
        ));
    end;
  end loop;

  if p_contrato_id is not null and v_processados = 0 then
    raise exception using errcode = 'P0002', message = 'Contrato ativo e vigente não encontrado para a competência.';
  end if;

  return jsonb_build_object(
    'competencia', to_char(v_competencia, 'YYYY-MM-DD'),
    'processados', v_processados,
    'geradas', v_geradas,
    'ignoradas', v_ignoradas,
    'erros', v_erros,
    'detalhes', v_detalhes
  );
end
$$;

revoke all on function apticket.gerar_medicoes_contrato(uuid, date, boolean) from public, anon;
grant execute on function apticket.gerar_medicoes_contrato(uuid, date, boolean)
  to authenticated, service_role;

create or replace function apticket.atualizar_status_medicao_contrato(
  p_medicao_id uuid,
  p_status apticket.status_medicao_contrato
)
returns apticket.medicoes_contrato
language plpgsql
security definer
set search_path = pg_catalog, apticket
as $$
declare
  v_tenant_id uuid := apticket.current_tenant_id();
  v_medicao apticket.medicoes_contrato;
begin
  if auth.uid() is null
    or v_tenant_id is null
    or not apticket.has_permission(auth.uid(), 'contratos', 'edit') then
    raise exception using errcode = '42501', message = 'Sem permissão para alterar o status da medição.';
  end if;

  select * into v_medicao
  from apticket.medicoes_contrato
  where id = p_medicao_id
    and tenant_id = v_tenant_id
    and deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Medição não encontrada.';
  end if;

  if v_medicao.status = 'cancelada' then
    raise exception using errcode = '22023', message = 'Uma medição cancelada não pode mudar de status.';
  end if;

  if v_medicao.status = 'faturada' and p_status = 'gerada' then
    raise exception using errcode = '22023', message = 'Uma medição faturada não pode voltar para gerada.';
  end if;

  update apticket.medicoes_contrato
  set status = p_status
  where id = p_medicao_id
  returning * into v_medicao;

  return v_medicao;
end
$$;

revoke all on function apticket.atualizar_status_medicao_contrato(uuid, apticket.status_medicao_contrato)
  from public, anon;
grant execute on function apticket.atualizar_status_medicao_contrato(uuid, apticket.status_medicao_contrato)
  to authenticated, service_role;

create or replace function apticket.configurar_agendamento_medicoes_contrato()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, apticket, cron, vault
as $$
declare
  v_job_id bigint;
begin
  if current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'Somente o administrador do banco pode configurar este agendamento.';
  end if;

  if not exists (select 1 from vault.decrypted_secrets where name = 'apticket_internal_functions_url')
    or not exists (select 1 from vault.decrypted_secrets where name = 'apticket_edge_service_role_key') then
    raise exception using errcode = '22023', message = 'Segredos do agendamento de medições não configurados no Vault.';
  end if;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'apticket-gerar-medicoes-contrato';

  select cron.schedule(
    'apticket-gerar-medicoes-contrato',
    '15 3 * * *',
    $cron$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'apticket_internal_functions_url')
          || '/functions/v1/gerar-medicoes-contrato',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'apticket_edge_service_role_key'),
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'apticket_edge_service_role_key')
        ),
        body := jsonb_build_object('agendado', true)
      );
    $cron$
  ) into v_job_id;

  return v_job_id;
end
$$;

revoke all on function apticket.configurar_agendamento_medicoes_contrato() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from vault.decrypted_secrets where name = 'apticket_internal_functions_url')
    and exists (select 1 from vault.decrypted_secrets where name = 'apticket_edge_service_role_key') then
    perform apticket.configurar_agendamento_medicoes_contrato();
  else
    raise notice 'Agendamento de medições não criado: configure os segredos no Vault e execute apticket.configurar_agendamento_medicoes_contrato().';
  end if;
end
$$;
