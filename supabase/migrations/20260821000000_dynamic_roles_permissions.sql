-- Bloco 2: papéis e permissões dinâmicos — ver plano em
-- C:\Users\luiz.esposito\.claude\plans\vectorized-painting-puppy.md
--
-- Hoje apticket.app_role é um enum fixo (admin/agent/requester), só 10 pontos
-- checam papel (todos "é admin ou não"), e o resto (tickets, contratos,
-- clientes, contatos, equipamentos, mensagens...) é liberado a qualquer
-- membro autenticado do tenant sem diferenciação nenhuma entre agent e
-- requester. Esta migration:
--   1. cria papéis dinâmicos por tenant (roles) + catálogo global de
--      permissões módulo×ação (permissions) + defaults por papel
--      (role_permissions) + overrides por usuário (user_permissions) +
--      log de auditoria mínimo (permission_audit_log);
--   2. reescreve as 37 RLS policies existentes (26 tabelas) pra usar
--      has_permission() em vez do enum antigo — as 27 que hoje só checavam
--      tenant_id passam a checar também módulo×ação;
--   3. migra o enum antigo pro novo modelo preservando EXATAMENTE o
--      comportamento atual pra agent/requester (paridade — só canais:manage
--      nasce mais restrito que hoje, decisão explícita do usuário).
--
-- Convenção: apticket. direto (as 2 migrations mais recentes do Bloco 1 já
-- abandonaram o script antigo de rewrite public.->apticket., não existe mais).

begin;

-- ============================================================
-- 1. TABELAS NOVAS
-- ============================================================

create table apticket.roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id) on delete cascade,
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create index roles_tenant_idx on apticket.roles(tenant_id);
alter table apticket.roles enable row level security;
grant select, insert, update, delete on apticket.roles to authenticated;
grant all on apticket.roles to service_role;

create table apticket.permissions (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  action text not null,
  description text,
  created_at timestamptz not null default now(),
  unique (module, action)
);
alter table apticket.permissions enable row level security;
grant select on apticket.permissions to authenticated;
grant all on apticket.permissions to service_role;

create table apticket.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references apticket.roles(id) on delete cascade,
  permission_id uuid not null references apticket.permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (role_id, permission_id)
);
create index role_permissions_role_idx on apticket.role_permissions(role_id);
alter table apticket.role_permissions enable row level security;
grant select, insert, update, delete on apticket.role_permissions to authenticated;
grant all on apticket.role_permissions to service_role;

create table apticket.user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references apticket.profiles(id) on delete cascade,
  tenant_id uuid not null references apticket.tenants(id) on delete cascade,
  permission_id uuid not null references apticket.permissions(id) on delete cascade,
  granted boolean not null, -- true = concedido (override positivo), false = revogado
  created_by uuid references apticket.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, permission_id)
);
create index user_permissions_user_idx on apticket.user_permissions(user_id);
alter table apticket.user_permissions enable row level security;
grant select, insert, update, delete on apticket.user_permissions to authenticated;
grant all on apticket.user_permissions to service_role;

create table apticket.permission_audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id) on delete cascade,
  actor_id uuid references apticket.profiles(id) on delete set null,
  action text not null,
  target_type text not null, -- 'role' | 'user'
  target_id uuid not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index permission_audit_log_tenant_idx on apticket.permission_audit_log(tenant_id, created_at desc);
alter table apticket.permission_audit_log enable row level security;
-- sem policy pra authenticated de propósito (mesmo padrão de apticket.invites)
-- — só server-side (*.functions.ts com supabaseAdmin) escreve/lê aqui.
grant select, insert on apticket.permission_audit_log to service_role;

-- ============================================================
-- 2. CATÁLOGO DE PERMISSÕES (fixo, global, seed único)
-- ============================================================

insert into apticket.permissions (module, action) values
  ('tickets','view'),('tickets','create'),('tickets','edit'),('tickets','delete'),
  ('clientes','view'),('clientes','create'),('clientes','edit'),('clientes','delete'),
  ('contatos','view'),('contatos','create'),('contatos','edit'),('contatos','delete'),
  ('equipamentos','view'),('equipamentos','create'),('equipamentos','edit'),('equipamentos','delete'),
  ('contratos','view'),('contratos','create'),('contratos','edit'),('contratos','delete'),
  ('base_conhecimento','view'),('base_conhecimento','write'),
  ('respostas_prontas','view'),('respostas_prontas','write'),
  ('configuracoes','view'),('configuracoes','write'),
  ('usuarios','view'),('usuarios','create'),('usuarios','edit'),('usuarios','delete'),
  ('canais','manage'),('canais','send'),
  ('papeis','view'),('papeis','manage'),
  ('relatorios','view'),('relatorios','export');

-- ============================================================
-- 3. SEED DE PAPÉIS DEFAULT POR TENANT
-- ============================================================

create or replace function apticket.seed_tenant_default_roles(_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = apticket
as $$
declare
  v_admin uuid;
  v_agent uuid;
  v_req uuid;
begin
  insert into apticket.roles (tenant_id, name, description, is_system)
    values (_tenant_id, 'Admin', 'Acesso total ao workspace', true)
    returning id into v_admin;
  insert into apticket.roles (tenant_id, name, description, is_system)
    values (_tenant_id, 'Agente', 'Atende tickets e opera o dia a dia', false)
    returning id into v_agent;
  insert into apticket.roles (tenant_id, name, description, is_system)
    values (_tenant_id, 'Solicitante', 'Abre e acompanha os próprios tickets', false)
    returning id into v_req;

  -- admin: catálogo inteiro
  insert into apticket.role_permissions (role_id, permission_id)
    select v_admin, id from apticket.permissions;

  -- agent/requester: paridade com o comportamento atual (tudo, exceto o que
  -- já era admin-only hoje + os módulos novos de gestão/canal sensível)
  insert into apticket.role_permissions (role_id, permission_id)
    select r, id
    from apticket.permissions, unnest(array[v_agent, v_req]) as r
    where module <> 'papeis'
      and not (module = 'canais' and action = 'manage')
      and not (module = 'usuarios' and action in ('view','create','edit','delete'))
      and not (module = 'configuracoes' and action = 'write')
      and not (module = 'base_conhecimento' and action = 'write')
      and not (module = 'respostas_prontas' and action = 'write');
end;
$$;

create or replace function apticket.seed_tenant_default_roles_trigger()
returns trigger
language plpgsql
security definer
set search_path = apticket
as $$
begin
  perform apticket.seed_tenant_default_roles(new.id);
  return new;
end;
$$;

drop trigger if exists tenants_seed_default_roles on apticket.tenants;
create trigger tenants_seed_default_roles
  after insert on apticket.tenants
  for each row execute function apticket.seed_tenant_default_roles_trigger();

-- backfill: tenants que já existem
do $$
declare t record;
begin
  for t in select id from apticket.tenants loop
    perform apticket.seed_tenant_default_roles(t.id);
  end loop;
end $$;

-- ============================================================
-- 4. user_roles: role_id substitui o enum (1 papel por usuário)
-- ============================================================

alter table apticket.user_roles add column role_id uuid references apticket.roles(id) on delete restrict;

-- dedup: se algum usuário tiver >1 linha hoje (schema permite, UI nunca fez),
-- fica só a de maior privilégio
delete from apticket.user_roles a using apticket.user_roles b
where a.user_id = b.user_id and a.id <> b.id
  and (
    (case a.role when 'admin' then 3 when 'agent' then 2 else 1 end) <
    (case b.role when 'admin' then 3 when 'agent' then 2 else 1 end)
    or (
      (case a.role when 'admin' then 3 when 'agent' then 2 else 1 end) =
      (case b.role when 'admin' then 3 when 'agent' then 2 else 1 end)
      and a.id > b.id
    )
  );

update apticket.user_roles ur
set role_id = r.id
from apticket.roles r
where r.tenant_id = ur.tenant_id
  and r.name = case ur.role
    when 'admin' then 'Admin'
    when 'agent' then 'Agente'
    else 'Solicitante'
  end;

-- se sobrou algum sem role_id (não deveria — todo tenant foi seedado acima),
-- aborta a migration em vez de silenciosamente deixar usuário sem papel.
do $$
declare v_missing int;
begin
  select count(*) into v_missing from apticket.user_roles where role_id is null;
  if v_missing > 0 then
    raise exception 'user_roles: % linha(s) sem role_id após backfill', v_missing;
  end if;
end $$;

alter table apticket.user_roles alter column role_id set not null;
alter table apticket.user_roles add constraint user_roles_user_unique unique (user_id);

-- ============================================================
-- 5. Proteção de papel de sistema (não excluir, não perder permissão)
-- ============================================================

create or replace function apticket.protect_system_role()
returns trigger
language plpgsql
set search_path = apticket
as $$
begin
  if OLD.is_system then
    raise exception 'não é possível excluir um papel de sistema';
  end if;
  return old;
end;
$$;
drop trigger if exists roles_protect_system on apticket.roles;
create trigger roles_protect_system
  before delete on apticket.roles
  for each row execute function apticket.protect_system_role();

create or replace function apticket.protect_system_role_permissions()
returns trigger
language plpgsql
set search_path = apticket
as $$
begin
  if exists (select 1 from apticket.roles r where r.id = OLD.role_id and r.is_system) then
    raise exception 'não é possível remover permissão de um papel de sistema';
  end if;
  return old;
end;
$$;
drop trigger if exists role_permissions_protect_system on apticket.role_permissions;
create trigger role_permissions_protect_system
  before delete on apticket.role_permissions
  for each row execute function apticket.protect_system_role_permissions();

-- ============================================================
-- 6. Resolução de permissão efetiva — única fonte de verdade
-- ============================================================

create or replace function apticket.get_effective_permissions(_user_id uuid)
returns table(
  module text,
  action text,
  granted_by_role boolean,
  override boolean,
  effective boolean
)
language sql
stable
security invoker
set search_path = apticket
as $$
  select
    p.module,
    p.action,
    (rp.permission_id is not null) as granted_by_role,
    up.granted as override,
    coalesce(up.granted, rp.permission_id is not null) as effective
  from apticket.permissions p
  left join apticket.user_roles ur on ur.user_id = _user_id
  left join apticket.role_permissions rp on rp.permission_id = p.id and rp.role_id = ur.role_id
  left join apticket.user_permissions up on up.permission_id = p.id and up.user_id = _user_id;
$$;
grant execute on function apticket.get_effective_permissions(uuid) to authenticated;

create or replace function apticket.has_permission(_user_id uuid, _module text, _action text)
returns boolean
language sql
stable
security invoker
set search_path = apticket
as $$
  select coalesce(
    (select effective from apticket.get_effective_permissions(_user_id)
     where module = _module and action = _action),
    false
  );
$$;
grant execute on function apticket.has_permission(uuid, text, text) to authenticated;

-- ============================================================
-- 7. RLS das 5 tabelas novas
-- ============================================================

create policy "permissions read all" on apticket.permissions
  for select to authenticated using (true);
-- sem policy de insert/update/delete p/ authenticated: catálogo só muda via migration.

create policy "roles read tenant" on apticket.roles
  for select to authenticated using (tenant_id = apticket.current_tenant_id());
create policy "roles manage" on apticket.roles
  for all to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'papeis','manage'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'papeis','manage'));

create policy "role_permissions read tenant" on apticket.role_permissions
  for select to authenticated using (
    exists (select 1 from apticket.roles r where r.id = role_id and r.tenant_id = apticket.current_tenant_id())
  );
create policy "role_permissions manage" on apticket.role_permissions
  for all to authenticated
  using (
    exists (select 1 from apticket.roles r where r.id = role_id and r.tenant_id = apticket.current_tenant_id())
    and apticket.has_permission(auth.uid(),'papeis','manage')
  )
  with check (
    exists (select 1 from apticket.roles r where r.id = role_id and r.tenant_id = apticket.current_tenant_id())
    and apticket.has_permission(auth.uid(),'papeis','manage')
  );

create policy "user_permissions read tenant" on apticket.user_permissions
  for select to authenticated using (tenant_id = apticket.current_tenant_id());
create policy "user_permissions manage" on apticket.user_permissions
  for all to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'papeis','manage'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'papeis','manage'));

-- ============================================================
-- 8. Reescrita das 37 policies existentes (26 tabelas)
-- ============================================================

-- ---- Grupo B: módulo primário, 4 ações (select/insert/update/delete) ----

drop policy "tickets tenant access" on apticket.tickets;
create policy "tickets select" on apticket.tickets for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','view'));
create policy "tickets insert" on apticket.tickets for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','create'));
create policy "tickets update" on apticket.tickets for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'));
create policy "tickets delete" on apticket.tickets for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','delete'));

drop policy "companies tenant access" on apticket.companies;
create policy "companies select" on apticket.companies for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'clientes','view'));
create policy "companies insert" on apticket.companies for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'clientes','create'));
create policy "companies update" on apticket.companies for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'clientes','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'clientes','edit'));
create policy "companies delete" on apticket.companies for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'clientes','delete'));

drop policy "contacts tenant access" on apticket.contacts;
create policy "contacts select" on apticket.contacts for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'contatos','view'));
create policy "contacts insert" on apticket.contacts for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'contatos','create'));
create policy "contacts update" on apticket.contacts for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'contatos','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'contatos','edit'));
create policy "contacts delete" on apticket.contacts for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'contatos','delete'));

drop policy "tenant_isolation_equipments" on apticket.equipments;
create policy "equipments select" on apticket.equipments for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'equipamentos','view'));
create policy "equipments insert" on apticket.equipments for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'equipamentos','create'));
create policy "equipments update" on apticket.equipments for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'equipamentos','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'equipamentos','edit'));
create policy "equipments delete" on apticket.equipments for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'equipamentos','delete'));

drop policy "contracts tenant access" on apticket.contracts;
create policy "contracts select" on apticket.contracts for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'contratos','view'));
create policy "contracts insert" on apticket.contracts for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'contratos','create'));
create policy "contracts update" on apticket.contracts for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'contratos','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'contratos','edit'));
create policy "contracts delete" on apticket.contracts for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'contratos','delete'));

-- ---- Grupo C: tabelas filhas — view herda do pai, toda escrita = edit do pai ----

drop policy "messages tenant access" on apticket.messages;
create policy "messages select" on apticket.messages for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','view'));
create policy "messages insert" on apticket.messages for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'));
create policy "messages update" on apticket.messages for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'));
create policy "messages delete" on apticket.messages for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'));

drop policy "time_entries tenant access" on apticket.time_entries;
create policy "time_entries select" on apticket.time_entries for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','view'));
create policy "time_entries insert" on apticket.time_entries for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'));
create policy "time_entries update" on apticket.time_entries for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'));
create policy "time_entries delete" on apticket.time_entries for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'));

drop policy "tenant_isolation_ticket_equipments" on apticket.ticket_equipments;
create policy "ticket_equipments select" on apticket.ticket_equipments for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','view'));
create policy "ticket_equipments insert" on apticket.ticket_equipments for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'));
create policy "ticket_equipments update" on apticket.ticket_equipments for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'));
create policy "ticket_equipments delete" on apticket.ticket_equipments for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'));

drop policy "ticket_services_performed tenant access" on apticket.ticket_services_performed;
create policy "ticket_services_performed select" on apticket.ticket_services_performed for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','view'));
create policy "ticket_services_performed insert" on apticket.ticket_services_performed for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'));
create policy "ticket_services_performed update" on apticket.ticket_services_performed for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'));
create policy "ticket_services_performed delete" on apticket.ticket_services_performed for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'));

drop policy "ticket_closing_reports tenant access" on apticket.ticket_closing_reports;
create policy "ticket_closing_reports select" on apticket.ticket_closing_reports for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','view'));
create policy "ticket_closing_reports insert" on apticket.ticket_closing_reports for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'));
create policy "ticket_closing_reports update" on apticket.ticket_closing_reports for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'));
create policy "ticket_closing_reports delete" on apticket.ticket_closing_reports for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'));

drop policy "csat tenant access" on apticket.csat_responses;
create policy "csat_responses select" on apticket.csat_responses for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','view'));
create policy "csat_responses insert" on apticket.csat_responses for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'));
create policy "csat_responses update" on apticket.csat_responses for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'));
create policy "csat_responses delete" on apticket.csat_responses for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'tickets','edit'));

drop policy "tenant isolation contract_equipments" on apticket.contract_equipments;
create policy "contract_equipments select" on apticket.contract_equipments for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'contratos','view'));
create policy "contract_equipments insert" on apticket.contract_equipments for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'contratos','edit'));
create policy "contract_equipments update" on apticket.contract_equipments for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'contratos','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'contratos','edit'));
create policy "contract_equipments delete" on apticket.contract_equipments for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'contratos','edit'));

-- ---- Grupo D: módulos de 2 ações (view/write) — select vs insert/update/delete ----

drop policy "tenant_isolation_stickers" on apticket.stickers;
create policy "stickers select" on apticket.stickers for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','view'));
create policy "stickers insert" on apticket.stickers for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','write'));
create policy "stickers update" on apticket.stickers for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','write'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','write'));
create policy "stickers delete" on apticket.stickers for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','write'));

drop policy "departments tenant access" on apticket.departments;
create policy "departments select" on apticket.departments for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','view'));
create policy "departments insert" on apticket.departments for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','write'));
create policy "departments update" on apticket.departments for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','write'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','write'));
create policy "departments delete" on apticket.departments for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','write'));

drop policy "service_families tenant access" on apticket.service_families;
create policy "service_families select" on apticket.service_families for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','view'));
create policy "service_families insert" on apticket.service_families for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','write'));
create policy "service_families update" on apticket.service_families for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','write'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','write'));
create policy "service_families delete" on apticket.service_families for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','write'));

drop policy "provided_services tenant access" on apticket.provided_services;
create policy "provided_services select" on apticket.provided_services for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','view'));
create policy "provided_services insert" on apticket.provided_services for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','write'));
create policy "provided_services update" on apticket.provided_services for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','write'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','write'));
create policy "provided_services delete" on apticket.provided_services for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','write'));

drop policy "canned tenant access" on apticket.canned_responses;
create policy "canned_responses select" on apticket.canned_responses for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'respostas_prontas','view'));
create policy "canned_responses insert" on apticket.canned_responses for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'respostas_prontas','write'));
create policy "canned_responses update" on apticket.canned_responses for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'respostas_prontas','write'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'respostas_prontas','write'));
create policy "canned_responses delete" on apticket.canned_responses for delete to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'respostas_prontas','write'));

-- ---- Grupo E: já eram split read/admin-write — só troca a função ----

drop policy "contract_types admin write" on apticket.contract_types;
create policy "contract_types admin write" on apticket.contract_types for all to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','write'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','write'));
-- "contract_types read tenant" (SELECT, sem gate de papel) fica igual.

drop policy "kb_articles admin write" on apticket.kb_articles;
create policy "kb_articles admin write" on apticket.kb_articles for all to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'base_conhecimento','write'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'base_conhecimento','write'));
-- "kb_articles public read" e "kb_articles read tenant" (SELECT) ficam iguais.

drop policy "kb_categories admin write" on apticket.kb_categories;
create policy "kb_categories admin write" on apticket.kb_categories for all to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'base_conhecimento','write'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'base_conhecimento','write'));
-- "kb_categories public read" e "kb_categories read tenant" (SELECT) ficam iguais.

drop policy "sla admin write" on apticket.sla_policies;
create policy "sla admin write" on apticket.sla_policies for all to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','write'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','write'));
-- "sla read tenant" (SELECT) fica igual.

drop policy "admins update tenant" on apticket.tenants;
create policy "admins update tenant" on apticket.tenants for update to authenticated
  using (id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'configuracoes','write'))
  with check (id = apticket.current_tenant_id());
-- "tenant members read tenant" (SELECT) fica igual.

drop policy "admin inserts profile" on apticket.profiles;
create policy "admin inserts profile" on apticket.profiles for insert to authenticated
  with check (apticket.has_permission(auth.uid(),'usuarios','create') and tenant_id = apticket.current_tenant_id());

drop policy "admin deletes profile" on apticket.profiles;
create policy "admin deletes profile" on apticket.profiles for delete to authenticated
  using (apticket.has_permission(auth.uid(),'usuarios','delete') and tenant_id = apticket.current_tenant_id());
-- "read profiles in tenant" (SELECT) e "user updates own profile" (UPDATE) ficam iguais.

drop policy "admin manages roles" on apticket.user_roles;
create policy "admin manages roles" on apticket.user_roles for all to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'usuarios','edit'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'usuarios','edit'));

drop policy "read own roles or admin reads tenant roles" on apticket.user_roles;
create policy "read own roles or admin reads tenant roles" on apticket.user_roles for select to authenticated
  using (user_id = auth.uid() or (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'usuarios','view')));

-- ---- Grupo F: filas operacionais de canal — 1 policy ALL usando canais:send ----

drop policy "tenant members manage pending email" on apticket.email_pending_messages;
create policy "email_pending_messages manage" on apticket.email_pending_messages for all to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'canais','send'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'canais','send'));

drop policy "tenant members manage pending whatsapp" on apticket.whatsapp_pending_messages;
create policy "whatsapp_pending_messages manage" on apticket.whatsapp_pending_messages for all to authenticated
  using (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'canais','send'))
  with check (tenant_id = apticket.current_tenant_id() and apticket.has_permission(auth.uid(),'canais','send'));

-- ============================================================
-- 9. prevent_profile_tenant_change: troca has_role por has_permission
-- ============================================================

-- mantém SECURITY DEFINER do original (migration 20260714181315) — já é
-- REVOKE ALL de public/anon/authenticated lá, CREATE OR REPLACE preserva
-- essa ACL porque a assinatura não muda.
create or replace function apticket.prevent_profile_tenant_change()
returns trigger
language plpgsql
security definer
set search_path = apticket
as $$
begin
  if (new.tenant_id is distinct from old.tenant_id or new.id is distinct from old.id)
     and not apticket.has_permission(auth.uid(), 'usuarios', 'edit') then
    raise exception 'cannot change tenant_id or id';
  end if;
  return new;
end;
$$;

-- ============================================================
-- 10. Limpeza: enum antigo sai de cena
-- ============================================================

drop function if exists apticket.has_role(uuid, apticket.app_role);
alter table apticket.user_roles drop column role;
drop type apticket.app_role;

commit;
