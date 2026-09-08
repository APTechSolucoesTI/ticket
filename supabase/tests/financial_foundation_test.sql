begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, apticket, pg_catalog;
select no_plan();

insert into apticket.tenants(id, name, slug) values
 ('f1000000-0000-0000-0000-000000000001', 'Finance test A', 'finance-foundation-test-a'),
 ('f1000000-0000-0000-0000-000000000002', 'Finance test B', 'finance-foundation-test-b');
insert into apticket.profiles(id, tenant_id, name, email, is_active)
select ('f2000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
 case when n = 3 then 'f1000000-0000-0000-0000-000000000002'::uuid else 'f1000000-0000-0000-0000-000000000001'::uuid end,
 'Finance test ' || n, 'finance-foundation-' || n || '@example.test', true from generate_series(1,4) n;
insert into apticket.user_roles(user_id, tenant_id, role_id)
select p.id, p.tenant_id, r.id from apticket.profiles p join apticket.roles r on r.tenant_id=p.tenant_id and r.name='Admin'
where p.id::text like 'f2000000-%';
insert into apticket.companies(id, tenant_id, name)
select ('f3000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
 case when n=3 then 'f1000000-0000-0000-0000-000000000002'::uuid else 'f1000000-0000-0000-0000-000000000001'::uuid end,
 'Client ' || n from generate_series(1,3) n;
insert into apticket.operating_companies(id, tenant_id, legal_name)
select ('f4000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
 case when n=3 then 'f1000000-0000-0000-0000-000000000002'::uuid else 'f1000000-0000-0000-0000-000000000001'::uuid end,
 'Operating company ' || n from generate_series(1,3) n;
insert into apticket.financial_access(tenant_id, user_id, operating_company_id, can_write) values
 ('f1000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000001', true),
 ('f1000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000002', null, true),
 ('f1000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000003', 'f4000000-0000-0000-0000-000000000003', false);
insert into apticket.contracts(id, tenant_id, company_id, status, starts_at, ends_at, billing_model, monthly_value)
select ('f5000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
 case when n=3 then 'f1000000-0000-0000-0000-000000000002'::uuid else 'f1000000-0000-0000-0000-000000000001'::uuid end,
 ('f3000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
 'active', '2026-01-01', '2027-12-31', 'hours_package', 100 from generate_series(1,3) n;
insert into apticket.contract_financial_terms(contract_id, tenant_id, operating_company_id, adjustment_base_date)
select c.id, c.tenant_id, ('f4000000-0000-0000-0000-' || right(c.id::text,12))::uuid, '2027-01-01'
from apticket.contracts c where c.id::text like 'f5000000-%';
insert into apticket.contract_value_versions(id, tenant_id, operating_company_id, contract_id, effective_from, base_amount, reason)
select ('f6000000-0000-0000-0000-' || right(f.contract_id::text,12))::uuid,
 f.tenant_id, f.operating_company_id, f.contract_id, '2026-01-01', 100, 'Initial'
from apticket.contract_financial_terms f where f.contract_id::text like 'f5000000-%';
insert into apticket.consumption_snapshots(tenant_id, operating_company_id, contract_id, value_version_id,
 cycle_start, cycle_end, metric, measured_quantity, included_quantity, unit_price, source_type, source_items)
select tenant_id, operating_company_id, contract_id, id, '2026-01-01', '2026-02-01',
 'devices', 12, 2, 5.125, 'equipment_snapshot', '[{"reference":"device-1","quantity":12}]'
from apticket.contract_value_versions where contract_id::text like 'f5000000-%';

select is((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='apticket' and c.relname in ('operating_companies','financial_access','contract_financial_terms',
 'contract_value_versions','consumption_snapshots','financial_audit_log') and c.relrowsecurity), 6::bigint, 'RLS nas seis tabelas');
select is((select billable_quantity from apticket.consumption_snapshots where contract_id='f5000000-0000-0000-0000-000000000001'), 10.000000::numeric, 'franquia deduzida com precisão exata');
select throws_ok($$update apticket.contract_value_versions set base_amount=999$$, '23514', null, 'mesmo postgres não reescreve valores');
select throws_ok($$update apticket.consumption_snapshots set measured_quantity=999$$, '23514', null, 'snapshot não muda com origem');
select throws_ok($$delete from apticket.contract_financial_terms$$, '23514', null, 'sem delete físico');
select throws_ok($$truncate apticket.financial_audit_log$$, '23514', null, 'sem truncate da auditoria');
select throws_ok($$update apticket.financial_audit_log set source='fake'$$, '23514', null, 'auditoria imutável');
select throws_ok($$insert into apticket.financial_access(tenant_id,user_id,operating_company_id)
 values('f1000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000003')$$,
 '23503', null, 'FK rejeita empresa de outro tenant mesmo no backend');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f2000000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}', true);
select ok(apticket.has_financial_scope('f1000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001',true), 'acesso permitido à própria empresa');
select is((select count(*) from apticket.operating_companies), 1::bigint, 'empresa irmã invisível');
select is((select count(*) from apticket.contract_financial_terms), 1::bigint, 'termos isolados');
select is((select count(*) from apticket.contract_value_versions), 1::bigint, 'histórico isolado');
select is((select count(*) from apticket.consumption_snapshots), 1::bigint, 'consumo isolado');
select is((select count(*) from apticket.financial_access), 1::bigint, 'concessões somente do usuário');
select is((select count(*) from apticket.financial_audit_log where operating_company_id is distinct from 'f4000000-0000-0000-0000-000000000001'), 0::bigint, 'auditoria respeita empresa');
select throws_ok($$insert into apticket.financial_access(tenant_id,user_id,can_write)
 values('f1000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',true)$$, '42501', null, 'não pode auto-conceder acesso de grupo');
select throws_ok($$insert into apticket.contract_value_versions(tenant_id,operating_company_id,contract_id,effective_from,base_amount,reason)
 values('f1000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000002','f5000000-0000-0000-0000-000000000002','2026-02-01',110,'Unauthorized')$$,
 '23514', null, 'empresa irmã não pode receber nova versão');
select lives_ok($$insert into apticket.contract_value_versions(tenant_id,operating_company_id,contract_id,effective_from,base_amount,adjustment_index,applied_percentage,reason)
 values('f1000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001','2026-02-01',110,'IPCA',10,'Reajuste manual')$$, 'reajuste válido gera nova versão');
select is((select base_amount from apticket.contract_value_versions where id='f6000000-0000-0000-0000-000000000001'), 100::numeric, 'valor anterior preservado');
select is((select effective_until from apticket.contract_value_periods where id='f6000000-0000-0000-0000-000000000001'), '2026-02-01'::date, 'vigência final derivada sem sobrescrita');
select is((select created_by from apticket.contract_value_versions where effective_from='2026-02-01'), 'f2000000-0000-0000-0000-000000000001'::uuid, 'autor obtido da sessão');
select throws_ok($$insert into apticket.contract_value_versions(tenant_id,operating_company_id,contract_id,effective_from,base_amount,adjustment_index,applied_percentage,reason)
 values('f1000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001','2026-03-01',999,'IPCA',10,'Inconsistente')$$,
 '23514', null, 'percentual e valor devem corresponder');
select throws_ok($$insert into apticket.contract_value_versions(tenant_id,operating_company_id,contract_id,effective_from,base_amount,reason)
 values('f1000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001','2026-01-15',105,'Retroativo')$$,
 '23514', null, 'versão retroativa rejeitada');
select throws_ok($$update apticket.contract_financial_terms set operating_company_id='f4000000-0000-0000-0000-000000000002'$$,
 '23514', null, 'vínculo da empresa não pode ser transferido');
select throws_ok($$delete from apticket.consumption_snapshots$$, '42501', null, 'cliente sem privilégio delete');
select throws_ok($$insert into apticket.financial_audit_log(tenant_id) values('f1000000-0000-0000-0000-000000000001')$$, '42501', null, 'cliente não pode falsificar auditoria');

select set_config('request.jwt.claims', '{"sub":"f2000000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}', true);
select is((select count(*) from apticket.operating_companies), 2::bigint, 'grupo explicitamente autorizado vê duas empresas');
select is((select count(*) from apticket.consumption_snapshots), 2::bigint, 'grupo não atravessa tenant');
select lives_ok($$update apticket.operating_companies set legal_name='Empresa atualizada' where id='f4000000-0000-0000-0000-000000000002'$$, 'grupo pode editar empresa permitida');

select set_config('request.jwt.claims', '{"sub":"f2000000-0000-0000-0000-000000000003","role":"authenticated","app":"apticket"}', true);
select is((select count(*) from apticket.operating_companies), 1::bigint, 'segundo tenant vê somente própria empresa');
select is((select count(*) from apticket.contract_value_periods), 1::bigint, 'view não bypassa RLS');
select ok(not apticket.has_financial_scope('f1000000-0000-0000-0000-000000000002','f4000000-0000-0000-0000-000000000003',true), 'concessão leitura não permite escrita mesmo para Admin');
with updated as (update apticket.operating_companies set legal_name='Não permitido' returning id)
select is((select count(*) from updated), 0::bigint, 'update sem escopo de escrita não afeta registros');

select set_config('request.jwt.claims', '{"sub":"f2000000-0000-0000-0000-000000000004","role":"authenticated","app":"apticket"}', true);
select is((select count(*) from apticket.operating_companies), 0::bigint, 'Admin sem concessão explícita não vê empresa');
select is((select count(*) from apticket.financial_audit_log), 0::bigint, 'Admin sem concessão não vê auditoria');
select set_config('request.jwt.claims', '{"sub":"f2000000-0000-0000-0000-000000000099","role":"authenticated","app":"apticket"}', true);
select is((select count(*) from apticket.operating_companies), 0::bigint, 'identidade sem perfil no APTicket rejeitada');

set local role anon;
select throws_ok($$select * from apticket.operating_companies$$, '42501', null, 'anônimo sem acesso');
reset role;
select set_config('request.jwt.claims','{}',true);
select throws_ok($$insert into apticket.consumption_snapshots(tenant_id,operating_company_id,contract_id,value_version_id,
 cycle_start,cycle_end,metric,measured_quantity,unit_price,source_type,source_items)
 values('f1000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',
 'f6000000-0000-0000-0000-000000000001','2026-01-01','2026-02-01','devices',12,5,'test','[]')$$, '23514', null, 'reprocessamento não duplica consumo');
select throws_ok($$insert into apticket.consumption_snapshots(tenant_id,operating_company_id,contract_id,value_version_id,
 cycle_start,cycle_end,metric,measured_quantity,unit_price,source_type,source_items)
 values('f1000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001',
 'f6000000-0000-0000-0000-000000000001','2026-02-01','2026-03-01','devices',12,5,'test','[]')$$, '23514', null, 'snapshot não usa versão vencida');
select ok(exists(select 1 from apticket.financial_audit_log where entity_table='contract_value_versions'
 and actor_id='f2000000-0000-0000-0000-000000000001' and source='authenticated_request' and database_role='authenticated'), 'auditoria registra autor, origem e papel');
select lives_ok($$update apticket.consumption_snapshots set deleted_at=now() where contract_id='f5000000-0000-0000-0000-000000000003'$$, 'exclusão lógica preserva snapshot');
select is((select measured_quantity from apticket.consumption_snapshots where contract_id='f5000000-0000-0000-0000-000000000003' and deleted_at is not null), 12::numeric, 'conteúdo preservado após exclusão lógica');
update apticket.profiles set is_active=false where id='f2000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f2000000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}', true);
select is((select count(*) from apticket.consumption_snapshots), 0::bigint, 'usuário inativo perde acesso imediatamente');
reset role;
select set_config('request.jwt.claims','{}',true);
update apticket.financial_access set deleted_at=now() where user_id='f2000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f2000000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}', true);
select is((select count(*) from apticket.operating_companies), 0::bigint, 'revogação do acesso de grupo tem efeito imediato');
reset role;
select set_config('request.jwt.claims','{}',true);
select * from finish();
rollback;
