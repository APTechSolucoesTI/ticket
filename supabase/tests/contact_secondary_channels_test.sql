-- Run after the migration; fixtures and audit records are rolled back.
begin;
do $$
declare
  tenant uuid;
  company uuid;
  contact uuid;
  other_contact uuid;
  actor uuid;
  other_company uuid;
begin
  select tenant_id,id into tenant,company from apticket.companies limit 1;
  if tenant is null then raise exception 'Test requires one client'; end if;
  insert into apticket.contacts(tenant_id,company_id,name,email,secondary_emails)
    values(tenant,company,'Contact channels test','  PRIMARY@contact-test.invalid  ',array[' SECONDARY@contact-test.invalid ']) returning id into contact;
  if not exists(select 1 from apticket.contacts where id=contact and email='primary@contact-test.invalid' and secondary_emails=array['secondary@contact-test.invalid'] and phone is null) then
    raise exception 'Email normalization or optional phone failed';
  end if;
  update apticket.contacts set secondary_phones=array['(11) 98888-1010','55 11 97777-2020'] where id=contact;
  if not exists(select 1 from apticket.contacts where id=contact and secondary_phones=array['5511988881010','5511977772020'] and phone is null) then
    raise exception 'Secondary phone normalization failed';
  end if;
  begin
    update apticket.contacts set secondary_emails=array['PRIMARY@contact-test.invalid'] where id=contact;
    raise exception 'Repeated email accepted';
  exception when check_violation then null; end;
  begin
    update apticket.contacts set phone='11988881010' where id=contact;
    raise exception 'Repeated phone accepted';
  exception when check_violation then null; end;
  begin
    update apticket.contacts set secondary_emails=array['invalid'] where id=contact;
    raise exception 'Invalid secondary email accepted';
  exception when check_violation then null; end;
  begin
    update apticket.contacts set secondary_phones=array['123'] where id=contact;
    raise exception 'Invalid secondary phone accepted';
  exception when check_violation then null; end;
  begin
    update apticket.contacts set email=null where id=contact;
    raise exception 'Missing primary email accepted';
  exception when check_violation then null; end;
  begin
    insert into apticket.contacts(tenant_id,company_id,name,email) values(tenant,company,'Duplicate test','secondary@contact-test.invalid');
    raise exception 'Another contact reused a secondary email';
  exception when unique_violation then null; end;
  begin
    insert into apticket.contacts(tenant_id,company_id,name,email,phone) values(tenant,company,'Duplicate test','other@contact-test.invalid','11977772020');
    raise exception 'Another contact reused a secondary phone';
  exception when unique_violation then null; end;
  update apticket.contacts set secondary_emails='{}', secondary_phones='{}' where id=contact;
  insert into apticket.contacts(tenant_id,company_id,name,email,phone) values(tenant,company,'Freed channels test','secondary@contact-test.invalid','11977772020') returning id into other_contact;
  delete from apticket.contacts where id=other_contact;
  if exists(select 1 from apticket_contact_private.identifiers where contact_id=other_contact) then raise exception 'Identifier cleanup failed'; end if;
  if has_schema_privilege('authenticated','apticket_contact_private','usage') or has_table_privilege('authenticated','apticket_contact_private.identifiers','select')
    or has_function_privilege('authenticated','apticket_contact_private.sync_identifiers()','execute') then
    raise exception 'Private identifiers exposed';
  end if;
  if not exists(select 1 from pg_class where oid='apticket.contacts'::regclass and relrowsecurity) then raise exception 'Contact RLS disabled'; end if;
  execute 'set local role postgres';
  select id into actor from apticket.profiles where tenant_id=tenant and is_active
    and apticket.has_permission(id,'contatos','edit') and apticket.has_permission(id,'contatos','create') and apticket.has_permission(id,'contatos','view') limit 1;
  if actor is null then raise exception 'Test requires an active contact administrator'; end if;
  execute 'set local role supabase_admin';
  select id into other_company from apticket.companies where tenant_id=tenant and id<>company limit 1;
  if other_company is null then
    insert into apticket.companies(tenant_id,name) values(tenant,'Contact client selection test') returning id into other_company;
  end if;
  perform set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  update apticket.contacts set secondary_emails=array['authenticated@contact-test.invalid'] where id=contact;
  perform apticket.set_contact_companies(contact,array[other_company,company,other_company]);
  if not exists(select 1 from apticket.contacts where id=contact and company_id=other_company and secondary_emails=array['authenticated@contact-test.invalid']) then
    raise exception 'Authenticated save or chosen primary client failed';
  end if;
  if (select count(*) from apticket.contact_companies where contact_id=contact)<>2 then raise exception 'Client deduplication failed'; end if;
  begin
    perform apticket.set_contact_companies(contact,array[gen_random_uuid()]);
    raise exception 'Invalid client accepted';
  exception when foreign_key_violation then null; end;
  perform set_config('request.jwt.claims',json_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
  if exists(select 1 from apticket.contacts where id=contact) then raise exception 'RLS exposed another tenant contact'; end if;
  begin
    perform apticket.set_contact_companies(contact,array[company]);
    raise exception 'Unauthorized client change accepted';
  exception when insufficient_privilege then null; end;
  execute 'set local role supabase_admin';
  raise notice 'PASS secondary channels: normalization, optional phones, validation, uniqueness, removal, private access and RLS';
end $$;
rollback;
