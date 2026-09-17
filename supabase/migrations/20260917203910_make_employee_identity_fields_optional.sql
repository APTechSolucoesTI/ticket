-- CPF, CTPS e nascimento podem ser preenchidos posteriormente. As validações
-- continuam sendo aplicadas quando algum valor é informado.
alter table apticket.funcionarios
  alter column cpf drop not null,
  alter column ctps_numero drop not null,
  alter column ctps_serie drop not null,
  alter column data_nascimento drop not null;

create or replace function apticket_hr_private.prepare_employee()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  next_number integer;
begin
  new.cpf := nullif(regexp_replace(coalesce(new.cpf, ''), '\D', '', 'g'), '');
  new.pis_pasep := nullif(regexp_replace(coalesce(new.pis_pasep, ''), '\D', '', 'g'), '');

  if new.cpf is not null and not apticket_hr_private.validate_cpf(new.cpf) then
    raise exception using errcode = '23514', message = 'CPF inválido.';
  end if;

  new.ctps_numero := nullif(btrim(new.ctps_numero), '');
  new.ctps_serie := nullif(btrim(new.ctps_serie), '');

  if nullif(btrim(new.matricula), '') is null then
    perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text, 78431));
    select coalesce(max(nullif(regexp_replace(matricula, '\D', '', 'g'), '')::integer), 0) + 1
    into next_number
    from apticket.funcionarios
    where tenant_id = new.tenant_id;
    new.matricula := 'FUN-' || lpad(next_number::text, 6, '0');
  end if;

  new.updated_at := clock_timestamp();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end
$$;

create or replace function apticket.create_employee_with_position(
  p_data jsonb,
  p_cargo text,
  p_nivel text,
  p_salario numeric
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  tenant uuid := apticket.current_tenant_id();
  employee_id uuid := gen_random_uuid();
  operator_id uuid;
  admission date;
begin
  if auth.uid() is null
    or tenant is null
    or not apticket.has_permission(auth.uid(), 'funcionarios', 'create') then
    raise exception using errcode = '42501', message = 'Sem permissão para cadastrar funcionários.';
  end if;

  operator_id := (p_data->>'operating_company_id')::uuid;
  admission := (p_data->>'data_admissao')::date;

  if not exists (
    select 1
    from apticket.operating_companies
    where id = operator_id
      and tenant_id = tenant
      and is_active
      and deleted_at is null
  ) then
    raise exception using errcode = '23514', message = 'Empresa operadora inválida.';
  end if;

  insert into apticket.funcionarios (
    id, tenant_id, operating_company_id, nome_completo, nome_social, cpf, rg,
    rg_orgao_emissor, data_nascimento, sexo, estado_civil, nacionalidade,
    naturalidade_cidade, naturalidade_uf, nome_mae, nome_pai, pis_pasep,
    ctps_numero, ctps_serie, ctps_uf, titulo_eleitor, certificado_reservista,
    email_pessoal, email_corporativo, telefone_principal, telefone_secundario,
    matricula, departamento, centro_custo_id, data_admissao, tipo_contrato,
    regime_jornada, carga_horaria_semanal, status, gestor_responsavel_id,
    observacoes, created_by, updated_by
  ) values (
    employee_id, tenant, operator_id, btrim(p_data->>'nome_completo'),
    nullif(btrim(p_data->>'nome_social'), ''),
    nullif(btrim(p_data->>'cpf'), ''),
    nullif(btrim(p_data->>'rg'), ''),
    nullif(btrim(p_data->>'rg_orgao_emissor'), ''),
    nullif(p_data->>'data_nascimento', '')::date,
    nullif(p_data->>'sexo', ''),
    nullif(p_data->>'estado_civil', ''),
    coalesce(nullif(btrim(p_data->>'nacionalidade'), ''), 'Brasileira'),
    nullif(btrim(p_data->>'naturalidade_cidade'), ''),
    nullif(p_data->>'naturalidade_uf', ''),
    nullif(btrim(p_data->>'nome_mae'), ''),
    nullif(btrim(p_data->>'nome_pai'), ''),
    nullif(p_data->>'pis_pasep', ''),
    nullif(btrim(p_data->>'ctps_numero'), ''),
    nullif(btrim(p_data->>'ctps_serie'), ''),
    nullif(p_data->>'ctps_uf', ''),
    nullif(btrim(p_data->>'titulo_eleitor'), ''),
    nullif(btrim(p_data->>'certificado_reservista'), ''),
    nullif(lower(btrim(p_data->>'email_pessoal')), ''),
    nullif(lower(btrim(p_data->>'email_corporativo')), ''),
    nullif(btrim(p_data->>'telefone_principal'), ''),
    nullif(btrim(p_data->>'telefone_secundario'), ''),
    coalesce(nullif(btrim(p_data->>'matricula'), ''), ''),
    nullif(btrim(p_data->>'departamento'), ''),
    nullif(p_data->>'centro_custo_id', '')::uuid,
    admission,
    p_data->>'tipo_contrato',
    p_data->>'regime_jornada',
    nullif(p_data->>'carga_horaria_semanal', '')::numeric,
    'ativo',
    nullif(p_data->>'gestor_responsavel_id', '')::uuid,
    nullif(p_data->>'observacoes', ''),
    auth.uid(),
    auth.uid()
  );

  insert into apticket.funcionario_cargos_salarios (
    tenant_id, funcionario_id, cargo, nivel, salario_base, tipo_alteracao,
    motivo, vigente_de, created_by
  ) values (
    tenant, employee_id, btrim(p_cargo), nullif(btrim(p_nivel), ''), p_salario,
    'admissao', 'Cargo e salário de admissão', admission, auth.uid()
  );

  return employee_id;
end
$$;

comment on column apticket.funcionarios.cpf is 'CPF opcional; validado quando informado.';
comment on column apticket.funcionarios.ctps_numero is 'Número da CTPS, opcional.';
comment on column apticket.funcionarios.ctps_serie is 'Série da CTPS, opcional.';
comment on column apticket.funcionarios.data_nascimento is 'Data de nascimento opcional.';

notify pgrst, 'reload schema';
