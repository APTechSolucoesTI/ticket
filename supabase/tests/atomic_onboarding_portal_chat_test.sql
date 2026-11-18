begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, apticket, pg_catalog;
set local plpgsql.check_asserts = on;
select no_plan();

do $test$
begin
  assert has_function_privilege('service_role','apticket.provision_tenant(text,text,text,text)','EXECUTE');
  assert not has_function_privilege('anon','apticket.provision_tenant(text,text,text,text)','EXECUTE');
  assert not has_function_privilege('authenticated','apticket.provision_tenant(text,text,text,text)','EXECUTE');
  assert has_function_privilege('service_role','apticket.create_portal_chat(uuid,uuid,text,text,uuid)','EXECUTE');
  assert not has_function_privilege('anon','apticket.create_portal_chat(uuid,uuid,text,text,uuid)','EXECUTE');
  assert not has_function_privilege('authenticated','apticket.create_portal_chat(uuid,uuid,text,text,uuid)','EXECUTE');
  assert not has_function_privilege('service_role','apticket.seed_default_pause_reasons(uuid)','EXECUTE');
  assert not has_function_privilege('anon','apticket.seed_default_pause_reasons(uuid)','EXECUTE');
  assert not has_function_privilege('authenticated','apticket.seed_default_pause_reasons(uuid)','EXECUTE');
  assert not has_function_privilege('service_role','apticket.seed_pause_reasons_for_new_tenant()','EXECUTE');
  assert not has_function_privilege('anon','apticket.seed_pause_reasons_for_new_tenant()','EXECUTE');
  assert not has_function_privilege('authenticated','apticket.seed_pause_reasons_for_new_tenant()','EXECUTE');
end $test$;
select pass('atomic RPCs are restricted to the server role');

create temp table atomic_fixture (tenant_id uuid, profile_id uuid);
grant all on atomic_fixture to service_role;
set local role service_role;
do $test$
declare p record;
begin
  select * into strict p from apticket.provision_tenant('Atomic fixture company','Atomic fixture owner','ATOMIC-owner@example.test','$2b$12$'||repeat('a',53));
  assert p.email='atomic-owner@example.test' and p.session_version=0;
  assert exists(select 1 from apticket.user_roles ur join apticket.roles r on r.id=ur.role_id and r.tenant_id=ur.tenant_id
    where ur.user_id=p.id and ur.tenant_id=p.tenant_id and r.name='Admin' and r.is_system);
  assert (select count(*) from apticket.profiles where tenant_id=p.tenant_id)=1;
  assert (select count(*) from apticket.pause_reasons where tenant_id=p.tenant_id)=5;
  begin
    perform apticket.seed_default_pause_reasons(p.tenant_id);
    raise exception 'expected direct pause seed rejection';
  exception when insufficient_privilege then null; end;
  insert into atomic_fixture values(p.tenant_id,p.id);
  begin
    perform apticket.provision_tenant('Atomic duplicate company','Other owner',' atomic-OWNER@example.test ','$2b$12$'||repeat('a',53));
    raise exception 'expected duplicate rejection';
  exception when unique_violation then null; end;
  assert not exists(select 1 from apticket.tenants where name='Atomic duplicate company');
end $test$;
reset role;
select pass('signup creates a complete owner and rejects normalized duplicate email without orphans');

create function pg_temp.atomic_fail_write() returns trigger language plpgsql as $$
begin
  if tg_table_name='profiles' then
    if new.name='Atomic profile failure' then raise exception 'fixture profile failure'; end if;
  elsif tg_table_name='user_roles' then
    if exists(select 1 from apticket.profiles where id=new.user_id and name='Atomic role failure') then raise exception 'fixture role failure'; end if;
  end if;
  return new;
end $$;
create trigger atomic_fail_profile before insert on apticket.profiles for each row execute function pg_temp.atomic_fail_write();
create trigger atomic_fail_role before insert on apticket.user_roles for each row execute function pg_temp.atomic_fail_write();
set local role service_role;
do $test$
declare roles_before bigint;
begin
  select count(*) into roles_before from apticket.roles;
  begin
    perform apticket.provision_tenant('Atomic profile failure company','Atomic profile failure','atomic-profile-fail@example.test','$2b$12$'||repeat('a',53));
    raise exception 'expected profile failure';
  exception when sqlstate 'P0001' then assert sqlerrm='fixture profile failure'; end;
  begin
    perform apticket.provision_tenant('Atomic role failure company','Atomic role failure','atomic-role-fail@example.test','$2b$12$'||repeat('a',53));
    raise exception 'expected role failure';
  exception when sqlstate 'P0001' then assert sqlerrm='fixture role failure'; end;
  assert not exists(select 1 from apticket.tenants where name in ('Atomic profile failure company','Atomic role failure company'));
  assert not exists(select 1 from apticket.profiles where email in ('atomic-profile-fail@example.test','atomic-role-fail@example.test'));
  assert (select count(*) from apticket.roles)=roles_before;
  begin
    perform apticket.provision_tenant('Invalid hash company','Owner','hash@example.test','plaintext');
    raise exception 'expected hash rejection';
  exception when invalid_parameter_value then null; end;
  assert not exists(select 1 from apticket.tenants where name='Invalid hash company');
end $test$;
reset role;
select pass('profile and role failures roll back the tenant, defaults and profile');

-- Synthetic IDs below are isolated by this test transaction.
insert into apticket.companies(id,tenant_id,name)
select 'af300000-0000-4000-8000-000000000040',tenant_id,'Atomic client' from atomic_fixture;
insert into apticket.contacts(id,tenant_id,company_id,name,email,is_active,can_open_tickets)
select 'af200000-0000-4000-8000-000000000040',tenant_id,'af300000-0000-4000-8000-000000000040','Atomic contact','atomic-contact@example.test',true,true from atomic_fixture;

create function pg_temp.atomic_fail_message() returns trigger language plpgsql as $$
begin if new.content='Atomic message failure' then raise exception 'fixture message failure'; end if; return new; end $$;
create trigger atomic_fail_message before insert on apticket.messages for each row execute function pg_temp.atomic_fail_message();
set local role service_role;
do $test$
declare tid uuid; chat record; tickets_before bigint;
begin
  select tenant_id into tid from atomic_fixture;
  select count(*) into tickets_before from apticket.tickets where tenant_id=tid;
  begin
    perform apticket.create_portal_chat(tid,'af200000-0000-4000-8000-000000000040','Atomic message failure',null,null);
    raise exception 'expected message failure';
  exception when sqlstate 'P0001' then assert sqlerrm='fixture message failure'; end;
  assert (select count(*) from apticket.tickets where tenant_id=tid)=tickets_before;
  select * into strict chat from apticket.create_portal_chat(tid,'af200000-0000-4000-8000-000000000040','  Atomic initial message  ',null,null);
  assert exists(select 1 from apticket.tickets where id=chat.ticket_id and tenant_id=tid and channel='chat' and subject='Chat: Atomic initial message');
  assert exists(select 1 from apticket.messages where ticket_id=chat.ticket_id and tenant_id=tid and author_contact_id='af200000-0000-4000-8000-000000000040'
    and content='Atomic initial message' and not is_internal and author_type='contact');
  assert (select count(*) from apticket.tickets where tenant_id=tid)=tickets_before+1;
  begin
    perform apticket.create_portal_chat(tid,'af200000-0000-4000-8000-000000000040',' ',null,null);
    raise exception 'expected whitespace rejection';
  exception when invalid_parameter_value then null; end;
  begin
    perform apticket.create_portal_chat(gen_random_uuid(),'af200000-0000-4000-8000-000000000040','Foreign tenant',null,null);
    raise exception 'expected foreign tenant rejection';
  exception when insufficient_privilege then null; end;
  begin
    perform apticket.create_portal_chat(tid,'af200000-0000-4000-8000-000000000040','Invalid contract',null,gen_random_uuid());
    raise exception 'expected contract rejection';
  exception when invalid_parameter_value then null; end;
  assert (select count(*) from apticket.tickets where tenant_id=tid)=tickets_before+1;
end $test$;
reset role;
select pass('chat and initial message commit together; invalid tenant, text and contract do not create tickets');

-- Bypass provisioning-only contract triggers for synthetic fixture setup.
-- All RPC calls below run with the normal trigger and permission settings.
set local session_replication_role = replica;
insert into apticket.operating_companies(id,tenant_id,legal_name)
select 'af600000-0000-4000-8000-000000000040',tenant_id,'Atomic operator' from atomic_fixture;
insert into apticket.companies(id,tenant_id,name)
select 'af300000-0000-4000-8000-000000000041',tenant_id,'Other atomic client' from atomic_fixture;
insert into apticket.contracts(id,tenant_id,company_id,starts_at,ends_at,numero_contrato,operating_company_id,includes_remote,billing_type)
select 'af500000-0000-4000-8000-000000000040',tenant_id,'af300000-0000-4000-8000-000000000040','2025-01-01','2099-12-31','000001/2026','af600000-0000-4000-8000-000000000040',true,'service_invoice' from atomic_fixture;
insert into apticket.contracts(id,tenant_id,company_id,starts_at,ends_at,numero_contrato,operating_company_id,includes_remote,billing_type)
select 'af500000-0000-4000-8000-000000000041',tenant_id,'af300000-0000-4000-8000-000000000041','2025-01-01','2099-12-31','000002/2026','af600000-0000-4000-8000-000000000040',true,'service_invoice' from atomic_fixture;
insert into apticket.contracts(id,tenant_id,company_id,starts_at,ends_at,numero_contrato,operating_company_id,includes_remote,billing_type,deleted_at)
select 'af500000-0000-4000-8000-000000000042',tenant_id,'af300000-0000-4000-8000-000000000040','2026-01-01','2099-12-31','000003/2026','af600000-0000-4000-8000-000000000040',true,'service_invoice',now() from atomic_fixture;
insert into apticket.contracts(id,tenant_id,company_id,starts_at,ends_at,numero_contrato,operating_company_id,includes_remote,billing_type)
select 'af500000-0000-4000-8000-000000000043',tenant_id,'af300000-0000-4000-8000-000000000040','2025-06-01','2099-12-31','000004/2026','af600000-0000-4000-8000-000000000040',true,'service_invoice' from atomic_fixture;
insert into apticket.contracts(id,tenant_id,company_id,starts_at,ends_at,numero_contrato,operating_company_id,includes_remote,billing_type)
select 'af500000-0000-4000-8000-000000000044',tenant_id,'af300000-0000-4000-8000-000000000040','2090-01-01','2099-12-31','000005/2026','af600000-0000-4000-8000-000000000040',true,'service_invoice' from atomic_fixture;
set local session_replication_role = origin;
set local role service_role;
do $test$
declare tid uuid; chat record;
begin
  select tenant_id into tid from atomic_fixture;
  select * into strict chat from apticket.create_portal_chat(tid,'af200000-0000-4000-8000-000000000040','Explicit contract','Explicit subject','af500000-0000-4000-8000-000000000040');
  assert exists(select 1 from apticket.tickets where id=chat.ticket_id and contract_id='af500000-0000-4000-8000-000000000040' and subject='Explicit subject');
  select * into strict chat from apticket.create_portal_chat(tid,'af200000-0000-4000-8000-000000000040','Automatic contract',null,null);
  assert exists(select 1 from apticket.tickets where id=chat.ticket_id and contract_id='af500000-0000-4000-8000-000000000043');
  begin
    perform apticket.create_portal_chat(tid,'af200000-0000-4000-8000-000000000040','Other client',null,'af500000-0000-4000-8000-000000000041');
    raise exception 'expected foreign client rejection';
  exception when invalid_parameter_value then null; end;
  begin
    perform apticket.create_portal_chat(tid,'af200000-0000-4000-8000-000000000040','Deleted contract',null,'af500000-0000-4000-8000-000000000042');
    raise exception 'expected deleted contract rejection';
  exception when invalid_parameter_value then null; end;
  begin
    perform apticket.create_portal_chat(tid,'af200000-0000-4000-8000-000000000040','Future contract',null,'af500000-0000-4000-8000-000000000044');
    raise exception 'expected future contract rejection';
  exception when invalid_parameter_value then null; end;
end $test$;
reset role;
select pass('explicit and automatic contracts stay within the client; soft-deleted contracts are excluded');

update apticket.contacts set is_active=false where id='af200000-0000-4000-8000-000000000040';
set local role service_role;
do $test$
begin
  begin
    perform apticket.create_portal_chat((select tenant_id from atomic_fixture),'af200000-0000-4000-8000-000000000040','Inactive',null,null);
    raise exception 'expected inactive rejection';
  exception when insufficient_privilege then null; end;
end $test$;
reset role;
update apticket.contacts set is_active=true,can_open_tickets=false where id='af200000-0000-4000-8000-000000000040';
set local role service_role;
do $test$
begin
  begin
    perform apticket.create_portal_chat((select tenant_id from atomic_fixture),'af200000-0000-4000-8000-000000000040','Blocked',null,null);
    raise exception 'expected blocked rejection';
  exception when insufficient_privilege then null; end;
end $test$;
reset role;
select pass('chat rechecks inactive and blocked contacts inside the transaction');
select * from finish();
rollback;
