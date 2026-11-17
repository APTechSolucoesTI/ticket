begin;
set local lock_timeout = '5s';

-- Chat without an equipment must keep its validated contract. The legacy
-- resolver overwrote every explicit contract and also considered deleted rows.
-- Other channels/equipment retain their existing classification path.
create or replace function apticket.classificar_ticket_antes_insert()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare v_result record; v_contract record;
begin
  if new.channel='chat' and new.equipment_id is null then
    select c.id,c.sla_policy_id into v_contract from apticket.contracts c
      where c.tenant_id=new.tenant_id and c.company_id=new.company_id
        and c.status='active' and c.deleted_at is null
        and (coalesce(new.created_at,now()) at time zone 'America/Sao_Paulo')::date between c.starts_at and c.ends_at
        and (c.includes_remote or c.includes_lab or c.includes_onsite)
        and (new.contract_id is null or c.id=new.contract_id)
      order by c.starts_at desc,c.created_at desc,c.id limit 1 for share;
    if new.contract_id is not null and not found then
      raise invalid_parameter_value using message='portal_contract_invalid';
    end if;
    if found then
      new.tipo_atendimento := 'contratual'; new.motivo_avulso := null;
      new.contract_id := v_contract.id; new.sla_policy_id := v_contract.sla_policy_id;
    else
      new.tipo_atendimento := 'avulso'; new.motivo_avulso := 'cliente_sem_contrato';
      new.contract_id := null; new.sla_policy_id := null;
    end if;
  else
    select * into v_result from apticket.resolver_atendimento_ticket(
      new.tenant_id,new.company_id,new.equipment_id,coalesce(new.created_at,now()));
    new.tipo_atendimento := v_result.tipo; new.motivo_avulso := v_result.motivo;
    new.contract_id := v_result.contrato_id; new.sla_policy_id := v_result.sla_id;
  end if;
  if new.tipo_atendimento='avulso' then
    new.sla_first_response_due_at := null; new.sla_resolution_due_at := null; new.sla_breached := false;
  end if;
  return new;
end $$;

-- Called only after server-side validation and rate limiting. A single RPC
-- includes tenant defaults, the credential-bearing profile and its Admin role.
create function apticket.provision_tenant(
  _company_name text, _name text, _email text, _password_hash text
)
returns table(id uuid, tenant_id uuid, name text, email text, session_version bigint)
language plpgsql security invoker set search_path = pg_catalog as $$
declare
  v_company text := btrim(coalesce(_company_name,''));
  v_name text := btrim(coalesce(_name,''));
  v_email text := lower(btrim(coalesce(_email,'')));
  v_tenant uuid; v_profile uuid := gen_random_uuid(); v_role uuid; v_slug text;
begin
  if char_length(v_company) not between 1 and 200
     or char_length(v_name) not between 1 and 120
     or char_length(v_email) > 255
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
     or coalesce(_password_hash,'') !~ '^[$]2[aby][$]1[2-5][$][./A-Za-z0-9]{53}$' then
    raise invalid_parameter_value using message='tenant_provisioning_invalid';
  end if;
  v_slug := coalesce(nullif(btrim(regexp_replace(lower(v_company),'[^a-z0-9]+','-','g'),'-'),''),'empresa')
    || '-' || replace(gen_random_uuid()::text,'-','');
  insert into apticket.tenants(name,slug) values(v_company,v_slug) returning tenants.id into v_tenant;
  insert into apticket.profiles(id,tenant_id,name,email,password_hash,is_active)
    values(v_profile,v_tenant,v_name,v_email,_password_hash,true);
  select r.id into v_role from apticket.roles r
    where r.tenant_id=v_tenant and r.name='Admin' and r.is_system;
  if not found then
    raise exception using errcode='55000',message='tenant_admin_seed_missing';
  end if;
  insert into apticket.user_roles(user_id,tenant_id,role_id) values(v_profile,v_tenant,v_role);
  return query select p.id,p.tenant_id,p.name,p.email,p.session_version
    from apticket.profiles p where p.id=v_profile;
end $$;

-- The portal HMAC identity is supplied by the trusted web handler, never by
-- request JSON. Authorizing rows remain locked through ticket/message commit.
create function apticket.create_portal_chat(
  _tenant_id uuid, _contact_id uuid, _message text,
  _subject text default null, _contract_id uuid default null
)
returns table(ticket_id uuid, number bigint)
language plpgsql security invoker set search_path = pg_catalog as $$
declare
  v_contact apticket.contacts%rowtype;
  v_contract uuid; v_sla uuid; v_ticket uuid; v_number bigint; v_actual_contract uuid;
  v_message text := btrim(coalesce(_message,''));
  v_subject text := nullif(btrim(coalesce(_subject,'')),'');
begin
  if char_length(v_message) not between 1 and 4000
     or (v_subject is not null and char_length(v_subject) not between 3 and 200) then
    raise invalid_parameter_value using message='portal_chat_invalid';
  end if;
  select c.* into v_contact from apticket.contacts c
    join apticket.companies co on co.id=c.company_id and co.tenant_id=c.tenant_id
    where c.id=_contact_id and c.tenant_id=_tenant_id
    for share of c,co;
  if not found or not v_contact.is_active or not v_contact.can_open_tickets then
    raise insufficient_privilege using message='portal_contact_not_allowed';
  end if;
  select ct.id,ct.sla_policy_id into v_contract,v_sla from apticket.contracts ct
    where ct.tenant_id=_tenant_id and ct.company_id=v_contact.company_id
      and ct.status='active' and ct.deleted_at is null
      and (now() at time zone 'America/Sao_Paulo')::date between ct.starts_at and ct.ends_at
      and (ct.includes_remote or ct.includes_lab or ct.includes_onsite)
      and (_contract_id is null or ct.id=_contract_id)
    order by ct.starts_at desc,ct.created_at desc,ct.id
    limit 1 for share;
  if _contract_id is not null and not found then
    raise invalid_parameter_value using message='portal_contract_invalid';
  end if;
  v_subject := coalesce(v_subject,'Chat: ' || left(regexp_replace(v_message,'\s+',' ','g'),80));
  insert into apticket.tickets(tenant_id,subject,status,priority,channel,contact_id,company_id,contract_id,sla_policy_id,pending_type)
    values(_tenant_id,v_subject,'new','medium','chat',v_contact.id,v_contact.company_id,v_contract,v_sla,'awaiting_tech')
    returning tickets.id,tickets.number,tickets.contract_id into v_ticket,v_number,v_actual_contract;
  if v_actual_contract is distinct from v_contract then
    raise serialization_failure using message='portal_contract_changed';
  end if;
  insert into apticket.messages(tenant_id,ticket_id,author_contact_id,author_type,channel,is_internal,content,attachments)
    values(_tenant_id,v_ticket,v_contact.id,'contact','chat',false,v_message,'[]'::jsonb);
  return query select v_ticket,v_number;
end $$;

alter function apticket.provision_tenant(text,text,text,text) owner to postgres;
alter function apticket.create_portal_chat(uuid,uuid,text,text,uuid) owner to postgres;
revoke all on function apticket.provision_tenant(text,text,text,text) from public,anon,authenticated;
revoke all on function apticket.create_portal_chat(uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function apticket.provision_tenant(text,text,text,text) to service_role;
grant execute on function apticket.create_portal_chat(uuid,uuid,text,text,uuid) to service_role;
notify pgrst,'reload schema';
commit;
