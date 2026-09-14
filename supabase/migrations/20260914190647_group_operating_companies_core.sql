-- Estrutura multiempresa: a tenant representa o grupo empresarial e as
-- empresas operadoras isolam contratos, medicoes e todo o financeiro.

-- Cadastro empresarial completo das operadoras.
alter table apticket.operating_companies
  add column trade_name text,
  add column state_registration text,
  add column municipal_registration text,
  add column email text,
  add column phone text,
  add column website text,
  add column zip_code text,
  add column address_street text,
  add column address_number text,
  add column address_complement text,
  add column address_district text,
  add column address_city text,
  add column address_state text,
  add column address_country text not null default 'BR',
  add column cnaes jsonb not null default '[]'::jsonb,
  add column is_active boolean not null default true,
  add column created_by uuid,
  add column updated_by uuid,
  add column updated_at timestamptz not null default clock_timestamp(),
  add constraint operating_companies_cnaes_array_check check (jsonb_typeof(cnaes)='array'),
  add constraint operating_companies_state_check check (address_state is null or address_state ~ '^[A-Z]{2}$'),
  add constraint operating_companies_zip_check check (zip_code is null or zip_code ~ '^[0-9]{8}$'),
  add constraint operating_companies_created_by_fkey foreign key(created_by,tenant_id)
    references apticket.profiles(id,tenant_id) on delete restrict,
  add constraint operating_companies_updated_by_fkey foreign key(updated_by,tenant_id)
    references apticket.profiles(id,tenant_id) on delete restrict;

insert into apticket.permissions(module,action) values
  ('empresa_operadora','view'),
  ('empresa_operadora','create'),
  ('empresa_operadora','edit'),
  ('empresa_operadora','delete')
on conflict do nothing;

insert into apticket.role_permissions(role_id,permission_id)
select role.id,permission.id
from apticket.roles role
cross join apticket.permissions permission
where role.is_system and permission.module='empresa_operadora'
on conflict do nothing;

create or replace function apticket.has_financial_scope(
  _tenant_id uuid,
  _company_id uuid,
  _write boolean default false
) returns boolean language sql stable security invoker set search_path=pg_catalog as $$
  select _tenant_id=(select apticket.current_tenant_id())
    and (select apticket.has_permission(auth.uid(),'financeiro','view'))
    and (not _write or (select apticket.has_permission(auth.uid(),'financeiro','edit')))
    and (
      exists (
        select 1
        from apticket.user_roles user_role
        join apticket.roles role
          on role.id=user_role.role_id and role.tenant_id=user_role.tenant_id
        where user_role.user_id=auth.uid()
          and user_role.tenant_id=_tenant_id
          and role.name in ('Admin','Financeiro')
      )
      or exists (
        select 1 from apticket.financial_access access
        where access.tenant_id=_tenant_id and access.user_id=auth.uid()
          and access.deleted_at is null and (not _write or access.can_write)
          and (access.operating_company_id is null or access.operating_company_id=_company_id)
      )
    );
$$;

drop policy if exists scoped_companies_read on apticket.operating_companies;
drop policy if exists scoped_companies_insert on apticket.operating_companies;
drop policy if exists scoped_companies_update on apticket.operating_companies;
create policy scoped_companies_read on apticket.operating_companies for select to authenticated
using (
  tenant_id=apticket.current_tenant_id()
  and (
    apticket.has_permission(auth.uid(),'empresa_operadora','view')
    or apticket.has_permission(auth.uid(),'contratos','view')
    or apticket.has_financial_scope(tenant_id,id)
  )
);
create policy scoped_companies_insert on apticket.operating_companies for insert to authenticated
with check (
  tenant_id=apticket.current_tenant_id()
  and apticket.has_permission(auth.uid(),'empresa_operadora','create')
  and deleted_at is null
);
create policy scoped_companies_update on apticket.operating_companies for update to authenticated
using (
  tenant_id=apticket.current_tenant_id()
  and deleted_at is null
  and (
    apticket.has_permission(auth.uid(),'empresa_operadora','edit')
    or apticket.has_permission(auth.uid(),'empresa_operadora','delete')
  )
)
with check (
  tenant_id=apticket.current_tenant_id()
  and (
    apticket.has_permission(auth.uid(),'empresa_operadora','edit')
    or apticket.has_permission(auth.uid(),'empresa_operadora','delete')
  )
);

create function apticket_finance_private.prepare_operating_company()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if tg_op='INSERT' then
    new.created_by:=auth.uid();
    new.created_at:=clock_timestamp();
  elsif new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception using errcode='23514',message='A identidade da empresa operadora nao pode ser alterada.';
  end if;
  if tg_op='UPDATE' and old.deleted_at is null and new.deleted_at is not null then
    new.is_active:=false;
  elsif tg_op='UPDATE' and old.deleted_at is not null then
    raise exception using errcode='23514',message='Uma empresa operadora arquivada nao pode ser alterada.';
  end if;
  new.legal_name:=btrim(new.legal_name);
  new.trade_name:=nullif(btrim(new.trade_name),'');
  new.tax_id:=nullif(regexp_replace(coalesce(new.tax_id,''),'[^0-9]','','g'),'');
  new.state_registration:=nullif(btrim(new.state_registration),'');
  new.municipal_registration:=nullif(btrim(new.municipal_registration),'');
  new.email:=nullif(lower(btrim(new.email)),'');
  new.phone:=nullif(btrim(new.phone),'');
  new.website:=nullif(btrim(new.website),'');
  new.zip_code:=nullif(regexp_replace(coalesce(new.zip_code,''),'[^0-9]','','g'),'');
  new.address_street:=nullif(btrim(new.address_street),'');
  new.address_number:=nullif(btrim(new.address_number),'');
  new.address_complement:=nullif(btrim(new.address_complement),'');
  new.address_district:=nullif(btrim(new.address_district),'');
  new.address_city:=nullif(btrim(new.address_city),'');
  new.address_state:=nullif(upper(btrim(new.address_state)),'');
  new.address_country:=coalesce(nullif(upper(btrim(new.address_country)),''),'BR');
  new.cnaes:=coalesce(new.cnaes,'[]'::jsonb);
  new.updated_by:=auth.uid();
  new.updated_at:=clock_timestamp();
  return new;
end $$;
revoke all on function apticket_finance_private.prepare_operating_company() from public,anon,authenticated,service_role;
create trigger prepare_operating_company before insert or update on apticket.operating_companies
for each row execute function apticket_finance_private.prepare_operating_company();

-- Contratos de clientes pertencem obrigatoriamente a uma operadora.
alter table apticket.contracts add column operating_company_id uuid;
update apticket.contracts contract
set operating_company_id=(
  select operator.id from apticket.operating_companies operator
  where operator.tenant_id=contract.tenant_id and operator.deleted_at is null
  order by operator.created_at,operator.id limit 1
);
do $$ begin
  if exists(select 1 from apticket.contracts where operating_company_id is null) then
    raise exception 'Existem contratos sem empresa operadora disponivel para migracao.';
  end if;
end $$;
alter table apticket.contracts
  alter column operating_company_id set not null,
  add constraint contracts_operating_company_fkey foreign key(operating_company_id,tenant_id)
    references apticket.operating_companies(id,tenant_id) on delete restrict,
  add constraint contracts_operator_scope_key unique(id,tenant_id,operating_company_id);
create index contracts_operator_idx on apticket.contracts(tenant_id,operating_company_id,status);

alter table apticket.contract_financial_terms
  drop constraint contract_financial_terms_contract_id_tenant_id_fkey,
  add constraint contract_financial_terms_contract_operator_fkey
    foreign key(contract_id,tenant_id,operating_company_id)
    references apticket.contracts(id,tenant_id,operating_company_id) on delete restrict;

create function apticket_finance_private.protect_contract_operator()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if new.operating_company_id is distinct from old.operating_company_id and (
    exists(select 1 from apticket.medicoes_contrato where contrato_id=old.id)
    or exists(select 1 from apticket.contract_financial_terms where contract_id=old.id)
  ) then
    raise exception using errcode='23514',
      message='A empresa operadora nao pode ser alterada depois que o contrato possui medicao ou configuracao financeira.';
  end if;
  return new;
end $$;
revoke all on function apticket_finance_private.protect_contract_operator() from public,anon,authenticated,service_role;
create trigger protect_contract_operator before update of operating_company_id on apticket.contracts
for each row execute function apticket_finance_private.protect_contract_operator();

-- A medicao congela a operadora do contrato no momento da geracao.
alter table apticket.medicoes_contrato add column operating_company_id uuid;
alter table apticket.medicoes_contrato disable trigger medicoes_contrato_bloquear_alteracao;
update apticket.medicoes_contrato measurement
set operating_company_id=contract.operating_company_id
from apticket.contracts contract
where contract.id=measurement.contrato_id and contract.tenant_id=measurement.tenant_id;
alter table apticket.medicoes_contrato enable trigger medicoes_contrato_bloquear_alteracao;
alter table apticket.medicoes_contrato
  alter column operating_company_id set not null,
  add constraint measurement_contract_operator_fkey
    foreign key(contrato_id,tenant_id,operating_company_id)
    references apticket.contracts(id,tenant_id,operating_company_id) on delete restrict,
  add constraint measurements_operator_scope_key unique(id,tenant_id,operating_company_id);
create index measurements_operator_idx
  on apticket.medicoes_contrato(tenant_id,operating_company_id,competencia desc);

create function apticket_finance_private.assign_measurement_operator()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare v_operator uuid;
begin
  select operating_company_id into v_operator from apticket.contracts
  where id=new.contrato_id and tenant_id=new.tenant_id;
  if v_operator is null then
    raise exception using errcode='23514',message='O contrato precisa possuir uma empresa operadora ativa.';
  end if;
  if new.operating_company_id is not null and new.operating_company_id<>v_operator then
    raise exception using errcode='23514',message='A empresa da medicao deve ser a mesma do contrato.';
  end if;
  new.operating_company_id:=v_operator;
  return new;
end $$;
revoke all on function apticket_finance_private.assign_measurement_operator() from public,anon,authenticated,service_role;
create trigger assign_measurement_operator before insert on apticket.medicoes_contrato
for each row execute function apticket_finance_private.assign_measurement_operator();

-- Recebiveis de medicao passam a exigir escopo financeiro da operadora.
alter table apticket.contas_receber disable trigger contas_receber_proteger_alteracao;
update apticket.contas_receber receivable
set operating_company_id=measurement.operating_company_id
from apticket.medicoes_contrato measurement
where measurement.id=receivable.medicao_id and receivable.operating_company_id is null;
alter table apticket.contas_receber enable trigger contas_receber_proteger_alteracao;
alter table apticket.contas_receber drop constraint receivable_origin_check;
alter table apticket.contas_receber
  alter column operating_company_id set not null,
  add constraint receivable_origin_check check (
    (medicao_id is not null and billing_cycle_id is null and operating_company_id is not null)
    or (medicao_id is null and billing_cycle_id is not null and operating_company_id is not null)
  );
drop policy if exists "contas_receber select" on apticket.contas_receber;
drop policy if exists "contas_receber update" on apticket.contas_receber;
create policy "contas_receber select" on apticket.contas_receber for select to authenticated
using (apticket.has_financial_scope(tenant_id,operating_company_id));
create policy "contas_receber update" on apticket.contas_receber for update to authenticated
using (deleted_at is null and apticket.has_financial_scope(tenant_id,operating_company_id,true))
with check (apticket.has_financial_scope(tenant_id,operating_company_id,true));

create function apticket_finance_private.assign_receivable_operator()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if new.operating_company_id is null and new.medicao_id is not null then
    select operating_company_id into new.operating_company_id
    from apticket.medicoes_contrato where id=new.medicao_id and tenant_id=new.tenant_id;
  end if;
  if new.operating_company_id is null then
    raise exception using errcode='23514',message='A conta a receber precisa de uma empresa operadora.';
  end if;
  return new;
end $$;
revoke all on function apticket_finance_private.assign_receivable_operator() from public,anon,authenticated,service_role;
create trigger assign_receivable_operator before insert on apticket.contas_receber
for each row execute function apticket_finance_private.assign_receivable_operator();

-- Fornecedores sao cadastros compartilhados no grupo. Apenas contratos,
-- medicoes, contas bancarias operacionais e pagamentos carregam a operadora.
alter table apticket.supplier_contracts
  drop constraint supplier_contracts_supplier_id_tenant_id_operating_company_fkey;
alter table apticket.supplier_bank_accounts
  drop constraint supplier_bank_accounts_supplier_id_tenant_id_operating_com_fkey;
alter table apticket.supplier_payables
  drop constraint supplier_payables_supplier_id_tenant_id_operating_company__fkey;
alter table apticket.supplier_payments
  drop constraint supplier_payments_supplier_id_tenant_id_operating_company__fkey;
alter table apticket.suppliers
  add constraint suppliers_id_tenant_key unique(id,tenant_id);
alter table apticket.supplier_contracts
  add constraint supplier_contracts_supplier_tenant_fkey foreign key(supplier_id,tenant_id)
    references apticket.suppliers(id,tenant_id) on delete restrict;
alter table apticket.supplier_bank_accounts
  add constraint supplier_bank_accounts_supplier_tenant_fkey foreign key(supplier_id,tenant_id)
    references apticket.suppliers(id,tenant_id) on delete restrict;
alter table apticket.supplier_payables
  add constraint supplier_payables_supplier_tenant_fkey foreign key(supplier_id,tenant_id)
    references apticket.suppliers(id,tenant_id) on delete restrict;
alter table apticket.supplier_payments
  add constraint supplier_payments_supplier_tenant_fkey foreign key(supplier_id,tenant_id)
    references apticket.suppliers(id,tenant_id) on delete restrict;
drop index apticket.suppliers_tax_id_key;
drop index apticket.suppliers_scope_idx;
drop policy if exists payable_read on apticket.suppliers;
drop policy if exists payable_insert on apticket.suppliers;
drop policy if exists payable_update on apticket.suppliers;
alter table apticket.suppliers
  drop constraint suppliers_id_tenant_id_operating_company_id_key,
  drop constraint suppliers_operating_company_id_tenant_id_fkey,
  drop column operating_company_id;
create unique index suppliers_tax_id_key on apticket.suppliers(tenant_id,tax_id)
  where tax_id is not null and deleted_at is null;
create index suppliers_scope_idx on apticket.suppliers(tenant_id,legal_name)
  where deleted_at is null;

create policy supplier_group_read on apticket.suppliers for select to authenticated
using (
  tenant_id=apticket.current_tenant_id()
  and apticket.has_permission(auth.uid(),'financeiro','view')
);
create policy supplier_group_insert on apticket.suppliers for insert to authenticated
with check (
  tenant_id=apticket.current_tenant_id() and deleted_at is null
  and apticket.has_permission(auth.uid(),'financeiro','edit')
);
create policy supplier_group_update on apticket.suppliers for update to authenticated
using (
  tenant_id=apticket.current_tenant_id() and deleted_at is null
  and apticket.has_permission(auth.uid(),'financeiro','edit')
)
with check (
  tenant_id=apticket.current_tenant_id()
  and apticket.has_permission(auth.uid(),'financeiro','edit')
);

create or replace function apticket_finance_private.prepare_supplier()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare v_actor uuid:=auth.uid();
begin
  if tg_op='INSERT' then
    if new.tenant_id is distinct from apticket.current_tenant_id() then
      raise exception using errcode='42501',message='O fornecedor deve pertencer a tenant ativa.';
    end if;
    new.created_by:=v_actor; new.created_at:=clock_timestamp();
  elsif new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception using errcode='23514',message='A identidade do fornecedor nao pode ser alterada.';
  elsif old.deleted_at is not null then
    raise exception using errcode='23514',message='Um fornecedor arquivado nao pode ser alterado.';
  end if;
  if tg_op='UPDATE' and old.deleted_at is null and new.deleted_at is not null
     and exists(select 1 from apticket.supplier_contracts c
       where c.supplier_id=old.id and c.deleted_at is null and c.is_active) then
    raise exception using errcode='23514',message='Arquive os contratos ativos antes de arquivar o fornecedor.';
  end if;
  new.legal_name:=btrim(new.legal_name);
  new.trade_name:=nullif(btrim(new.trade_name),'');
  new.tax_id:=nullif(regexp_replace(coalesce(new.tax_id,''),'[^0-9]','','g'),'');
  new.contact_name:=nullif(btrim(new.contact_name),'');
  new.email:=nullif(lower(btrim(new.email)),'');
  new.phone:=nullif(btrim(new.phone),'');
  new.website:=nullif(btrim(new.website),'');
  new.address_zip:=nullif(regexp_replace(coalesce(new.address_zip,''),'[^0-9]','','g'),'');
  new.address_street:=nullif(btrim(new.address_street),'');
  new.address_number:=nullif(btrim(new.address_number),'');
  new.address_complement:=nullif(btrim(new.address_complement),'');
  new.address_neighborhood:=nullif(btrim(new.address_neighborhood),'');
  new.address_city:=nullif(btrim(new.address_city),'');
  new.address_state:=nullif(upper(btrim(new.address_state)),'');
  new.cnaes:=coalesce(new.cnaes,'[]'::jsonb);
  new.notes:=nullif(btrim(new.notes),'');
  new.updated_by:=v_actor; new.updated_at:=clock_timestamp();
  return new;
end $$;

-- Substitui a RPC bancaria do fornecedor para receber explicitamente a
-- operadora, pois o fornecedor nao possui mais um escopo financeiro proprio.
drop function apticket.save_supplier_bank_account(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,boolean);
create function apticket.save_supplier_bank_account(
  p_bank_account_id uuid,p_supplier_id uuid,p_operating_company_id uuid,p_label text,
  p_holder_name text,p_holder_tax_id text,p_bank_code text,p_bank_name text,p_branch text,
  p_account_number text,p_account_digit text,p_account_type text,p_pix_key_type text,
  p_pix_key text,p_is_default boolean default false
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare
  s apticket.suppliers; v_id uuid;
  v_tax text:=regexp_replace(coalesce(p_holder_tax_id,''),'[^0-9]','','g');
  v_bank_code text:=nullif(regexp_replace(coalesce(p_bank_code,''),'[^0-9]','','g'),'');
begin
  select * into s from apticket.suppliers where id=p_supplier_id and deleted_at is null for update;
  if not found or not s.is_active then raise exception using errcode='P0002',message='Fornecedor ativo nao encontrado.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(s.tenant_id,p_operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para alterar dados bancarios.';
  end if;
  if not exists(select 1 from apticket.operating_companies where id=p_operating_company_id
    and tenant_id=s.tenant_id and deleted_at is null and is_active) then
    raise exception using errcode='23514',message='Empresa operadora invalida.';
  end if;
  if length(btrim(coalesce(p_label,''))) not between 2 and 80
    or length(btrim(coalesce(p_holder_name,''))) not between 2 and 250
    or v_tax !~ '^[0-9]{11}([0-9]{3})?$' then
    raise exception using errcode='23514',message='Informe identificacao, titular e CPF ou CNPJ validos.';
  end if;
  if p_pix_key_type is not null and p_pix_key_type not in ('cpf','cnpj','email','phone','random') then
    raise exception using errcode='23514',message='O tipo da chave PIX e invalido.';
  end if;
  if (nullif(btrim(coalesce(p_pix_key,'')),'') is null)<>(p_pix_key_type is null) then
    raise exception using errcode='23514',message='Informe o tipo e a chave PIX em conjunto.';
  end if;
  if p_account_type is not null and p_account_type not in ('checking','savings','payment') then
    raise exception using errcode='23514',message='O tipo da conta bancaria e invalido.';
  end if;
  if nullif(btrim(coalesce(p_pix_key,'')),'') is null and
    (v_bank_code is null or length(v_bank_code)<>3 or nullif(btrim(coalesce(p_bank_name,'')),'') is null
      or nullif(btrim(coalesce(p_branch,'')),'') is null
      or nullif(btrim(coalesce(p_account_number,'')),'') is null or p_account_type is null) then
    raise exception using errcode='23514',message='Informe uma chave PIX ou os dados completos da conta bancaria.';
  end if;
  if p_is_default then
    update apticket.supplier_bank_accounts set is_default=false,updated_by=auth.uid(),updated_at=clock_timestamp()
    where supplier_id=s.id and operating_company_id=p_operating_company_id and is_default and deleted_at is null;
  end if;
  if p_bank_account_id is null then
    v_id:=gen_random_uuid();
    insert into apticket.supplier_bank_accounts(id,tenant_id,operating_company_id,supplier_id,label,
      holder_name,holder_tax_id,bank_code,bank_name,branch,account_number,account_digit,account_type,
      pix_key_type,pix_key,is_default,created_by,updated_by)
    values(v_id,s.tenant_id,p_operating_company_id,s.id,btrim(p_label),btrim(p_holder_name),v_tax,
      v_bank_code,nullif(btrim(p_bank_name),''),nullif(btrim(p_branch),''),
      nullif(btrim(p_account_number),''),nullif(btrim(p_account_digit),''),p_account_type,
      p_pix_key_type,nullif(btrim(p_pix_key),''),p_is_default,auth.uid(),auth.uid());
  else
    select id into v_id from apticket.supplier_bank_accounts where id=p_bank_account_id
      and supplier_id=s.id and operating_company_id=p_operating_company_id and deleted_at is null for update;
    if not found then raise exception using errcode='P0002',message='Dado bancario nao encontrado.'; end if;
    if exists(select 1 from apticket.supplier_payments where bank_account_id=v_id) then
      raise exception using errcode='23514',message='O dado bancario ja foi utilizado e nao pode ser alterado. Cadastre uma nova conta.';
    end if;
    update apticket.supplier_bank_accounts set label=btrim(p_label),holder_name=btrim(p_holder_name),
      holder_tax_id=v_tax,bank_code=v_bank_code,bank_name=nullif(btrim(p_bank_name),''),
      branch=nullif(btrim(p_branch),''),account_number=nullif(btrim(p_account_number),''),
      account_digit=nullif(btrim(p_account_digit),''),account_type=p_account_type,
      pix_key_type=p_pix_key_type,pix_key=nullif(btrim(p_pix_key),''),is_default=p_is_default,
      is_active=true,updated_by=auth.uid(),updated_at=clock_timestamp() where id=v_id;
  end if;
  if not exists(select 1 from apticket.supplier_bank_accounts where supplier_id=s.id
    and operating_company_id=p_operating_company_id and is_default and is_active and deleted_at is null) then
    update apticket.supplier_bank_accounts set is_default=true,updated_by=auth.uid(),updated_at=clock_timestamp()
    where id=v_id;
  end if;
  return v_id;
end $$;
revoke all on function apticket.save_supplier_bank_account(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,boolean)
  from public,anon,service_role;
grant execute on function apticket.save_supplier_bank_account(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,boolean)
  to authenticated;

-- As operacoes bancarias passam a usar a permissao da empresa operadora.
do $$
declare
  v_oid oid;
  v_definition text;
begin
  foreach v_oid in array array[
    'apticket.save_tenant_inter_configuration(uuid,uuid,text,text,jsonb,timestamptz,text,boolean,boolean,integer)'::regprocedure::oid,
    'apticket.prepare_inter_connection_test(uuid,uuid,text,integer)'::regprocedure::oid,
    'apticket_finance_private.prepare_inter_webhook_registration(uuid,uuid,text,integer,text)'::regprocedure::oid
  ] loop
    select pg_get_functiondef(v_oid) into v_definition;
    if strpos(v_definition,'''empresa'', ''edit''')=0
      and strpos(v_definition,'''empresa'',''edit''')=0 then
      raise exception 'A funcao % nao possui a verificacao de permissao esperada.',v_oid::regprocedure;
    end if;
    v_definition:=replace(v_definition,'''empresa'', ''edit''','''empresa_operadora'', ''edit''');
    v_definition:=replace(v_definition,'''empresa'',''edit''','''empresa_operadora'',''edit''');
    execute v_definition;
  end loop;
end $$;

comment on table apticket.operating_companies is
  'Empresas juridicas do grupo que isolam contratos, medicoes, financeiro e integracoes bancarias.';
comment on table apticket.suppliers is
  'Cadastro mestre de fornecedores compartilhado por todas as empresas operadoras da tenant.';
notify pgrst,'reload schema';
