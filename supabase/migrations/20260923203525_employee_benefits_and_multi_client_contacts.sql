-- Contatos podem atender mais de um cliente, mantendo company_id como cliente principal
-- para compatibilidade com tickets, contratos e o portal já existentes.
create table apticket.contact_companies (
  contact_id uuid not null references apticket.contacts(id) on delete cascade,
  company_id uuid not null references apticket.companies(id) on delete cascade,
  tenant_id uuid not null references apticket.tenants(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (contact_id, company_id)
);
create index contact_companies_tenant_company_idx
  on apticket.contact_companies(tenant_id, company_id, contact_id);

insert into apticket.contact_companies(contact_id, company_id, tenant_id)
select id, company_id, tenant_id from apticket.contacts where company_id is not null
on conflict do nothing;

alter table apticket.contact_companies enable row level security;
grant select, insert, update, delete on apticket.contact_companies to authenticated;
grant all on apticket.contact_companies to service_role;
create policy contact_companies_select on apticket.contact_companies for select to authenticated
using (
  tenant_id = apticket.current_tenant_id()
  and apticket.has_permission(auth.uid(), 'contatos', 'view')
);
create policy contact_companies_insert on apticket.contact_companies for insert to authenticated
with check (
  tenant_id = apticket.current_tenant_id()
  and apticket.has_permission(auth.uid(), 'contatos', 'edit')
);
create policy contact_companies_update on apticket.contact_companies for update to authenticated
using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(), 'contatos', 'edit'))
with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(), 'contatos', 'edit'));
create policy contact_companies_delete on apticket.contact_companies for delete to authenticated
using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(), 'contatos', 'edit'));

create or replace function apticket.set_contact_companies(p_contact_id uuid, p_company_ids uuid[])
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_tenant uuid;
  v_ids uuid[];
begin
  select tenant_id into v_tenant from apticket.contacts where id = p_contact_id for update;
  if v_tenant is null or auth.uid() is null or v_tenant <> apticket.current_tenant_id()
     or not (
       apticket.has_permission(auth.uid(), 'contatos', 'edit')
       or apticket.has_permission(auth.uid(), 'contatos', 'create')
     ) then
    raise exception using errcode='42501', message='Sem permissão para alterar os clientes do contato.';
  end if;

  select coalesce(array_agg(distinct value), '{}'::uuid[]) into v_ids
  from unnest(coalesce(p_company_ids, '{}'::uuid[])) value;
  if cardinality(v_ids) = 0 then
    raise exception using errcode='23514', message='Selecione ao menos um cliente.';
  end if;
  if exists (
    select 1 from unnest(v_ids) company_id
    left join apticket.companies company on company.id = company_id and company.tenant_id = v_tenant
    where company.id is null
  ) then
    raise exception using errcode='23503', message='Um dos clientes selecionados é inválido.';
  end if;

  update apticket.contacts set company_id = v_ids[1] where id = p_contact_id;
  delete from apticket.contact_companies
  where contact_id = p_contact_id and not (company_id = any(v_ids));
  insert into apticket.contact_companies(contact_id, company_id, tenant_id)
  select p_contact_id, company_id, v_tenant from unnest(v_ids) company_id
  on conflict do nothing;
end $$;
revoke all on function apticket.set_contact_companies(uuid,uuid[]) from public,anon,service_role;
grant execute on function apticket.set_contact_companies(uuid,uuid[]) to authenticated;

create or replace function apticket_hr_private.sync_contact_primary_company()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if new.company_id is not null then
    insert into apticket.contact_companies(contact_id, company_id, tenant_id)
    values(new.id, new.company_id, new.tenant_id) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger contacts_sync_primary_company
after insert or update of company_id on apticket.contacts
for each row execute function apticket_hr_private.sync_contact_primary_company();
revoke all on function apticket_hr_private.sync_contact_primary_company() from public,anon,authenticated,service_role;

-- Novas opções e campos livres do cadastro de funcionários.
alter table apticket.funcionarios drop constraint if exists funcionarios_tipo_contrato_check;
alter table apticket.funcionarios add constraint funcionarios_tipo_contrato_check
  check(tipo_contrato in ('clt','pj','estagio','aprendiz','temporario','servicos_terceirizados'));

alter table apticket.funcionario_cargos_salarios
  drop constraint if exists funcionario_cargos_salarios_tipo_alteracao_check;
alter table apticket.funcionario_cargos_salarios
  add constraint funcionario_cargos_salarios_tipo_alteracao_check
  check(length(btrim(tipo_alteracao)) between 2 and 150);

create table apticket.funcionario_beneficios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  funcionario_id uuid not null,
  tipo_beneficio text not null check(length(btrim(tipo_beneficio)) between 2 and 150),
  vigente_de date not null,
  vigente_ate date,
  valor numeric(12,2) not null default 0 check(valor >= 0),
  observacao text,
  created_by uuid references apticket.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique(id, tenant_id),
  foreign key(funcionario_id, tenant_id) references apticket.funcionarios(id, tenant_id) on delete restrict,
  check(vigente_ate is null or vigente_ate >= vigente_de)
);
create index funcionario_beneficios_employee_idx
  on apticket.funcionario_beneficios(funcionario_id, vigente_de desc) where deleted_at is null;

create table apticket.funcionario_beneficio_documentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  funcionario_id uuid not null,
  beneficio_id uuid not null,
  arquivo_url text not null,
  arquivo_nome_original text not null,
  arquivo_mime_type text not null check(arquivo_mime_type in (
    'application/pdf','image/jpeg',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )),
  arquivo_tamanho_bytes bigint not null check(arquivo_tamanho_bytes between 1 and 10485760),
  historico text,
  enviado_por uuid references apticket.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique(id, tenant_id),
  foreign key(funcionario_id, tenant_id) references apticket.funcionarios(id, tenant_id) on delete restrict,
  foreign key(beneficio_id, tenant_id) references apticket.funcionario_beneficios(id, tenant_id) on delete restrict
);
create index funcionario_beneficio_documentos_idx
  on apticket.funcionario_beneficio_documentos(beneficio_id, created_at desc) where deleted_at is null;

alter table apticket.funcionario_beneficios enable row level security;
alter table apticket.funcionario_beneficio_documentos enable row level security;
revoke all on apticket.funcionario_beneficios, apticket.funcionario_beneficio_documentos from public,anon;
grant select,insert,update on apticket.funcionario_beneficios, apticket.funcionario_beneficio_documentos to authenticated;
grant all on apticket.funcionario_beneficios, apticket.funcionario_beneficio_documentos to service_role;
create policy employee_benefit_read on apticket.funcionario_beneficios for select to authenticated
  using(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','view'));
create policy employee_benefit_write on apticket.funcionario_beneficios for insert to authenticated
  with check(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','edit'));
create policy employee_benefit_update on apticket.funcionario_beneficios for update to authenticated
  using(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','edit'))
  with check(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','edit'));
create policy employee_benefit_document_read on apticket.funcionario_beneficio_documentos for select to authenticated
  using(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','sensitive'));
create policy employee_benefit_document_write on apticket.funcionario_beneficio_documentos for insert to authenticated
  with check(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','sensitive'));
create policy employee_benefit_document_update on apticket.funcionario_beneficio_documentos for update to authenticated
  using(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','sensitive'))
  with check(tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'funcionarios','sensitive'));

create trigger employee_benefit_audit after insert or update on apticket.funcionario_beneficios
for each row execute function apticket_hr_private.audit_employee_mutation();
create trigger employee_benefit_document_audit after insert or update on apticket.funcionario_beneficio_documentos
for each row execute function apticket_hr_private.audit_employee_mutation();

create or replace function apticket.archive_employee_financial_event(p_event_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare v_event apticket.funcionario_eventos_financeiros;
begin
  select * into v_event from apticket.funcionario_eventos_financeiros
  where id=p_event_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Evento financeiro não encontrado.'; end if;
  if auth.uid() is null or v_event.tenant_id<>apticket.current_tenant_id()
    or not (apticket.has_permission(auth.uid(),'funcionarios','payroll') or apticket.has_permission(auth.uid(),'funcionarios','edit')) then
    raise exception using errcode='42501',message='Sem permissão para excluir eventos financeiros.';
  end if;
  if v_event.status_integracao<>'pendente' or v_event.conta_pagar_id is not null then
    raise exception using errcode='23514',message='Somente eventos financeiros pendentes e sem vínculo podem ser excluídos.';
  end if;
  update apticket.funcionario_eventos_financeiros_itens
    set deleted_at=clock_timestamp(),updated_at=clock_timestamp()
    where evento_id=v_event.id and deleted_at is null;
  update apticket.funcionario_eventos_financeiros
    set deleted_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_event.id;
end $$;
revoke all on function apticket.archive_employee_financial_event(uuid) from public,anon,service_role;
grant execute on function apticket.archive_employee_financial_event(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('funcionario-beneficios','funcionario-beneficios',false,10485760,array[
  'application/pdf','image/jpeg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
allowed_mime_types=excluded.allowed_mime_types;
create policy employee_benefit_storage_read on storage.objects for select to authenticated using(
  bucket_id='funcionario-beneficios' and (storage.foldername(name))[1]=apticket.current_tenant_id()::text
  and apticket.has_permission(auth.uid(),'funcionarios','sensitive'));
create policy employee_benefit_storage_insert on storage.objects for insert to authenticated with check(
  bucket_id='funcionario-beneficios' and (storage.foldername(name))[1]=apticket.current_tenant_id()::text
  and apticket.has_permission(auth.uid(),'funcionarios','sensitive'));
create policy employee_benefit_storage_delete on storage.objects for delete to authenticated using(
  bucket_id='funcionario-beneficios' and (storage.foldername(name))[1]=apticket.current_tenant_id()::text
  and apticket.has_permission(auth.uid(),'funcionarios','sensitive'));

-- O tipo de alteração agora é texto livre, inclusive na edição do histórico.
create or replace function apticket.update_employee_position(
  p_position_id uuid,p_cargo text,p_nivel text,p_salario numeric,p_tipo_alteracao text,
  p_motivo text,p_vigente_de date,p_vigente_ate date default null
) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare position apticket.funcionario_cargos_salarios; begin
  select * into position from apticket.funcionario_cargos_salarios where id=p_position_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Cargo e salário não encontrados.'; end if;
  if auth.uid() is null or position.tenant_id<>apticket.current_tenant_id()
    or not apticket.has_permission(auth.uid(),'funcionarios','edit') then
    raise exception using errcode='42501',message='Sem permissão para editar cargos e salários.';
  end if;
  if length(btrim(coalesce(p_cargo,'')))<2 or p_salario<0 or p_vigente_de is null
    or length(btrim(coalesce(p_tipo_alteracao,''))) not between 2 and 150
    or (p_vigente_ate is not null and p_vigente_ate<p_vigente_de) then
    raise exception using errcode='23514',message='Revise cargo, salário, tipo de alteração e período de vigência.';
  end if;
  if p_vigente_ate is null and position.vigente_ate is not null and exists(
    select 1 from apticket.funcionario_cargos_salarios other where other.funcionario_id=position.funcionario_id
      and other.id<>position.id and other.vigente_ate is null and other.deleted_at is null) then
    raise exception using errcode='23505',message='Já existe outro cargo e salário vigente. Informe a data final deste registro.';
  end if;
  update apticket.funcionario_cargos_salarios set cargo=btrim(p_cargo),nivel=nullif(btrim(p_nivel),''),
    salario_base=p_salario,tipo_alteracao=btrim(p_tipo_alteracao),motivo=nullif(btrim(p_motivo),''),
    vigente_de=p_vigente_de,vigente_ate=p_vigente_ate,updated_at=clock_timestamp() where id=p_position_id;
  if p_vigente_ate is null then
    update apticket.funcionarios set cargo_atual_id=p_position_id,updated_at=clock_timestamp(),updated_by=auth.uid()
      where id=position.funcionario_id;
  elsif exists(select 1 from apticket.funcionarios where id=position.funcionario_id and cargo_atual_id=p_position_id) then
    update apticket.funcionarios employee set cargo_atual_id=(select id from apticket.funcionario_cargos_salarios other
      where other.funcionario_id=position.funcionario_id and other.id<>position.id and other.vigente_ate is null
        and other.deleted_at is null order by other.vigente_de desc limit 1),updated_at=clock_timestamp(),updated_by=auth.uid()
      where employee.id=position.funcionario_id;
  end if;
end $$;

notify pgrst,'reload schema';
