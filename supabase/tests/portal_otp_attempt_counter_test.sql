-- Scoped counter contract; contact authentication is covered by portal HTTP tests.
begin;
set local search_path=extensions,public,apticket,pg_catalog;
select plan(18);
insert into apticket.tenants(id,name,slug) values
 ('af100000-0000-4000-8000-000000000031','OTP fixture','appsec-otp-counter');
insert into apticket.contacts(id,tenant_id,name,email) values
 ('af500000-0000-4000-8000-000000000031','af100000-0000-4000-8000-000000000031','OTP fixture','otp@example.test');
insert into apticket.portal_otp_codes(id,tenant_id,contact_id,email,code_hash,expires_at,consumed_at) values
 ('af400000-0000-4000-8000-000000000031','af100000-0000-4000-8000-000000000031','af500000-0000-4000-8000-000000000031','otp@example.test',repeat('a',64),now()+interval '1 hour',null),
 ('af400000-0000-4000-8000-000000000032','af100000-0000-4000-8000-000000000031','af500000-0000-4000-8000-000000000031','otp@example.test',repeat('b',64),now()-interval '1 hour',null),
 ('af400000-0000-4000-8000-000000000033','af100000-0000-4000-8000-000000000031','af500000-0000-4000-8000-000000000031','otp@example.test',repeat('c',64),now()+interval '1 hour',now());
select ok(not has_function_privilege('anon','apticket.increment_portal_otp_attempt(uuid)','EXECUTE'),'anonymous cannot invoke the counter');
select ok(not has_function_privilege('authenticated','apticket.increment_portal_otp_attempt(uuid)','EXECUTE'),'browser sessions cannot invoke the counter');
select ok(has_function_privilege('service_role','apticket.increment_portal_otp_attempt(uuid)','EXECUTE'),'trusted verifier can invoke the counter');
select ok(not (select prosecdef from pg_proc where oid='apticket.increment_portal_otp_attempt(uuid)'::regprocedure),'counter uses invoker privileges');
select is((select proowner::regrole::text from pg_proc where oid='apticket.increment_portal_otp_attempt(uuid)'::regprocedure),'postgres','runtime function has the expected owner');
set local role service_role;
select is(apticket.increment_portal_otp_attempt('af400000-0000-4000-8000-000000000031'),1,'first wrong guess increments once');
select is(apticket.increment_portal_otp_attempt('af400000-0000-4000-8000-000000000031'),2,'second wrong guess increments once');
select is(apticket.increment_portal_otp_attempt('af400000-0000-4000-8000-000000000031'),3,'third wrong guess increments once');
select is(apticket.increment_portal_otp_attempt('af400000-0000-4000-8000-000000000031'),4,'fourth wrong guess increments once');
select is(apticket.increment_portal_otp_attempt('af400000-0000-4000-8000-000000000031'),5,'fifth wrong guess reaches the existing limit');
select is(apticket.increment_portal_otp_attempt('af400000-0000-4000-8000-000000000031'),null::integer,'exhausted counter cannot increment again');
select is((select attempts from apticket.portal_otp_codes where id='af400000-0000-4000-8000-000000000031'),5,'counter stays capped');
select is(apticket.increment_portal_otp_attempt('af400000-0000-4000-8000-000000000032'),null::integer,'expired code is not changed');
select is(apticket.increment_portal_otp_attempt('af400000-0000-4000-8000-000000000033'),null::integer,'consumed code is not changed');
select is(apticket.increment_portal_otp_attempt('af400000-0000-4000-8000-000000000034'),null::integer,'missing code is ignored');
select is((select attempts from apticket.portal_otp_codes where id='af400000-0000-4000-8000-000000000032'),0,'expired counter remains zero');
select is((select attempts from apticket.portal_otp_codes where id='af400000-0000-4000-8000-000000000033'),0,'consumed counter remains zero');
with claimed as (update apticket.portal_otp_codes set consumed_at=clock_timestamp()
 where id='af400000-0000-4000-8000-000000000031' and attempts<5 and consumed_at is null
 returning id)
select is((select count(*) from claimed),0::bigint,'correct-code consumption cannot bypass exhausted attempts');
reset role;
select * from finish();
rollback;
