begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, apticket, pg_catalog;
select plan(12);

insert into apticket.tenants(id, name, slug)
values ('a1000000-0000-0000-0000-000000000001', 'Automation test', 'automation-test');
insert into apticket.profiles(id, tenant_id, name, email, is_active)
values (
  'a2000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  'Automation admin', 'automation@example.test', true
);
insert into apticket.user_roles(user_id, tenant_id, role_id)
select 'a2000000-0000-0000-0000-000000000001', tenant_id, id
from apticket.roles
where tenant_id = 'a1000000-0000-0000-0000-000000000001' and lower(name) = 'admin';
insert into apticket.companies(id, tenant_id, name)
values (
  'a3000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  'Automation customer'
);
insert into apticket.outbound_channels(
  id, tenant_id, name, base_url, access_token, active
) values (
  'a4000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  'Financeiro', 'https://uazapi.example.test', 'encrypted-test-token', true
);
insert into apticket.automations(
  id, tenant_id, name, trigger_id, outbound_channel_id, recipient_profile, template_id, active
)
select
  'a5000000-0000-0000-0000-000000000001', tenant_id,
  'Document notification', 'documentos_disponibilizados',
  'a4000000-0000-0000-0000-000000000001', 'administrativo_financeiro', id, true
from apticket.canned_responses
where tenant_id = 'a1000000-0000-0000-0000-000000000001'
  and title = 'Documentos Disponibilizados';

select ok(exists(
  select 1 from apticket.canned_responses
  where tenant_id = 'a1000000-0000-0000-0000-000000000001'
    and title = 'Documentos Disponibilizados'
), 'novo tenant recebe o template de documentos');
select is((select count(*) from apticket.role_permissions role_permission
  join apticket.permissions permission on permission.id = role_permission.permission_id
  join apticket.roles role on role.id = role_permission.role_id
  where role.tenant_id = 'a1000000-0000-0000-0000-000000000001'
    and lower(role.name) = 'admin' and permission.module = 'automacoes'), 4::bigint,
  'Admin de novo tenant recebe as quatro permissoes');
select ok((select access_token = 'encrypted-test-token' from apticket.outbound_channels
  where id = 'a4000000-0000-0000-0000-000000000001'), 'token permanece somente no backend/banco');

insert into apticket.client_documents(
  id, tenant_id, company_id, document_type, competencia, file_name, file_path,
  mime_type, uploaded_by, publication_batch_id
) values
  ('a6000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001',
   'a3000000-0000-0000-0000-000000000001','fatura','2026-09-01','fatura.pdf',
   'automation-test/fatura.pdf','application/pdf','a2000000-0000-0000-0000-000000000001',
   'a7000000-0000-0000-0000-000000000001'),
  ('a6000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001',
   'a3000000-0000-0000-0000-000000000001','boleto','2026-09-01','boleto.pdf',
   'automation-test/boleto.pdf','application/pdf','a2000000-0000-0000-0000-000000000001',
   'a7000000-0000-0000-0000-000000000001');

select is((select count(*) from apticket.automation_dispatch_outbox
  where related_entity_id = 'a7000000-0000-0000-0000-000000000001'), 1::bigint,
  'upload em lote gera um unico dispatch');
select is((select payload->>'document_count' from apticket.automation_dispatch_outbox
  where related_entity_id = 'a7000000-0000-0000-0000-000000000001'), '2',
  'outbox agrega a quantidade de documentos');

set local role service_role;
create temporary table claimed_automations as
select * from apticket.claim_automation_dispatches(10);
select is((select count(*) from claimed_automations), 1::bigint, 'service role reivindica o dispatch');
select is((select status from claimed_automations), 'processing', 'dispatch reivindicado fica em processamento');
select apticket.finish_automation_dispatch((select id from claimed_automations), true, null);
select is((select status from apticket.automation_dispatch_outbox
  where related_entity_id = 'a7000000-0000-0000-0000-000000000001'), 'done',
  'dispatch concluido fica auditavel');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"a2000000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}', true);
select is((select count(*) from apticket.outbound_channels), 1::bigint, 'RLS permite canal do proprio tenant');
select is((select count(*) from apticket.automations), 1::bigint, 'RLS permite automacao do proprio tenant');
select throws_ok($$select apticket.claim_automation_dispatches(10)$$, '42501', null,
  'usuario autenticado nao reivindica o outbox');
set local role anon;
select throws_ok($$select * from apticket.outbound_channels$$, '42501', null,
  'anonimo nao acessa canais de saida');

select * from finish();
rollback;
