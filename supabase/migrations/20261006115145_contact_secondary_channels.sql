-- Primary fields stay compatible with portal access, notifications and existing tickets.
alter table apticket.contacts
  add column secondary_emails text[] not null default '{}',
  add column secondary_phones text[] not null default '{}';

-- Channel-created drafts may have no email until linked to a client.
alter table apticket.contacts add constraint contacts_registered_email_required
  check (company_id is null or nullif(btrim(email), '') is not null);

create schema if not exists apticket_contact_private;
revoke all on schema apticket_contact_private from public, anon, authenticated;

create function apticket_contact_private.normalize_phone(value text)
returns text language sql immutable set search_path = pg_catalog as $$
  select case when length(digits) in (10,11) and left(digits,2) <> '55'
    then '55' || digits else digits end
  from (select regexp_replace(value, '[^0-9]', '', 'g') as digits) normalized;
$$;
revoke all on function apticket_contact_private.normalize_phone(text) from public, anon, authenticated;

-- A unique index shared by primary/secondary identifiers prevents racing writes.
-- This internal table is not exposed through the Data API.
create table apticket_contact_private.identifiers (
  tenant_id uuid not null references apticket.tenants(id) on delete cascade,
  kind text not null check (kind in ('email','phone')),
  value text not null,
  contact_id uuid not null references apticket.contacts(id) on delete cascade,
  primary key (tenant_id, kind, value)
);
create index contact_identifiers_contact_idx on apticket_contact_private.identifiers(contact_id);
alter table apticket_contact_private.identifiers enable row level security;
revoke all on apticket_contact_private.identifiers from public, anon, authenticated;

insert into apticket_contact_private.identifiers(tenant_id,kind,value,contact_id)
select tenant_id,'email',lower(btrim(email)),id from apticket.contacts where nullif(btrim(email),'') is not null
union all
select tenant_id,'phone',apticket_contact_private.normalize_phone(phone),id from apticket.contacts where nullif(btrim(phone),'') is not null;

create function apticket_contact_private.validate_channels()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare
  emails text[];
  phones text[];
begin
  new.email := nullif(lower(btrim(new.email)), '');
  new.phone := nullif(apticket_contact_private.normalize_phone(new.phone), '');
  select coalesce(array_agg(lower(btrim(value)) order by ordinal), '{}') into new.secondary_emails
    from unnest(new.secondary_emails) with ordinality as items(value, ordinal);
  select coalesce(array_agg(apticket_contact_private.normalize_phone(value) order by ordinal), '{}') into new.secondary_phones
    from unnest(new.secondary_phones) with ordinality as items(value, ordinal);
  emails := array_remove(array[new.email] || new.secondary_emails, null);
  phones := array_remove(array[new.phone] || new.secondary_phones, null);
  if exists (select 1 from unnest(new.secondary_emails) value where value is null or value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(value)>255) then
    raise exception using errcode='23514',message='E-mail secundário inválido.';
  end if;
  if exists (select 1 from unnest(new.secondary_phones) value where value is null or value !~ '^[0-9]{10,15}$') then
    raise exception using errcode='23514',message='Telefone secundário inválido.';
  end if;
  if cardinality(emails) <> (select count(distinct value) from unnest(emails) value) then
    raise exception using errcode='23514',message='Este e-mail já foi informado no contato.';
  end if;
  if cardinality(phones) <> (select count(distinct value) from unnest(phones) value) then
    raise exception using errcode='23514',message='Este telefone já foi informado no contato.';
  end if;
  return new;
end $$;
revoke all on function apticket_contact_private.validate_channels() from public,anon,authenticated,service_role;

-- Definer privileges are only used by a private trigger to maintain identifiers.
-- No callable RPC, and the existing contacts RLS governs the original mutation.
create function apticket_contact_private.sync_identifiers()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  delete from apticket_contact_private.identifiers where contact_id=new.id;
  begin
    insert into apticket_contact_private.identifiers(tenant_id,kind,value,contact_id)
      select new.tenant_id,'email',value,new.id
      from unnest(array_remove(array[new.email] || new.secondary_emails, null)) value;
  exception when unique_violation then
    raise exception using errcode='23505',message='Já existe um contato cadastrado com este e-mail.';
  end;
  begin
    insert into apticket_contact_private.identifiers(tenant_id,kind,value,contact_id)
      select new.tenant_id,'phone',value,new.id
      from unnest(array_remove(array[new.phone] || new.secondary_phones, null)) value;
  exception when unique_violation then
    raise exception using errcode='23505',message='Já existe um contato cadastrado com este telefone.';
  end;
  return new;
end $$;
revoke all on function apticket_contact_private.sync_identifiers() from public,anon,authenticated,service_role;

create trigger contacts_validate_channels before insert or update of email,phone,secondary_emails,secondary_phones on apticket.contacts
  for each row execute function apticket_contact_private.validate_channels();
create trigger contacts_sync_identifiers after insert or update of tenant_id,email,phone,secondary_emails,secondary_phones on apticket.contacts
  for each row execute function apticket_contact_private.sync_identifiers();

create index contacts_secondary_emails_idx on apticket.contacts using gin(secondary_emails);
notify pgrst, 'reload schema';

-- Keep the chosen primary client when deduplicating the selection.
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

  select coalesce(array_agg(value order by first_position), '{}'::uuid[]) into v_ids
  from (
    select value, min(position) as first_position
    from unnest(coalesce(p_company_ids, '{}'::uuid[])) with ordinality as items(value, position)
    group by value
  ) ordered_ids;
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

