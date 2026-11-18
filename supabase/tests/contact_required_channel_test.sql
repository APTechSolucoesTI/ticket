-- Self-contained fixtures. Run after the contacts channel migration.
begin;
set local plpgsql.check_asserts = on;

insert into apticket.tenants(id,name,slug) values
 ('cd100000-0000-4000-8000-000000000001','Required channel A','required-channel-a'),
 ('cd100000-0000-4000-8000-000000000002','Required channel B','required-channel-b');
insert into apticket.companies(id,tenant_id,name) values
 ('cd300000-0000-4000-8000-000000000001','cd100000-0000-4000-8000-000000000001','Required channel client');
insert into apticket.profiles(id,tenant_id,name,email) values
 ('cd200000-0000-4000-8000-000000000001','cd100000-0000-4000-8000-000000000001','Required channel actor','channel-actor@example.test'),
 ('cd200000-0000-4000-8000-000000000002','cd100000-0000-4000-8000-000000000002','Required channel outsider','channel-outsider@example.test');
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r on r.tenant_id=p.tenant_id and r.name='Admin'
where p.id in ('cd200000-0000-4000-8000-000000000001','cd200000-0000-4000-8000-000000000002');

do $test$
declare
  tenant constant uuid := 'cd100000-0000-4000-8000-000000000001';
  company constant uuid := 'cd300000-0000-4000-8000-000000000001';
  contact uuid;
  draft uuid;
  channels record;
begin
  insert into apticket.contacts(tenant_id,company_id,name,phone)
    values(tenant,company,'Phone only','(11) 98888-4141') returning id into contact;
  assert exists(select 1 from apticket.contacts where id=contact and email is null and phone='5511988884141'), 'Phone-only registered contact must save';
  assert exists(select 1 from apticket_contact_private.identifiers where contact_id=contact and kind='phone' and value='5511988884141'), 'Phone-only identifier must be indexed';
  insert into apticket.contacts(tenant_id,company_id,name,email)
    values(tenant,company,'Email only','email-only@required-channel.invalid');
  insert into apticket.contacts(tenant_id,company_id,name,email,phone)
    values(tenant,company,'Both channels','both@required-channel.invalid','11922224141');

  update apticket.contacts set email='  FIRST@required-channel.invalid ',phone=null where id=contact;
  assert exists(select 1 from apticket.contacts where id=contact and email='first@required-channel.invalid' and phone is null), 'Email-only update must save';
  assert (select count(*) from apticket_contact_private.identifiers where contact_id=contact)=1, 'Changing channel must remove old identifier';
  update apticket.contacts set phone='11988884141' where id=contact;
  assert (select count(*) from apticket_contact_private.identifiers where contact_id=contact)=2, 'Both primary channels must save';

  for channels in select * from (values
    (null::text,null::text),('', ''),('   ','   '),(E'\t\r\n','()+-')) as cases(email,phone)
  loop
    begin
      insert into apticket.contacts(tenant_id,company_id,name,email,phone)
        values(tenant,company,'Missing registered channel',channels.email,channels.phone);
      raise exception 'Registered contact without a channel accepted';
    exception when check_violation then null; end;
    begin
      insert into apticket.contacts(tenant_id,name,email,phone)
        values(tenant,'Missing draft channel',channels.email,channels.phone);
      raise exception 'Draft contact without a channel accepted';
    exception when check_violation then null; end;
  end loop;
  begin
    update apticket.contacts set email=null,phone=null where id=contact;
    raise exception 'Removing last channel accepted';
  exception when check_violation then null; end;
  assert (select count(*) from apticket_contact_private.identifiers where contact_id=contact)=2, 'Rejected update must preserve identifiers';

  update apticket.contacts set email=null,phone=null,secondary_emails=array[' ONLY@required-channel.invalid '] where id=contact;
  assert exists(select 1 from apticket.contacts where id=contact and email is null and phone is null and secondary_emails=array['only@required-channel.invalid']), 'Secondary-only email must save';
  update apticket.contacts set secondary_emails='{}',secondary_phones=array['(11) 97777-4141'] where id=contact;
  assert exists(select 1 from apticket.contacts where id=contact and secondary_phones=array['5511977774141']), 'Secondary-only phone must save';
  begin
    update apticket.contacts set secondary_phones='{}' where id=contact;
    raise exception 'Removing final secondary channel accepted';
  exception when check_violation then null; end;
  begin
    update apticket.contacts set secondary_phones=array['   '] where id=contact;
    raise exception 'Blank secondary channel accepted';
  exception when check_violation then null; end;
  begin
    update apticket.contacts set secondary_phones='{}',secondary_emails=array['invalid'] where id=contact;
    raise exception 'Invalid secondary channel accepted';
  exception when check_violation then null; end;
  begin
    insert into apticket.contacts(tenant_id,name,phone) values(tenant,'Duplicate secondary phone','11977774141');
    raise exception 'Secondary identifier reused by primary channel';
  exception when unique_violation then null; end;

  insert into apticket.contacts(tenant_id,name,email) values(tenant,'Email draft','draft@required-channel.invalid') returning id into draft;
  update apticket.contacts set email=null,phone='11966664141' where id=draft;
  assert exists(select 1 from apticket.contacts where id=draft and company_id is null and email is null and phone='5511966664141'), 'Draft must support switching to phone';
  raise notice 'PASS required channels: primary, secondary, drafts, normalization, atomic updates and uniqueness';
end $test$;

select set_config('request.jwt.claims',jsonb_build_object('sub',id,'tenant_id',tenant_id,'app','apticket','role','authenticated','session_version',session_version)::text,true)
from apticket.profiles where id='cd200000-0000-4000-8000-000000000001';
set local role authenticated;
do $test$
declare contact uuid;
begin
  insert into apticket.contacts(tenant_id,company_id,name,phone)
    values('cd100000-0000-4000-8000-000000000001','cd300000-0000-4000-8000-000000000001','Authenticated phone','11955554141') returning id into contact;
  update apticket.contacts set email='rls@required-channel.invalid',phone=null where id=contact;
  assert exists(select 1 from apticket.contacts where id=contact and email='rls@required-channel.invalid' and phone is null), 'Authorized phone-only insert and email-only update must work';
  begin
    update apticket.contacts set email=null where id=contact;
    raise exception 'Authenticated removal of last channel accepted';
  exception when check_violation then null; end;
  begin
    insert into apticket.contacts(tenant_id,name,phone)
      values('cd100000-0000-4000-8000-000000000002','Foreign tenant','11944444141');
    raise exception 'Cross-tenant insert accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub','cd200000-0000-4000-8000-000000000002','tenant_id','cd100000-0000-4000-8000-000000000002','app','apticket','role','authenticated','session_version',0)::text,true);
  assert not exists(select 1 from apticket.contacts where id=contact), 'RLS must hide foreign contact';
  update apticket.contacts set phone='11933334141' where id=contact;
  assert not found, 'RLS must reject foreign contact updates';
  raise notice 'PASS required channels RLS: authorized writes, required channel and tenant isolation';
end $test$;

rollback;
