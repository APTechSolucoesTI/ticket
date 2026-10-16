begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select no_plan();
insert into apticket.tenants(id,name,slug) values
 ('af100000-0000-0000-0000-000000000001','Rateios A','fixed-tests-a'),
 ('af100000-0000-0000-0000-000000000002','Rateios B','fixed-tests-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('af200000-0000-0000-0000-000000000001','af100000-0000-0000-0000-000000000001','Rateios Admin','allocations-admin@example.test',true),
 ('af200000-0000-0000-0000-000000000002','af100000-0000-0000-0000-000000000002','Rateios B','allocations-other@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r on r.tenant_id=p.tenant_id and r.name='Admin'
where p.id::text like 'af200000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name) values
 ('af300000-0000-0000-0000-000000000001','af100000-0000-0000-0000-000000000001','Rateios operadora A'),
 ('af300000-0000-0000-0000-000000000002','af100000-0000-0000-0000-000000000002','Rateios operadora B'),
 ('af300000-0000-0000-0000-000000000003','af100000-0000-0000-0000-000000000001','Rateios outra operadora');
insert into apticket.financial_categories(id,tenant_id,operating_company_id,code,name,direction) values
 ('af400000-0000-0000-0000-000000000001','af100000-0000-0000-0000-000000000001','af300000-0000-0000-0000-000000000001','10.01.0001','Categoria A','both'),
 ('af400000-0000-0000-0000-000000000002','af100000-0000-0000-0000-000000000001','af300000-0000-0000-0000-000000000001','10.01.0002','Categoria B','both'),
 ('af400000-0000-0000-0000-000000000003','af100000-0000-0000-0000-000000000002','af300000-0000-0000-0000-000000000002','10.01.0001','Categoria outra tenant','both'),
 ('af400000-0000-0000-0000-000000000004','af100000-0000-0000-0000-000000000001','af300000-0000-0000-0000-000000000003','10.01.0001','Categoria outra operadora','both');
insert into apticket.financial_cost_centers(id,tenant_id,operating_company_id,code,name) values
 ('af500000-0000-0000-0000-000000000001','af100000-0000-0000-0000-000000000001','af300000-0000-0000-0000-000000000001','20.01.0001','Centro A'),
 ('af500000-0000-0000-0000-000000000002','af100000-0000-0000-0000-000000000001','af300000-0000-0000-0000-000000000001','20.01.0002','Centro B');
insert into apticket.companies(id,tenant_id,name) values
 ('af600000-0000-0000-0000-000000000001','af100000-0000-0000-0000-000000000001','Rateios cliente');
select set_config('request.jwt.claims','{"sub":"af200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
insert into apticket.contracts(id,tenant_id,operating_company_id,company_id,status,starts_at,ends_at,billing_model,monthly_value,dia_vencimento,financial_category_id,cost_center_id) values
 ('af700000-0000-0000-0000-000000000001','af100000-0000-0000-0000-000000000001','af300000-0000-0000-0000-000000000001','af600000-0000-0000-0000-000000000001','active','2026-01-01','2026-12-31','hours_package',100.01,10,'af400000-0000-0000-0000-000000000001','af500000-0000-0000-0000-000000000001');
insert into apticket.suppliers(id,tenant_id,legal_name,category) values
 ('af800000-0000-0000-0000-000000000001','af100000-0000-0000-0000-000000000001','Rateios fornecedor','software_licensing');
insert into apticket.supplier_contracts(id,tenant_id,operating_company_id,supplier_id,description,billing_unit,billing_interval_months,base_amount,unit_price,due_day,starts_at,ends_at,financial_category_id,cost_center_id) values
 ('af900000-0000-0000-0000-000000000001','af100000-0000-0000-0000-000000000001','af300000-0000-0000-0000-000000000001','af800000-0000-0000-0000-000000000001','Rateios fornecedor fixo','fixed',1,100.01,0,10,'2026-01-01','2026-12-31','af400000-0000-0000-0000-000000000001','af500000-0000-0000-0000-000000000001');

create function pg_temp.create_payable(p_attachments jsonb default '[]') returns uuid language sql as $$
select apticket.create_manual_supplier_payable_with_attachments(
'af300000-0000-0000-0000-000000000001','af800000-0000-0000-0000-000000000001',
(select id from apticket.financial_document_types where code='OUT'),'ATTACHMENTS-TEST','Anexos parcelados','2028-01-01',100,
'[{"number":1,"due_date":"2028-01-10","amount":50},{"number":2,"due_date":"2028-02-10","amount":50}]',
'[{"item_id":"af400000-0000-0000-0000-000000000001","percentage":100}]',
'[{"item_id":"af500000-0000-0000-0000-000000000001","percentage":100}]',p_attachments,30,null);
$$;
create function pg_temp.attachment(p_path text default 'af100000-0000-0000-0000-000000000001/af300000-0000-0000-0000-000000000001/af200000-0000-0000-0000-000000000001/test/boleto.pdf', p_parcel integer default 2, p_type text default 'boleto', p_description text default null) returns jsonb language sql as $$
select jsonb_build_object('storage_path',p_path,'file_name','boleto.pdf','file_size',3,'content_type','application/pdf','attachment_type',p_type,'type_description',p_description,'installment_number',p_parcel);
$$;
insert into storage.objects(bucket_id,name,metadata) values('supplier-payable-attachments',
'af100000-0000-0000-0000-000000000001/af300000-0000-0000-0000-000000000001/af200000-0000-0000-0000-000000000001/test/boleto.pdf','{"size":3,"mimetype":"application/pdf"}');
set local role authenticated;
select throws_ok($$select pg_temp.create_payable(null)$$,'22023',null,'rejeita lista nula');
select throws_ok($$select pg_temp.create_payable('{}')$$,'22023',null,'rejeita lista inválida');
select throws_ok($$select pg_temp.create_payable(jsonb_build_array(pg_temp.attachment(p_parcel=>3)))$$,'42501',null,'rejeita parcela inexistente');
select throws_ok($$select pg_temp.create_payable(jsonb_build_array(pg_temp.attachment(p_type=>'outros')))$$,'23514',null,'outros exige descrição');
select throws_ok($$select pg_temp.create_payable(jsonb_build_array(pg_temp.attachment(p_type=>'inválido')))$$,'23514',null,'rejeita tipo inválido');
select throws_ok($$select pg_temp.create_payable(jsonb_build_array(pg_temp.attachment(p_path=>'missing')))$$,'42501',null,'rejeita arquivo de outra empresa/usuário');
select throws_ok($$select pg_temp.create_payable(jsonb_build_array(pg_temp.attachment()||'{"file_size":4}'))$$,'23514',null,'valida tamanho com objeto enviado');
select throws_ok($$select pg_temp.create_payable(jsonb_build_array(pg_temp.attachment(p_path=>'af100000-0000-0000-0000-000000000001/af300000-0000-0000-0000-000000000001/af200000-0000-0000-0000-000000000001/test/missing.pdf')))$$,'23514',null,'arquivo precisa existir');
select throws_ok($$select pg_temp.create_payable((select jsonb_agg(pg_temp.attachment()) from generate_series(1,21)))$$,'22023',null,'limita a 20 anexos');
select is((select count(*) from apticket.supplier_payables),0::bigint,'falhas revertem todos os títulos');
select is((select count(*) from apticket.supplier_payable_attachments),0::bigint,'falhas revertem metadados');
select lives_ok($$select set_config('test.group',pg_temp.create_payable(jsonb_build_array(pg_temp.attachment()))::text,true)$$,'cria parcelas com anexo');
select is((select count(*) from apticket.supplier_payables),2::bigint,'cria todas as parcelas');
select is((select p.installment_number::integer from apticket.supplier_payable_attachments a join apticket.supplier_payables p on p.id=a.supplier_payable_id),2,'anexo fica apenas na parcela escolhida');
select is((select attachment_type from apticket.supplier_payable_attachments),'boleto','preserva tipo');
select ok(not apticket_finance_private.can_manage_payable_upload(pg_temp.attachment()->>'storage_path'),'arquivo vinculado não pode ser apagado como rascunho');
select ok(exists(select 1 from storage.objects where name=pg_temp.attachment()->>'storage_path'),'arquivo vinculado pode ser lido');
select throws_ok($$delete from storage.objects where bucket_id='supplier-payable-attachments' and name=pg_temp.attachment()->>'storage_path'$$,'42501',null,'storage bloqueia exclusão direta de arquivo');
select ok(exists(select 1 from storage.objects where name=pg_temp.attachment()->>'storage_path'),'arquivo continua preservado');
select throws_ok($$insert into apticket.supplier_payable_attachments select * from apticket.supplier_payable_attachments$$,'42501',null,'cliente não pode inserir metadados diretamente');
select throws_ok($$select apticket_finance_private.link_payable_attachments(current_setting('test.group')::uuid,'[]')$$,'42501',null,'linker privado não é executável pelo cliente');
reset role;
insert into storage.objects(bucket_id,name,metadata) values('supplier-payable-attachments',
'af100000-0000-0000-0000-000000000001/af300000-0000-0000-0000-000000000001/af200000-0000-0000-0000-000000000001/test/fixed.xml','{"size":3,"mimetype":"application/xml"}');
set local role authenticated;
select set_config('test.fixed',apticket.save_fixed_payable(null,null,jsonb_build_object(
'operating_company_id','af300000-0000-0000-0000-000000000001','supplier_id','af800000-0000-0000-0000-000000000001',
'document_type_id',(select id from apticket.financial_document_types where code='OUT'),'description','Fixa com anexos',
'total_amount',50,'start_month','2028-01-01','end_month','2028-01-01','due_day',10,
'category_allocations','[{"item_id":"af400000-0000-0000-0000-000000000001","percentage":100}]'::jsonb,
'cost_center_allocations','[{"item_id":"af500000-0000-0000-0000-000000000001","percentage":100}]'::jsonb),true)::text,true);
create function pg_temp.confirm(p_type text default 'outros',p_description text default null) returns uuid language sql as $$
select apticket.confirmar_previsao_conta_fixa(o.id,o.revision,to_jsonb(o)||jsonb_build_object('document_number','FIXED-ATTACHMENTS',
'attachments',jsonb_build_array(pg_temp.attachment('af100000-0000-0000-0000-000000000001/af300000-0000-0000-0000-000000000001/af200000-0000-0000-0000-000000000001/test/fixed.xml',1,p_type,p_description))))
from apticket.fixed_payable_occurrences o where fixed_payable_id=current_setting('test.fixed')::uuid;
$$;
select throws_ok($$select pg_temp.confirm()$$,'23514',null,'confirmação fixa valida descrição de outros');
select is((select status from apticket.fixed_payable_occurrences where fixed_payable_id=current_setting('test.fixed')::uuid),'forecast','falha preserva previsão');
select is((select count(*) from apticket.supplier_payables),2::bigint,'confirmação falha não cria título');
select lives_ok($$select pg_temp.confirm('outros','Contrato de serviço')$$,'confirma fixa com anexo tipado');
select is((select count(*) from apticket.supplier_payable_attachments),2::bigint,'anexa arquivo da conta fixa');
select is((select type_description from apticket.supplier_payable_attachments where attachment_type='outros'),'Contrato de serviço','preserva descrição do tipo');
select ok(exists(select 1 from apticket.supplier_payable_attachments a join apticket.fixed_payable_occurrences o on o.confirmed_payable_id=a.supplier_payable_id),'anexo vinculado ao título confirmado');
select set_config('request.jwt.claims','{"sub":"af200000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from apticket.supplier_payable_attachments),0::bigint,'RLS isola metadados por tenant');
select is((select count(*) from storage.objects where bucket_id='supplier-payable-attachments'),0::bigint,'RLS isola arquivos por tenant');
select finish();
rollback;
