begin;

create table apticket.outbound_channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id) on delete cascade,
  direction text not null default 'outbound' check (direction = 'outbound'),
  name text not null check (length(btrim(name)) between 1 and 80),
  provider text not null default 'uazapi' check (provider = 'uazapi'),
  base_url text not null check (length(btrim(base_url)) between 8 and 500),
  access_token text not null,
  instance_name text,
  connected_number text,
  status text not null default 'disconnected'
    check (status in ('disconnected','qr_pending','connected','error')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index outbound_channels_tenant_name_active_uidx
  on apticket.outbound_channels (tenant_id, lower(name)) where deleted_at is null;
create index outbound_channels_tenant_idx
  on apticket.outbound_channels (tenant_id) where deleted_at is null;
create trigger outbound_channels_set_updated_at before update on apticket.outbound_channels
  for each row execute function apticket.set_updated_at();

create table apticket.automation_triggers (
  id text primary key,
  name text not null,
  when_description text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger automation_triggers_set_updated_at before update on apticket.automation_triggers
  for each row execute function apticket.set_updated_at();

insert into apticket.automation_triggers (id, name, when_description)
values (
  'documentos_disponibilizados',
  'Disponibilizar documentos',
  'Quando o usuário finalizar a disponibilização dos documentos ao cliente'
);

create table apticket.automations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  trigger_id text not null references apticket.automation_triggers(id) on delete restrict,
  outbound_channel_id uuid not null references apticket.outbound_channels(id) on delete restrict,
  recipient_profile text not null
    check (recipient_profile in ('financeiro','administrativo','administrativo_financeiro')),
  template_id uuid not null references apticket.canned_responses(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index automations_tenant_trigger_idx
  on apticket.automations (tenant_id, trigger_id) where deleted_at is null and active;
create trigger automations_set_updated_at before update on apticket.automations
  for each row execute function apticket.set_updated_at();

create table apticket.automation_executions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id) on delete cascade,
  automation_id uuid not null references apticket.automations(id) on delete restrict,
  company_id uuid not null references apticket.companies(id) on delete restrict,
  related_entity_id uuid,
  status text not null check (status in ('success','partial','error','skipped')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index automation_executions_tenant_created_idx
  on apticket.automation_executions (tenant_id, created_at desc) where deleted_at is null;
create trigger automation_executions_set_updated_at before update on apticket.automation_executions
  for each row execute function apticket.set_updated_at();

-- Um identificador comum evita disparar uma mensagem por arquivo no upload em lote.
alter table apticket.client_documents
  add column publication_batch_id uuid not null default gen_random_uuid();
create index client_documents_publication_batch_idx
  on apticket.client_documents (tenant_id, publication_batch_id);

create table apticket.automation_dispatch_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id) on delete cascade,
  trigger_id text not null references apticket.automation_triggers(id) on delete restrict,
  company_id uuid not null references apticket.companies(id) on delete restrict,
  related_entity_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','done','error')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (tenant_id, trigger_id, related_entity_id)
);
create index automation_dispatch_outbox_pending_idx
  on apticket.automation_dispatch_outbox (available_at, created_at)
  where status = 'pending' and deleted_at is null;
create trigger automation_dispatch_outbox_set_updated_at
  before update on apticket.automation_dispatch_outbox
  for each row execute function apticket.set_updated_at();

create or replace function apticket.enqueue_document_automation()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if new.deleted_at is null then
    insert into apticket.automation_dispatch_outbox (
      tenant_id, trigger_id, company_id, related_entity_id, payload
    ) values (
      new.tenant_id,
      'documentos_disponibilizados',
      new.company_id,
      new.publication_batch_id,
      jsonb_build_object('competencia', new.competencia, 'document_type', new.document_type)
    ) on conflict (tenant_id, trigger_id, related_entity_id) do update
      set payload = apticket.automation_dispatch_outbox.payload ||
        jsonb_build_object('document_count',
          coalesce((apticket.automation_dispatch_outbox.payload->>'document_count')::integer, 1) + 1);
  end if;
  return new;
end $$;
revoke all on function apticket.enqueue_document_automation() from public, anon, authenticated, service_role;
create trigger client_documents_enqueue_automation
  after insert on apticket.client_documents
  for each row execute function apticket.enqueue_document_automation();

create or replace function apticket.claim_automation_dispatches(p_limit integer default 25)
returns setof apticket.automation_dispatch_outbox
language plpgsql security definer set search_path = pg_catalog as $$
begin
  return query
  with picked as (
    select id from apticket.automation_dispatch_outbox
    where deleted_at is null
      and status = 'pending'
      and available_at <= now()
    order by created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  )
  update apticket.automation_dispatch_outbox outbox
     set status = 'processing', claimed_at = now(), attempt_count = attempt_count + 1
    from picked
   where outbox.id = picked.id
  returning outbox.*;
end $$;
revoke all on function apticket.claim_automation_dispatches(integer) from public, anon, authenticated;
grant execute on function apticket.claim_automation_dispatches(integer) to service_role;

create or replace function apticket.finish_automation_dispatch(
  p_dispatch_id uuid, p_success boolean, p_error text default null
) returns void language plpgsql security definer set search_path = pg_catalog as $$
begin
  update apticket.automation_dispatch_outbox
     set status = case when p_success then 'done' else 'error' end,
         finished_at = now(),
         last_error = left(p_error, 2000)
   where id = p_dispatch_id and deleted_at is null;
end $$;
revoke all on function apticket.finish_automation_dispatch(uuid,boolean,text) from public, anon, authenticated;
grant execute on function apticket.finish_automation_dispatch(uuid,boolean,text) to service_role;

alter table apticket.outbound_channels enable row level security;
alter table apticket.automation_triggers enable row level security;
alter table apticket.automations enable row level security;
alter table apticket.automation_executions enable row level security;
alter table apticket.automation_dispatch_outbox enable row level security;

grant select, insert, update on apticket.outbound_channels to authenticated;
grant select on apticket.automation_triggers to authenticated;
grant select, insert, update on apticket.automations to authenticated;
grant select on apticket.automation_executions to authenticated;
grant all on apticket.outbound_channels, apticket.automation_triggers, apticket.automations,
  apticket.automation_executions, apticket.automation_dispatch_outbox to service_role;

create policy outbound_channels_select on apticket.outbound_channels for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and deleted_at is null
    and apticket.has_permission(auth.uid(), 'canais', 'view'));
create policy outbound_channels_insert on apticket.outbound_channels for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id()
    and apticket.has_permission(auth.uid(), 'canais', 'edit'));
create policy outbound_channels_update on apticket.outbound_channels for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and deleted_at is null
    and apticket.has_permission(auth.uid(), 'canais', 'edit'))
  with check (tenant_id = apticket.current_tenant_id()
    and apticket.has_permission(auth.uid(), 'canais', 'edit'));
create policy automation_triggers_select on apticket.automation_triggers for select to authenticated
  using (active and deleted_at is null);
create policy automations_select on apticket.automations for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and deleted_at is null
    and apticket.has_permission(auth.uid(), 'automacoes', 'view'));
create policy automations_insert on apticket.automations for insert to authenticated
  with check (tenant_id = apticket.current_tenant_id()
    and apticket.has_permission(auth.uid(), 'automacoes', 'create'));
create policy automations_update on apticket.automations for update to authenticated
  using (tenant_id = apticket.current_tenant_id() and deleted_at is null
    and apticket.has_permission(auth.uid(), 'automacoes', 'edit'))
  with check (tenant_id = apticket.current_tenant_id()
    and apticket.has_permission(auth.uid(), 'automacoes', 'edit'));
create policy automation_executions_select on apticket.automation_executions for select to authenticated
  using (tenant_id = apticket.current_tenant_id() and deleted_at is null
    and apticket.has_permission(auth.uid(), 'automacoes', 'view'));

insert into apticket.permissions(module, action, description) values
  ('automacoes','view','Visualizar automações e execuções'),
  ('automacoes','create','Criar automações'),
  ('automacoes','edit','Editar e ativar automações'),
  ('automacoes','delete','Arquivar automações')
on conflict (module, action) do update set description = excluded.description;

insert into apticket.role_permissions(role_id, permission_id)
select role.id, permission.id
from apticket.roles role
join apticket.permissions permission on permission.module = 'automacoes'
where lower(role.name) = 'admin'
on conflict do nothing;

insert into apticket.canned_responses (tenant_id, title, body)
select tenant.id, 'Documentos Disponibilizados',
  'Olá, {{contato}}! Os documentos de {{competencia}} de {{cliente}} já estão disponíveis no portal: {{portal_link}}'
from apticket.tenants tenant
where not exists (
  select 1 from apticket.canned_responses template
  where template.tenant_id = tenant.id and lower(template.title) = lower('Documentos Disponibilizados')
);

create or replace function apticket.seed_document_template_for_tenant()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  insert into apticket.canned_responses(tenant_id, title, body)
  values (new.id, 'Documentos Disponibilizados',
    'Olá, {{contato}}! Os documentos de {{competencia}} de {{cliente}} já estão disponíveis no portal: {{portal_link}}');
  return new;
end $$;
revoke all on function apticket.seed_document_template_for_tenant() from public, anon, authenticated, service_role;
create trigger tenants_seed_document_template
  after insert on apticket.tenants for each row execute function apticket.seed_document_template_for_tenant();

comment on table apticket.outbound_channels is
  'Canais exclusivamente de saída; credenciais são cifradas pela API antes de persistir.';
comment on table apticket.automations is
  'Regras tenant-scoped no formato gatilho, condição catalogada e ação.';
comment on table apticket.automation_dispatch_outbox is
  'Outbox durável consumida pelo dispatcher genérico de automações da API.';

commit;
