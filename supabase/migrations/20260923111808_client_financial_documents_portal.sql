begin;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'apticket' and t.typname = 'document_type'
  ) then
    create type apticket.document_type as enum ('medicao', 'fatura', 'nfse', 'boleto', 'outro');
  end if;
end $$;

alter table apticket.contacts
  add column if not exists is_portal_admin boolean not null default false,
  add column if not exists is_portal_financial boolean not null default false;

create table if not exists apticket.client_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id) on delete cascade,
  company_id uuid not null references apticket.companies(id) on delete restrict,
  document_type apticket.document_type not null,
  competencia date not null check (extract(day from competencia) = 1),
  historico text,
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  file_path text not null unique,
  file_size bigint check (file_size is null or file_size between 0 and 10485760),
  mime_type text not null,
  uploaded_by uuid not null references apticket.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists client_documents_company_competencia_idx
  on apticket.client_documents (company_id, competencia desc, created_at desc)
  where deleted_at is null;
create index if not exists client_documents_tenant_idx
  on apticket.client_documents (tenant_id)
  where deleted_at is null;

create table if not exists apticket.document_downloads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id) on delete cascade,
  document_id uuid not null references apticket.client_documents(id) on delete restrict,
  contact_id uuid not null references apticket.contacts(id) on delete restrict,
  downloaded_at timestamptz not null default now()
);

create index if not exists document_downloads_document_idx
  on apticket.document_downloads (document_id, downloaded_at desc);
create index if not exists document_downloads_contact_idx
  on apticket.document_downloads (contact_id, downloaded_at desc);

create or replace function apticket.guard_client_document()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1 from apticket.companies c
    where c.id = new.company_id and c.tenant_id = new.tenant_id
  ) then
    raise exception using errcode = '23514', message = 'O cliente não pertence à organização informada.';
  end if;

  if not exists (
    select 1 from apticket.profiles p
    where p.id = new.uploaded_by and p.tenant_id = new.tenant_id
  ) then
    raise exception using errcode = '23514', message = 'O responsável pelo envio não pertence à organização informada.';
  end if;

  if tg_op = 'UPDATE'
     and old.deleted_at is distinct from new.deleted_at
     and current_user not in ('postgres', 'service_role')
     and not apticket.has_permission(auth.uid(), 'financeiro.disponibilizar_documentos', 'delete') then
    raise exception using errcode = '42501', message = 'Sem permissão para excluir documentos financeiros.';
  end if;

  if tg_op = 'UPDATE'
     and (to_jsonb(old) - 'updated_at' - 'deleted_at') is distinct from
         (to_jsonb(new) - 'updated_at' - 'deleted_at')
     and current_user not in ('postgres', 'service_role')
     and not apticket.has_permission(auth.uid(), 'financeiro.disponibilizar_documentos', 'edit') then
    raise exception using errcode = '42501', message = 'Sem permissão para editar documentos financeiros.';
  end if;

  return new;
end;
$$;

drop trigger if exists client_documents_guard on apticket.client_documents;
create trigger client_documents_guard
before insert or update on apticket.client_documents
for each row execute function apticket.guard_client_document();

drop trigger if exists client_documents_set_updated_at on apticket.client_documents;
create trigger client_documents_set_updated_at
before update on apticket.client_documents
for each row execute function apticket.set_updated_at();

create or replace function apticket.guard_document_download()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1
    from apticket.client_documents d
    join apticket.contacts c on c.id = new.contact_id
    where d.id = new.document_id
      and d.tenant_id = new.tenant_id
      and c.tenant_id = new.tenant_id
      and c.company_id = d.company_id
      and c.is_active
      and c.is_portal_financial
      and d.deleted_at is null
  ) then
    raise exception using errcode = '42501', message = 'Contato sem acesso a este documento.';
  end if;
  return new;
end;
$$;

drop trigger if exists document_downloads_guard on apticket.document_downloads;
create trigger document_downloads_guard
before insert or update on apticket.document_downloads
for each row execute function apticket.guard_document_download();

insert into apticket.permissions (module, action, description)
values
  ('financeiro.disponibilizar_documentos', 'view', 'Visualizar documentos financeiros de clientes'),
  ('financeiro.disponibilizar_documentos', 'create', 'Disponibilizar documentos financeiros a clientes'),
  ('financeiro.disponibilizar_documentos', 'edit', 'Editar metadados de documentos financeiros'),
  ('financeiro.disponibilizar_documentos', 'delete', 'Arquivar documentos financeiros')
on conflict (module, action) do update set description = excluded.description;

insert into apticket.role_permissions (role_id, permission_id)
select r.id, p.id
from apticket.roles r
join apticket.permissions p on p.module = 'financeiro.disponibilizar_documentos'
where lower(r.name) in ('admin', 'financeiro')
on conflict do nothing;

create or replace function apticket.grant_financial_document_permissions_to_role()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if lower(new.name) in ('admin', 'financeiro') then
    insert into apticket.role_permissions (role_id, permission_id)
    select new.id, p.id
    from apticket.permissions p
    where p.module = 'financeiro.disponibilizar_documentos'
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists roles_grant_financial_document_permissions on apticket.roles;
create trigger roles_grant_financial_document_permissions
after insert on apticket.roles
for each row execute function apticket.grant_financial_document_permissions_to_role();

alter table apticket.client_documents enable row level security;
alter table apticket.document_downloads enable row level security;

grant select, insert, update on apticket.client_documents to authenticated;
grant select on apticket.document_downloads to authenticated;
grant all on apticket.client_documents, apticket.document_downloads to service_role;

create policy client_documents_staff_select
on apticket.client_documents for select to authenticated
using (
  tenant_id = apticket.current_tenant_id()
  and apticket.has_permission(auth.uid(), 'financeiro.disponibilizar_documentos', 'view')
);

create policy client_documents_staff_insert
on apticket.client_documents for insert to authenticated
with check (
  tenant_id = apticket.current_tenant_id()
  and uploaded_by = auth.uid()
  and apticket.has_permission(auth.uid(), 'financeiro.disponibilizar_documentos', 'create')
);

create policy client_documents_staff_update
on apticket.client_documents for update to authenticated
using (
  tenant_id = apticket.current_tenant_id()
  and (
    apticket.has_permission(auth.uid(), 'financeiro.disponibilizar_documentos', 'edit')
    or apticket.has_permission(auth.uid(), 'financeiro.disponibilizar_documentos', 'delete')
  )
)
with check (
  tenant_id = apticket.current_tenant_id()
  and (
    apticket.has_permission(auth.uid(), 'financeiro.disponibilizar_documentos', 'edit')
    or apticket.has_permission(auth.uid(), 'financeiro.disponibilizar_documentos', 'delete')
  )
);

create policy document_downloads_staff_select
on apticket.document_downloads for select to authenticated
using (
  tenant_id = apticket.current_tenant_id()
  and apticket.has_permission(auth.uid(), 'financeiro.disponibilizar_documentos', 'view')
);

revoke all on function apticket.guard_client_document(), apticket.guard_document_download(),
  apticket.grant_financial_document_permissions_to_role() from public, anon, authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-documents',
  'client-documents',
  false,
  10485760,
  array[
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/xml',
    'text/xml'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

comment on table apticket.client_documents is 'Documentos financeiros privados disponibilizados aos clientes.';
comment on table apticket.document_downloads is 'Auditoria imutável dos downloads realizados pelo portal do cliente.';

notify pgrst, 'reload schema';

commit;
