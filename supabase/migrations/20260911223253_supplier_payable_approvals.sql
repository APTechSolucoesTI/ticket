-- Fatia 20: aprovacao sequencial de contas a pagar por alcada.
create table apticket.supplier_approval_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  name text not null check (length(btrim(name)) between 2 and 150),
  minimum_amount numeric(14,2) not null default 0 check (minimum_amount>=0),
  maximum_amount numeric(14,2),
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique (id,tenant_id,operating_company_id),
  check (maximum_amount is null or maximum_amount>=minimum_amount),
  foreign key (operating_company_id,tenant_id)
    references apticket.operating_companies(id,tenant_id) on delete restrict,
  foreign key (created_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict,
  foreign key (updated_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict
);
create unique index supplier_approval_policy_name_key
  on apticket.supplier_approval_policies(tenant_id,operating_company_id,lower(name))
  where deleted_at is null;
create index supplier_approval_policy_range_idx
  on apticket.supplier_approval_policies(tenant_id,operating_company_id,minimum_amount)
  where is_active and deleted_at is null;

create table apticket.supplier_approval_policy_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  policy_id uuid not null,
  step_order smallint not null check (step_order between 1 and 50),
  approver_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique (id,tenant_id,operating_company_id),
  foreign key (policy_id,tenant_id,operating_company_id)
    references apticket.supplier_approval_policies(id,tenant_id,operating_company_id) on delete restrict,
  foreign key (approver_id,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict
);
create unique index supplier_approval_policy_step_order_key
  on apticket.supplier_approval_policy_steps(policy_id,step_order) where deleted_at is null;
create unique index supplier_approval_policy_approver_key
  on apticket.supplier_approval_policy_steps(policy_id,approver_id) where deleted_at is null;

create table apticket.supplier_payable_approval_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  supplier_payable_id uuid not null,
  policy_id uuid not null,
  policy_name text not null,
  payable_amount numeric(14,2) not null check (payable_amount>=0),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  submitted_by uuid,
  submitted_by_name text not null,
  submitted_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  rejection_reason text check (rejection_reason is null or length(btrim(rejection_reason)) between 3 and 1000),
  created_at timestamptz not null default clock_timestamp(),
  unique (id,tenant_id,operating_company_id),
  foreign key (supplier_payable_id,tenant_id,operating_company_id)
    references apticket.supplier_payables(id,tenant_id,operating_company_id) on delete restrict,
  foreign key (policy_id,tenant_id,operating_company_id)
    references apticket.supplier_approval_policies(id,tenant_id,operating_company_id) on delete restrict,
  foreign key (submitted_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict
);
create unique index supplier_payable_pending_approval_key
  on apticket.supplier_payable_approval_requests(supplier_payable_id)
  where status='pending';
create index supplier_payable_approval_history_idx
  on apticket.supplier_payable_approval_requests(supplier_payable_id,submitted_at desc);

create table apticket.supplier_payable_approval_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  request_id uuid not null,
  step_order smallint not null check (step_order between 1 and 50),
  approver_id uuid not null,
  approver_name text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_at timestamptz,
  decision_comment text check (decision_comment is null or length(btrim(decision_comment)) between 1 and 1000),
  created_at timestamptz not null default clock_timestamp(),
  unique (request_id,step_order),
  unique (id,tenant_id,operating_company_id),
  foreign key (request_id,tenant_id,operating_company_id)
    references apticket.supplier_payable_approval_requests(id,tenant_id,operating_company_id) on delete restrict,
  foreign key (approver_id,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict
);
create index supplier_payable_approval_step_actor_idx
  on apticket.supplier_payable_approval_steps(approver_id,status,created_at desc);

do $$ declare t text; begin
  foreach t in array array['supplier_approval_policies','supplier_approval_policy_steps',
    'supplier_payable_approval_requests','supplier_payable_approval_steps'] loop
    execute format('alter table apticket.%I enable row level security',t);
    execute format('revoke all on apticket.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on apticket.%I to authenticated,service_role',t);
    execute format('create policy supplier_approval_read on apticket.%I for select to authenticated using
      (apticket.has_financial_scope(tenant_id,operating_company_id))',t);
    execute format('create trigger supplier_approval_no_delete before delete on apticket.%I for each row
      execute function apticket_finance_private.guard_record()',t);
    execute format('create trigger supplier_approval_no_truncate before truncate on apticket.%I for each statement
      execute function apticket_finance_private.guard_record()',t);
    execute format('create trigger supplier_approval_audit after insert or update on apticket.%I for each row
      execute function apticket_finance_private.audit_record()',t);
  end loop;
end $$;

create or replace function apticket_finance_private.guard_supplier_payable()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if to_jsonb(new)-array['deleted_at','allocation_status','status']
    is distinct from to_jsonb(old)-array['deleted_at','allocation_status','status'] then
    raise exception using errcode='23514',message='O lancamento gerado e imutavel.';
  end if;
  if new.allocation_status is distinct from old.allocation_status and not
    (old.allocation_status='pending_rule' and new.allocation_status='complete') then
    raise exception using errcode='23514',message='A situacao do rateio nao pode retroceder.';
  end if;
  if new.status is distinct from old.status and not (
    (old.status='scheduled' and new.status='awaiting_approval' and new.allocation_status='complete')
    or (old.status='awaiting_approval' and new.status in ('approved','scheduled'))
    or (old.status='approved' and new.status='paid')
  ) then
    raise exception using errcode='23514',message='A transicao financeira deste lancamento nao e permitida.';
  end if;
  return new;
end $$;

create function apticket.save_supplier_approval_policy(
  p_policy_id uuid,
  p_operating_company_id uuid,
  p_name text,
  p_minimum_amount numeric,
  p_maximum_amount numeric,
  p_approver_ids jsonb
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_tenant uuid;
  v_actor uuid:=auth.uid();
  v_id uuid;
  v_count integer;
  v_distinct integer;
  v_invalid integer;
begin
  select tenant_id into v_tenant from apticket.operating_companies
    where id=p_operating_company_id and deleted_at is null for update;
  if not found then
    raise exception using errcode='P0002',message='Empresa operadora nao encontrada.';
  end if;
  if v_actor is null or not apticket.has_financial_scope(v_tenant,p_operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para configurar alcadas.';
  end if;
  if length(btrim(coalesce(p_name,''))) not between 2 and 150 then
    raise exception using errcode='23514',message='Informe um nome valido para a alcada.';
  end if;
  if p_minimum_amount is null or p_minimum_amount<0
     or (p_maximum_amount is not null and p_maximum_amount<p_minimum_amount) then
    raise exception using errcode='23514',message='Informe uma faixa de valores valida.';
  end if;
  if p_approver_ids is null or jsonb_typeof(p_approver_ids)<>'array'
     or jsonb_array_length(p_approver_ids)=0 then
    raise exception using errcode='23514',message='Informe ao menos um aprovador.';
  end if;
  select count(*),count(distinct value::uuid) into v_count,v_distinct
    from jsonb_array_elements_text(p_approver_ids);
  if v_count<>v_distinct or v_count>50 then
    raise exception using errcode='23514',message='Os aprovadores devem ser unicos e limitados a cinquenta etapas.';
  end if;
  select count(*) into v_invalid
  from jsonb_array_elements_text(p_approver_ids) item
  where not exists (
    select 1 from apticket.profiles profile
    where profile.id=item.value::uuid and profile.tenant_id=v_tenant and profile.is_active
      and exists(select 1 from apticket.financial_access access
        where access.user_id=profile.id and access.tenant_id=v_tenant and access.can_write
          and access.deleted_at is null
          and (access.operating_company_id is null or access.operating_company_id=p_operating_company_id))
      and coalesce(
        (select permission_override.granted from apticket.user_permissions permission_override
          join apticket.permissions permission on permission.id=permission_override.permission_id
          where permission_override.user_id=profile.id and permission.module='financeiro'
            and permission.action='edit'),
        exists(select 1 from apticket.user_roles user_role
          join apticket.role_permissions role_permission on role_permission.role_id=user_role.role_id
          join apticket.permissions permission on permission.id=role_permission.permission_id
          where user_role.user_id=profile.id and permission.module='financeiro'
            and permission.action='edit'),false));
  if v_invalid>0 then
    raise exception using errcode='23514',message='Todos os aprovadores devem estar ativos e possuir escrita financeira nesta empresa.';
  end if;
  if exists(select 1 from apticket.supplier_approval_policies policy
    where policy.tenant_id=v_tenant and policy.operating_company_id=p_operating_company_id
      and policy.is_active and policy.deleted_at is null and policy.id is distinct from p_policy_id
      and coalesce(policy.maximum_amount,99999999999999.99)>=p_minimum_amount
      and coalesce(p_maximum_amount,99999999999999.99)>=policy.minimum_amount) then
    raise exception using errcode='23514',message='A faixa informada se sobrepoe a outra alcada ativa.';
  end if;
  if p_policy_id is not null then
    select id into v_id from apticket.supplier_approval_policies
      where id=p_policy_id and tenant_id=v_tenant
        and operating_company_id=p_operating_company_id and deleted_at is null for update;
    if not found then
      raise exception using errcode='P0002',message='Alcada nao encontrada.';
    end if;
    if exists(select 1 from apticket.supplier_payable_approval_requests
      where policy_id=v_id) then
      raise exception using errcode='23514',message='Esta alcada ja foi utilizada e nao pode ser alterada. Arquive-a e crie outra.';
    end if;
    update apticket.supplier_approval_policies set name=btrim(p_name),
      minimum_amount=p_minimum_amount,maximum_amount=p_maximum_amount,is_active=true,
      updated_by=v_actor,updated_at=clock_timestamp() where id=v_id;
    update apticket.supplier_approval_policy_steps set deleted_at=clock_timestamp()
      where policy_id=v_id and deleted_at is null;
  else
    v_id:=gen_random_uuid();
    insert into apticket.supplier_approval_policies(id,tenant_id,operating_company_id,name,
      minimum_amount,maximum_amount,created_by,updated_by)
    values(v_id,v_tenant,p_operating_company_id,btrim(p_name),p_minimum_amount,
      p_maximum_amount,v_actor,v_actor);
  end if;
  insert into apticket.supplier_approval_policy_steps(tenant_id,operating_company_id,
    policy_id,step_order,approver_id)
  select v_tenant,p_operating_company_id,v_id,item.ordinality,item.value::uuid
    from jsonb_array_elements_text(p_approver_ids) with ordinality item(value,ordinality);
  return v_id;
exception when invalid_text_representation then
  raise exception using errcode='23514',message='A lista de aprovadores possui um identificador invalido.';
end $$;

create function apticket.archive_supplier_approval_policy(p_policy_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare p apticket.supplier_approval_policies; begin
  select * into p from apticket.supplier_approval_policies
    where id=p_policy_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Alcada nao encontrada.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(p.tenant_id,p.operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para arquivar alcadas.';
  end if;
  if exists(select 1 from apticket.supplier_payable_approval_requests
    where policy_id=p.id and status='pending') then
    raise exception using errcode='23514',message='Conclua as aprovacoes pendentes antes de arquivar esta alcada.';
  end if;
  update apticket.supplier_approval_policies set is_active=false,deleted_at=clock_timestamp(),
    updated_by=auth.uid(),updated_at=clock_timestamp() where id=p.id;
  return true;
end $$;

create function apticket.list_supplier_approval_approvers(p_operating_company_id uuid)
returns table(id uuid,name text,email text)
language plpgsql stable security definer set search_path=pg_catalog as $$
declare v_tenant uuid; begin
  select company.tenant_id into v_tenant from apticket.operating_companies company
    where company.id=p_operating_company_id and company.deleted_at is null;
  if not found then raise exception using errcode='P0002',message='Empresa operadora nao encontrada.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(v_tenant,p_operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para consultar aprovadores.';
  end if;
  return query
  select profile.id,profile.name,profile.email from apticket.profiles profile
  where profile.tenant_id=v_tenant and profile.is_active
    and exists(select 1 from apticket.financial_access access
      where access.user_id=profile.id and access.tenant_id=v_tenant and access.can_write
        and access.deleted_at is null
        and (access.operating_company_id is null or access.operating_company_id=p_operating_company_id))
    and coalesce(
      (select permission_override.granted from apticket.user_permissions permission_override
        join apticket.permissions permission on permission.id=permission_override.permission_id
        where permission_override.user_id=profile.id and permission.module='financeiro'
          and permission.action='edit'),
      exists(select 1 from apticket.user_roles user_role
        join apticket.role_permissions role_permission on role_permission.role_id=user_role.role_id
        join apticket.permissions permission on permission.id=role_permission.permission_id
        where user_role.user_id=profile.id and permission.module='financeiro'
          and permission.action='edit'),false)
  order by profile.name;
end $$;

create function apticket.submit_supplier_payable_for_approval(p_supplier_payable_id uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare
  p apticket.supplier_payables;
  policy apticket.supplier_approval_policies;
  v_request_id uuid:=gen_random_uuid();
  v_actor_name text;
  v_steps integer;
begin
  select * into p from apticket.supplier_payables
    where id=p_supplier_payable_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Lancamento nao encontrado.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(p.tenant_id,p.operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para enviar o lancamento.';
  end if;
  if p.status<>'scheduled' then
    raise exception using errcode='23514',message='Somente lancamentos agendados podem ser enviados para aprovacao.';
  end if;
  if p.allocation_status<>'complete' then
    raise exception using errcode='23514',message='Conclua o rateio antes de enviar o lancamento para aprovacao.';
  end if;
  select * into policy from apticket.supplier_approval_policies candidate
    where candidate.tenant_id=p.tenant_id and candidate.operating_company_id=p.operating_company_id
      and candidate.is_active and candidate.deleted_at is null
      and p.total_amount>=candidate.minimum_amount
      and (candidate.maximum_amount is null or p.total_amount<=candidate.maximum_amount)
    order by candidate.minimum_amount desc limit 1 for update;
  if not found then
    raise exception using errcode='23514',message='Nenhuma alcada ativa contempla o valor deste lancamento.';
  end if;
  select name into v_actor_name from apticket.profiles
    where id=auth.uid() and tenant_id=p.tenant_id and is_active;
  if v_actor_name is null then
    raise exception using errcode='42501',message='Usuario responsavel nao esta ativo.';
  end if;
  select count(*) into v_steps from apticket.supplier_approval_policy_steps step
    join apticket.profiles profile on profile.id=step.approver_id
      and profile.tenant_id=step.tenant_id and profile.is_active
    where step.policy_id=policy.id and step.deleted_at is null;
  if v_steps=0 or v_steps<>(select count(*) from apticket.supplier_approval_policy_steps
    where policy_id=policy.id and deleted_at is null) then
    raise exception using errcode='23514',message='A alcada possui aprovador inativo ou nenhuma etapa configurada.';
  end if;
  insert into apticket.supplier_payable_approval_requests(id,tenant_id,operating_company_id,
    supplier_payable_id,policy_id,policy_name,payable_amount,submitted_by,submitted_by_name)
  values(v_request_id,p.tenant_id,p.operating_company_id,p.id,policy.id,policy.name,
    p.total_amount,auth.uid(),v_actor_name);
  insert into apticket.supplier_payable_approval_steps(tenant_id,operating_company_id,
    request_id,step_order,approver_id,approver_name)
  select step.tenant_id,step.operating_company_id,v_request_id,step.step_order,
    step.approver_id,profile.name
  from apticket.supplier_approval_policy_steps step
  join apticket.profiles profile on profile.id=step.approver_id and profile.tenant_id=step.tenant_id
  where step.policy_id=policy.id and step.deleted_at is null order by step.step_order;
  update apticket.supplier_payables set status='awaiting_approval' where id=p.id;
  return v_request_id;
end $$;

create function apticket.approve_supplier_payable(
  p_request_id uuid,
  p_comment text default null
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare
  request apticket.supplier_payable_approval_requests;
  current_step apticket.supplier_payable_approval_steps;
begin
  select * into request from apticket.supplier_payable_approval_requests
    where id=p_request_id for update;
  if not found then raise exception using errcode='P0002',message='Solicitacao de aprovacao nao encontrada.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(
    request.tenant_id,request.operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para aprovar este lancamento.';
  end if;
  if request.status<>'pending' then
    raise exception using errcode='23514',message='Esta solicitacao de aprovacao ja foi concluida.';
  end if;
  if p_comment is not null and length(btrim(p_comment)) not between 1 and 1000 then
    raise exception using errcode='23514',message='O comentario deve possuir no maximo mil caracteres.';
  end if;
  select * into current_step from apticket.supplier_payable_approval_steps
    where request_id=request.id and status='pending'
    order by step_order limit 1 for update;
  if not found then
    raise exception using errcode='23514',message='A solicitacao nao possui etapa pendente.';
  end if;
  if current_step.approver_id<>auth.uid() then
    raise exception using errcode='42501',message='A aprovacao aguarda a decisao de outro responsavel.';
  end if;
  update apticket.supplier_payable_approval_steps set status='approved',
    decided_at=clock_timestamp(),decision_comment=nullif(btrim(p_comment),'')
    where id=current_step.id;
  if not exists(select 1 from apticket.supplier_payable_approval_steps
    where request_id=request.id and status='pending') then
    update apticket.supplier_payable_approval_requests set status='approved',
      completed_at=clock_timestamp() where id=request.id;
    update apticket.supplier_payables set status='approved'
      where id=request.supplier_payable_id;
  end if;
  return true;
end $$;

create function apticket.reject_supplier_payable(
  p_request_id uuid,
  p_reason text
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare
  request apticket.supplier_payable_approval_requests;
  current_step apticket.supplier_payable_approval_steps;
begin
  select * into request from apticket.supplier_payable_approval_requests
    where id=p_request_id for update;
  if not found then raise exception using errcode='P0002',message='Solicitacao de aprovacao nao encontrada.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(
    request.tenant_id,request.operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para rejeitar este lancamento.';
  end if;
  if request.status<>'pending' then
    raise exception using errcode='23514',message='Esta solicitacao de aprovacao ja foi concluida.';
  end if;
  if length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then
    raise exception using errcode='23514',message='Informe o motivo da rejeicao com ate mil caracteres.';
  end if;
  select * into current_step from apticket.supplier_payable_approval_steps
    where request_id=request.id and status='pending'
    order by step_order limit 1 for update;
  if not found then
    raise exception using errcode='23514',message='A solicitacao nao possui etapa pendente.';
  end if;
  if current_step.approver_id<>auth.uid() then
    raise exception using errcode='42501',message='A aprovacao aguarda a decisao de outro responsavel.';
  end if;
  update apticket.supplier_payable_approval_steps set status='rejected',
    decided_at=clock_timestamp(),decision_comment=btrim(p_reason)
    where id=current_step.id;
  update apticket.supplier_payable_approval_requests set status='rejected',
    rejection_reason=btrim(p_reason),completed_at=clock_timestamp() where id=request.id;
  update apticket.supplier_payables set status='scheduled'
    where id=request.supplier_payable_id;
  return true;
end $$;

revoke all on function apticket.save_supplier_approval_policy(uuid,uuid,text,numeric,numeric,jsonb),
  apticket.archive_supplier_approval_policy(uuid),
  apticket.list_supplier_approval_approvers(uuid),
  apticket.submit_supplier_payable_for_approval(uuid),
  apticket.approve_supplier_payable(uuid,text),
  apticket.reject_supplier_payable(uuid,text) from public,anon;
grant execute on function apticket.save_supplier_approval_policy(uuid,uuid,text,numeric,numeric,jsonb),
  apticket.archive_supplier_approval_policy(uuid),
  apticket.list_supplier_approval_approvers(uuid),
  apticket.submit_supplier_payable_for_approval(uuid),
  apticket.approve_supplier_payable(uuid,text),
  apticket.reject_supplier_payable(uuid,text) to authenticated;

comment on table apticket.supplier_approval_policies is 'Faixas de valor das alcadas de aprovacao de contas a pagar.';
comment on table apticket.supplier_approval_policy_steps is 'Responsaveis sequenciais configurados em cada alcada.';
comment on table apticket.supplier_payable_approval_requests is 'Historico imutavel de envios de contas a pagar para aprovacao.';
comment on table apticket.supplier_payable_approval_steps is 'Snapshot das etapas e decisoes de cada solicitacao de aprovacao.';
notify pgrst,'reload schema';
