-- Normaliza e-mails de funcionários em todas as origens de escrita e repara
-- o texto de admissão corrompido durante a carga inicial do módulo.
create or replace function apticket_hr_private.normalize_employee_emails()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  new.email_pessoal := nullif(lower(btrim(new.email_pessoal)), '');
  new.email_corporativo := nullif(lower(btrim(new.email_corporativo)), '');
  return new;
end
$$;

drop trigger if exists funcionario_normalize_emails on apticket.funcionarios;
create trigger funcionario_normalize_emails
before insert or update of email_pessoal, email_corporativo
on apticket.funcionarios
for each row
execute function apticket_hr_private.normalize_employee_emails();

revoke all on function apticket_hr_private.normalize_employee_emails()
from public, anon, authenticated, service_role;

update apticket.funcionarios
set
  email_pessoal = nullif(lower(btrim(email_pessoal)), ''),
  email_corporativo = nullif(lower(btrim(email_corporativo)), '')
where
  email_pessoal is distinct from nullif(lower(btrim(email_pessoal)), '')
  or email_corporativo is distinct from nullif(lower(btrim(email_corporativo)), '');

update apticket.funcionario_cargos_salarios
set
  motivo = 'Cargo e salário de admissão',
  updated_at = clock_timestamp()
where motivo = 'Cargo e sal?rio de admiss?o';

-- A definição anterior desta RPC também foi carregada com os caracteres
-- substituídos. Recriá-la evita que novos históricos voltem a ser corrompidos.
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
    nullif(btrim(p_data->>'nome_social'), ''), p_data->>'cpf',
    nullif(btrim(p_data->>'rg'), ''), nullif(btrim(p_data->>'rg_orgao_emissor'), ''),
    (p_data->>'data_nascimento')::date, nullif(p_data->>'sexo', ''),
    nullif(p_data->>'estado_civil', ''),
    coalesce(nullif(btrim(p_data->>'nacionalidade'), ''), 'Brasileira'),
    nullif(btrim(p_data->>'naturalidade_cidade'), ''),
    nullif(p_data->>'naturalidade_uf', ''), nullif(btrim(p_data->>'nome_mae'), ''),
    nullif(btrim(p_data->>'nome_pai'), ''), p_data->>'pis_pasep',
    p_data->>'ctps_numero', p_data->>'ctps_serie', p_data->>'ctps_uf',
    nullif(btrim(p_data->>'titulo_eleitor'), ''),
    nullif(btrim(p_data->>'certificado_reservista'), ''),
    nullif(lower(btrim(p_data->>'email_pessoal')), ''),
    nullif(lower(btrim(p_data->>'email_corporativo')), ''),
    nullif(btrim(p_data->>'telefone_principal'), ''),
    nullif(btrim(p_data->>'telefone_secundario'), ''),
    coalesce(nullif(btrim(p_data->>'matricula'), ''), ''),
    nullif(btrim(p_data->>'departamento'), ''),
    nullif(p_data->>'centro_custo_id', '')::uuid, admission,
    p_data->>'tipo_contrato', p_data->>'regime_jornada',
    nullif(p_data->>'carga_horaria_semanal', '')::numeric, 'ativo',
    nullif(p_data->>'gestor_responsavel_id', '')::uuid,
    nullif(p_data->>'observacoes', ''), auth.uid(), auth.uid()
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

revoke all on function apticket.create_employee_with_position(jsonb, text, text, numeric)
from public, anon, service_role;
grant execute on function apticket.create_employee_with_position(jsonb, text, text, numeric)
to authenticated;
