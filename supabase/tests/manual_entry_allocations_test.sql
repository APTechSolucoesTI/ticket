begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select no_plan();
insert into apticket.tenants(id,name,slug) values
 ('ae100000-0000-0000-0000-000000000001','Rateios A','allocation-tests-a'),
 ('ae100000-0000-0000-0000-000000000002','Rateios B','allocation-tests-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('ae200000-0000-0000-0000-000000000001','ae100000-0000-0000-0000-000000000001','Rateios Admin','allocations-admin@example.test',true),
 ('ae200000-0000-0000-0000-000000000002','ae100000-0000-0000-0000-000000000002','Rateios B','allocations-other@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r on r.tenant_id=p.tenant_id and r.name='Admin'
where p.id::text like 'ae200000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name) values
 ('ae300000-0000-0000-0000-000000000001','ae100000-0000-0000-0000-000000000001','Rateios operadora A'),
 ('ae300000-0000-0000-0000-000000000002','ae100000-0000-0000-0000-000000000002','Rateios operadora B'),
 ('ae300000-0000-0000-0000-000000000003','ae100000-0000-0000-0000-000000000001','Rateios outra operadora');
insert into apticket.financial_categories(id,tenant_id,operating_company_id,code,name,direction) values
 ('ae400000-0000-0000-0000-000000000001','ae100000-0000-0000-0000-000000000001','ae300000-0000-0000-0000-000000000001','10.01.0001','Categoria A','both'),
 ('ae400000-0000-0000-0000-000000000002','ae100000-0000-0000-0000-000000000001','ae300000-0000-0000-0000-000000000001','10.01.0002','Categoria B','both'),
 ('ae400000-0000-0000-0000-000000000003','ae100000-0000-0000-0000-000000000002','ae300000-0000-0000-0000-000000000002','10.01.0001','Categoria outra tenant','both'),
 ('ae400000-0000-0000-0000-000000000004','ae100000-0000-0000-0000-000000000001','ae300000-0000-0000-0000-000000000003','10.01.0001','Categoria outra operadora','both');
insert into apticket.financial_cost_centers(id,tenant_id,operating_company_id,code,name) values
 ('ae500000-0000-0000-0000-000000000001','ae100000-0000-0000-0000-000000000001','ae300000-0000-0000-0000-000000000001','20.01.0001','Centro A'),
 ('ae500000-0000-0000-0000-000000000002','ae100000-0000-0000-0000-000000000001','ae300000-0000-0000-0000-000000000001','20.01.0002','Centro B');
insert into apticket.companies(id,tenant_id,name) values
 ('ae600000-0000-0000-0000-000000000001','ae100000-0000-0000-0000-000000000001','Rateios cliente');
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"ae200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
insert into apticket.contracts(id,tenant_id,operating_company_id,company_id,status,starts_at,ends_at,billing_model,monthly_value,dia_vencimento,financial_category_id,cost_center_id) values
 ('ae700000-0000-0000-0000-000000000001','ae100000-0000-0000-0000-000000000001','ae300000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000001','active','2026-01-01','2026-12-31','hours_package',100.01,10,'ae400000-0000-0000-0000-000000000001','ae500000-0000-0000-0000-000000000001');
insert into apticket.suppliers(id, tenant_id, legal_name, category) values
 ('ae800000-0000-0000-0000-000000000001', apticket_appsec.fixture_actor('ae100000-0000-0000-0000-000000000001'), 'Rateios fornecedor', 'software_licensing');
insert into apticket.supplier_contracts(id,tenant_id,operating_company_id,supplier_id,description,billing_unit,billing_interval_months,base_amount,unit_price,due_day,starts_at,ends_at,financial_category_id,cost_center_id) values
 ('ae900000-0000-0000-0000-000000000001','ae100000-0000-0000-0000-000000000001','ae300000-0000-0000-0000-000000000001','ae800000-0000-0000-0000-000000000001','Rateios fornecedor fixo','fixed',1,100.01,0,10,'2026-01-01','2026-12-31','ae400000-0000-0000-0000-000000000001','ae500000-0000-0000-0000-000000000001');

insert into apticket.financial_categories(id,tenant_id,operating_company_id,code,name,direction,is_active,classification_type,is_global) values
 ('ae400000-0000-0000-0000-000000000005','ae100000-0000-0000-0000-000000000001','ae300000-0000-0000-0000-000000000001','11.01.0001','Inativa','both',false,'analytic',false),
 ('ae400000-0000-0000-0000-000000000006','ae100000-0000-0000-0000-000000000001','ae300000-0000-0000-0000-000000000001','12.01.0001','Sintética','both',true,'synthetic',false),
 ('ae400000-0000-0000-0000-000000000007','ae100000-0000-0000-0000-000000000001','ae300000-0000-0000-0000-000000000003','13.01.0001','Global','both',true,'analytic',true),
 ('ae400000-0000-0000-0000-000000000008','ae100000-0000-0000-0000-000000000001','ae300000-0000-0000-0000-000000000001','14.01.0001','Somente saídas','outflow',true,'analytic',false);
insert into apticket.financial_cost_centers(id,tenant_id,operating_company_id,code,name,is_active,classification_type,is_global) values
 ('ae500000-0000-0000-0000-000000000003','ae100000-0000-0000-0000-000000000002','ae300000-0000-0000-0000-000000000002','20.01.0001','Outra tenant',true,'analytic',false),
 ('ae500000-0000-0000-0000-000000000004','ae100000-0000-0000-0000-000000000001','ae300000-0000-0000-0000-000000000003','21.01.0001','Outra empresa',true,'analytic',false),
 ('ae500000-0000-0000-0000-000000000005','ae100000-0000-0000-0000-000000000001','ae300000-0000-0000-0000-000000000001','22.01.0001','Inativo',false,'analytic',false),
 ('ae500000-0000-0000-0000-000000000006','ae100000-0000-0000-0000-000000000001','ae300000-0000-0000-0000-000000000001','23.01.0001','Sintético',true,'synthetic',false),
 ('ae500000-0000-0000-0000-000000000007','ae100000-0000-0000-0000-000000000001','ae300000-0000-0000-0000-000000000003','24.01.0001','Global',true,'analytic',true);
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('ae200000-0000-0000-0000-000000000003','ae100000-0000-0000-0000-000000000001','Sem permissão','no-allocation-access@example.test',true);

create function pg_temp.categories(p_a numeric default 70,p_b numeric default 30) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('item_id','ae400000-0000-0000-0000-000000000001','percentage',p_a),jsonb_build_object('item_id','ae400000-0000-0000-0000-000000000002','percentage',p_b));
$$;
create function pg_temp.centers(p_a numeric default 60,p_b numeric default 40) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('item_id','ae500000-0000-0000-0000-000000000001','percentage',p_a),jsonb_build_object('item_id','ae500000-0000-0000-0000-000000000002','percentage',p_b));
$$;
create function pg_temp.one_item(p_dimension text,p_number integer) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('item_id',(case p_dimension when 'category' then 'ae400000' else 'ae500000' end)||'-0000-0000-0000-'||lpad(p_number::text,12,'0'),'percentage',100));
$$;
create function pg_temp.create_manual(p_kind text,p_document text,p_categories jsonb,p_centers jsonb,
 p_installments jsonb default '[{"number":1,"due_date":"2026-10-30","amount":100.01}]') returns uuid language plpgsql as $$
declare v_document_type uuid;
begin
 select id into v_document_type from apticket.financial_document_types where code='OUT';
 if p_kind='receivable' then
   return apticket.create_manual_receivable_allocated('ae300000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000001',v_document_type,p_document,'Lançamento com rateios','2026-10-01',100.01,p_installments,p_categories,p_centers,case when jsonb_array_length(p_installments)>1 then 30 else 0 end,null);
 else
   return apticket.create_manual_supplier_payable_allocated('ae300000-0000-0000-0000-000000000001','ae800000-0000-0000-0000-000000000001',v_document_type,p_document,'Lançamento com rateios','2026-10-01',100.01,p_installments,p_categories,p_centers,case when jsonb_array_length(p_installments)>1 then 30 else 0 end,null);
 end if;
end $$;
create function pg_temp.reclassify(p_categories jsonb,p_centers jsonb,p_kind text default 'manual_receivable') returns uuid language sql as $$
 select apticket.classify_financial_entry_allocated(p_kind,current_setting(case p_kind when 'supplier_payable' then 'test.payable_id' else 'test.receivable_id' end)::uuid,p_categories,p_centers,'Rateios revisados');
$$;

set local role authenticated;
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"ae200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
select lives_ok($$select pg_temp.create_manual('receivable','REC-MULTI',pg_temp.categories(),pg_temp.centers())$$,'cria recebível com rateios');
select lives_ok($$select pg_temp.create_manual('payable','PAG-MULTI',pg_temp.categories(),pg_temp.centers())$$,'cria conta a pagar com rateios');
select set_config('test.receivable_id',(select id::text from apticket.contas_receber where document_base_number='REC-MULTI'),true);
select set_config('test.payable_id',(select id::text from apticket.supplier_payables where document_base_number='PAG-MULTI'),true);
select is((select count(*) from apticket.financial_entry_classifications where replaced_at is null),2::bigint,'uma classificação por lançamento');
select ok((select bool_and(jsonb_array_length(category_allocations)=2 and jsonb_array_length(cost_center_allocations)=2) from apticket.financial_entry_classifications),'grava as duas categorias e os dois centros');
select ok((select bool_and((category_allocations->0->>'percentage')::numeric=70 and (cost_center_allocations->0->>'percentage')::numeric=60) from apticket.financial_entry_classifications),'preserva percentuais independentes');
select ok((select bool_and(financial_category_id='ae400000-0000-0000-0000-000000000001' and cost_center_id='ae500000-0000-0000-0000-000000000001') from apticket.financial_entry_classifications),'espelha maior percentual nas colunas legadas');
select is((select sum(planned_amount) from apticket.cash_flow_allocation_entries where source_id=current_setting('test.receivable_id')::uuid),100.01::numeric,'recebível distribuído sem perda de centavos');
select is((select sum(planned_amount) from apticket.cash_flow_allocation_entries where source_id=current_setting('test.payable_id')::uuid),100.01::numeric,'conta a pagar distribuída sem perda de centavos');
select is((select sum(planned_amount) from apticket.cash_flow_allocation_entries where source_id=current_setting('test.receivable_id')::uuid and financial_category_id='ae400000-0000-0000-0000-000000000001'),70.01::numeric,'categoria recebe percentual e resíduo correto');
select is((select sum(planned_amount) from apticket.cash_flow_allocation_entries where source_id=current_setting('test.receivable_id')::uuid and cost_center_id='ae500000-0000-0000-0000-000000000001'),60.01::numeric,'centro recebe percentual e resíduo correto');
select lives_ok($$select pg_temp.create_manual('receivable','REC-PARCELADO',pg_temp.categories(),pg_temp.centers(),'[{"number":1,"due_date":"2026-10-30","amount":50.01},{"number":2,"due_date":"2026-11-30","amount":50}]')$$,'cria recebível parcelado');
select lives_ok($$select pg_temp.create_manual('payable','PAG-PARCELADO',pg_temp.categories(),pg_temp.centers(),'[{"number":1,"due_date":"2026-10-30","amount":50.01},{"number":2,"due_date":"2026-11-30","amount":50}]')$$,'cria conta a pagar parcelada');
select is((select count(*) from apticket.financial_entry_classifications where replaced_at is null),6::bigint,'cada parcela tem sua classificação');
select ok((select bool_and(jsonb_array_length(category_allocations)=2 and jsonb_array_length(cost_center_allocations)=2) from apticket.financial_entry_classifications),'replica ambos os rateios em todas as parcelas');
select lives_ok($$select pg_temp.reclassify(pg_temp.categories(40,60),pg_temp.centers(25,75))$$,'edita rateios de recebível sem colapsar para um item');
select lives_ok($$select pg_temp.reclassify(pg_temp.categories(30,70),pg_temp.centers(10,90),'supplier_payable')$$,'edita rateios de conta a pagar');
select is((select count(*) from apticket.financial_entry_classifications where replaced_at is not null),2::bigint,'preserva versões anteriores');
select ok((select bool_and(jsonb_array_length(category_allocations)=2 and jsonb_array_length(cost_center_allocations)=2) from apticket.financial_entry_classifications where replaced_at is not null),'histórico mantém arrays e percentuais originais');
select is((select count(*) from apticket.financial_entry_classifications where replaced_at is null),6::bigint,'uma versão atual por parcela');
select is((select financial_category_id from apticket.financial_entry_classifications where source_id=current_setting('test.receivable_id')::uuid and replaced_at is null),'ae400000-0000-0000-0000-000000000002'::uuid,'atualiza espelho principal ao inverter percentuais');
select is((select sum(planned_amount) from apticket.cash_flow_allocation_entries where source_id=current_setting('test.receivable_id')::uuid and financial_category_id='ae400000-0000-0000-0000-000000000002'),60.01::numeric,'relatório usa distribuição revisada');

select throws_ok($$select pg_temp.reclassify(pg_temp.categories(60,30),pg_temp.centers())$$,'23514',null,'rejeita total de categorias menor que 100');
select throws_ok($$select pg_temp.reclassify(pg_temp.categories(),pg_temp.centers(80,40))$$,'23514',null,'rejeita total de centros maior que 100');
select throws_ok($$select pg_temp.reclassify(pg_temp.categories(0,100),pg_temp.centers())$$,'23514',null,'rejeita percentual zero');
select throws_ok($$select pg_temp.reclassify(pg_temp.categories(-1,101),pg_temp.centers())$$,'23514',null,'rejeita percentual negativo');
select throws_ok($$select pg_temp.reclassify(pg_temp.categories(33.333,66.667),pg_temp.centers())$$,'23514',null,'rejeita terceira casa decimal');
select throws_ok($$select pg_temp.reclassify('[]',pg_temp.centers())$$,'23514',null,'exige ao menos uma categoria');
select throws_ok($$select pg_temp.reclassify(pg_temp.categories(),null)$$,'23514',null,'exige ao menos um centro');
select throws_ok($$select pg_temp.reclassify(pg_temp.one_item('category',1)||pg_temp.one_item('category',1),pg_temp.centers())$$,'23514',null,'rejeita categoria duplicada');
select throws_ok($$select pg_temp.reclassify(pg_temp.categories(),pg_temp.one_item('center',1)||pg_temp.one_item('center',1))$$,'23514',null,'rejeita centro duplicado');
select throws_ok($$select pg_temp.reclassify(pg_temp.one_item('category',3),pg_temp.centers())$$,'23514',null,'rejeita categoria de outra tenant');
select throws_ok($$select pg_temp.reclassify(pg_temp.one_item('category',4),pg_temp.centers())$$,'23514',null,'rejeita categoria de outra empresa');
select throws_ok($$select pg_temp.reclassify(pg_temp.one_item('category',5),pg_temp.centers())$$,'23514',null,'rejeita categoria inativa');
select throws_ok($$select pg_temp.reclassify(pg_temp.one_item('category',6),pg_temp.centers())$$,'23514',null,'rejeita categoria sintética');
select throws_ok($$select pg_temp.reclassify(pg_temp.one_item('category',8),pg_temp.centers())$$,'23514',null,'rejeita natureza incompatível com recebível');
select throws_ok($$select pg_temp.reclassify(pg_temp.categories(),pg_temp.one_item('center',3))$$,'23514',null,'rejeita centro de outra tenant');
select throws_ok($$select pg_temp.reclassify(pg_temp.categories(),pg_temp.one_item('center',4))$$,'23514',null,'rejeita centro de outra empresa');
select throws_ok($$select pg_temp.reclassify(pg_temp.categories(),pg_temp.one_item('center',5))$$,'23514',null,'rejeita centro inativo');
select throws_ok($$select pg_temp.reclassify(pg_temp.categories(),pg_temp.one_item('center',6))$$,'23514',null,'rejeita centro sintético');
select is((select count(*) from apticket.financial_entry_classifications where source_id=current_setting('test.receivable_id')::uuid),2::bigint,'falhas não geram histórico nem substituem classificação atual');
select lives_ok($$select pg_temp.reclassify(pg_temp.one_item('category',7),pg_temp.one_item('center',7))$$,'aceita itens globais da mesma tenant');
select throws_ok($$select pg_temp.create_manual('receivable','REC-INVALIDO',pg_temp.categories(50,40),pg_temp.centers())$$,'23514',null,'reverte criação inteira com rateio inválido');
select is((select count(*) from apticket.contas_receber where document_base_number='REC-INVALIDO'),0::bigint,'não deixa conta a receber parcial');
select throws_ok($$select pg_temp.create_manual('payable','PAG-INVALIDO',pg_temp.categories(),pg_temp.centers(10,80))$$,'23514',null,'reverte conta a pagar com rateio inválido');
select is((select count(*) from apticket.supplier_payables where document_base_number='PAG-INVALIDO'),0::bigint,'não deixa conta a pagar parcial');
select is((select count(*) from apticket.financial_manual_entry_groups where document_number in ('REC-INVALIDO','PAG-INVALIDO')),0::bigint,'não deixa grupos parciais');
select lives_ok($$select apticket.clear_financial_entry_classification('manual_receivable',current_setting('test.receivable_id')::uuid)$$,'mantém remoção explícita da classificação');
select is((select count(*) from apticket.financial_entry_classifications where source_id=current_setting('test.receivable_id')::uuid and replaced_at is null),0::bigint,'remoção mantém somente histórico');
select lives_ok($$select pg_temp.reclassify(pg_temp.categories(),pg_temp.centers())$$,'permite classificar novamente');

select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"ae200000-0000-0000-0000-000000000003","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
select throws_ok($$select pg_temp.reclassify(pg_temp.categories(),pg_temp.centers())$$,'42501',null,'usuário sem permissão não reclassifica');
select throws_ok($$select pg_temp.create_manual('payable','PAG-SEM-ACESSO',pg_temp.categories(),pg_temp.centers())$$,'42501',null,'usuário sem permissão não cria');
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"ae200000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
select throws_ok($$select pg_temp.reclassify(pg_temp.categories(),pg_temp.centers())$$,'P0002',null,'outro tenant não reclassifica');
reset role;
select ok(exists(select 1 from apticket.financial_audit_log where entity_table='financial_entry_classifications' and after_data->'category_allocations' is not null),'auditoria inclui rateios');
set local role anon;
select throws_ok($$select apticket.classify_financial_entry_allocated('manual_receivable',gen_random_uuid(),'[]','[]')$$,'42501',null,'anônimo não classifica');
select throws_ok($$select apticket.create_manual_receivable_allocated(null,null,null,'DOC','Descrição',current_date,10,'[]','[]','[]')$$,'42501',null,'anônimo não cria recebível');
select throws_ok($$select apticket.create_manual_supplier_payable_allocated(null,null,null,'DOC','Descrição',current_date,10,'[]','[]','[]')$$,'42501',null,'anônimo não cria conta a pagar');
reset role;
select * from finish();
rollback;
