begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, apticket, pg_catalog;
select plan(17);

select is(
  apticket.calcular_vencimento_medicao(
    '2028-02-01',
    'fixo',
    30::smallint,
    '11000000-0000-0000-0000-000000000001'
  ),
  '2028-02-29'::date,
  'vencimento fixo limita o dia ao último dia de fevereiro'
);

select is(
  apticket.calcular_vencimento_medicao(
    '2026-09-01',
    'util',
    5::smallint,
    '11000000-0000-0000-0000-000000000001'
  ),
  '2026-09-08'::date,
  'quinto dia útil ignora fim de semana e feriado nacional'
);

select is(
  apticket.calcular_vencimento_medicao(
    '2026-12-01',
    'util',
    30::smallint,
    '11000000-0000-0000-0000-000000000001'
  ),
  '2027-01-13'::date,
  'contagem de dias úteis suporta mudança de ano'
);

insert into apticket.tenants (id, name, slug)
values ('11000000-0000-0000-0000-000000000001', 'Tenant teste medição', 'tenant-teste-medicao');

insert into apticket.companies (id, tenant_id, name)
values (
  '21000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'Cliente snapshot'
);

insert into apticket.contracts (
  id, tenant_id, company_id, status, starts_at, ends_at, billing_model,
  tipo_medicao, tipo_vencimento, dia_vencimento, emite_nf, emite_boleto,
  equipment_tiers, monthly_value
) values (
  '31000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  'active', '2026-01-01', '2027-12-31', 'per_equipment',
  'mensal', 'fixo', 15, true, true,
  '[{"min":1,"max":10,"price":50}]', 0
), (
  '31000000-0000-0000-0000-000000000002',
  '11000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  'active', '2026-01-01', '2027-12-31', 'per_service',
  'trimestral', 'util', 5, false, true,
  '[]', 0
), (
  '31000000-0000-0000-0000-000000000003',
  '11000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  'active', '2026-01-01', '2027-12-31', 'hours_package',
  'anual', 'fixo', 30, true, false,
  '[]', 300
);

update apticket.contracts
set service_items = '[{"reference":"SERV-01","description":"Monitoramento","quantity":2,"price":75}]',
    hours_monthly_quota = 20
where id in (
  '31000000-0000-0000-0000-000000000002',
  '31000000-0000-0000-0000-000000000003'
);

insert into apticket.equipments (id, tenant_id, company_id, name, asset_tag, status)
values
  (
    '41000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001',
    'Servidor principal', 'EQ-001', 'active'
  ),
  (
    '41000000-0000-0000-0000-000000000002',
    '11000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001',
    'Estação financeira', 'EQ-002', 'active'
  );

insert into apticket.contract_equipments (tenant_id, contract_id, equipment_id)
values
  (
    '11000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    '41000000-0000-0000-0000-000000000001'
  ),
  (
    '11000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    '41000000-0000-0000-0000-000000000002'
  );

select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  (
    select sum((resultado ->> 'erros')::integer)::integer
    from (
      values
        (apticket.gerar_medicoes_contrato('31000000-0000-0000-0000-000000000001', '2026-09-01', true)),
        (apticket.gerar_medicoes_contrato('31000000-0000-0000-0000-000000000002', '2026-09-01', true)),
        (apticket.gerar_medicoes_contrato('31000000-0000-0000-0000-000000000003', '2026-09-01', true))
    ) as execucoes(resultado)
  ),
  0,
  'motor gera medições de teste sem erros'
);

select is(
  (select count(*)::integer from apticket.medicoes_contrato where tenant_id = '11000000-0000-0000-0000-000000000001'),
  3,
  'gera uma medição para cada modelo de cobrança'
);

select is(
  (
    select count(distinct report_token)::integer
    from apticket.medicoes_contrato
    where tenant_id = '11000000-0000-0000-0000-000000000001'
  ),
  3,
  'cada medição recebe um token público exclusivo para o boletim'
);

select ok(
  exists (
    select 1
    from apticket.medicoes_contrato as measurement
    cross join lateral jsonb_array_elements(
      apticket.get_contract_measurement_report_by_token(measurement.report_token) -> 'items'
    ) as report_item
    where measurement.contrato_id = '31000000-0000-0000-0000-000000000001'
      and report_item ->> 'description' = 'Servidor principal - EQ-001'
  ),
  'boletim público retorna o snapshot dos itens medidos'
);

select is(
  (select count(*)::integer from apticket.medicao_itens where tenant_id = '11000000-0000-0000-0000-000000000001'),
  4,
  'grava itens detalhados dos três modelos'
);

select is(
  (select valor_total from apticket.medicoes_contrato where contrato_id = '31000000-0000-0000-0000-000000000001'),
  100.00::numeric,
  'calcula contrato por equipamento pela faixa e quantidade ativa'
);

select is(
  (select valor_total from apticket.medicoes_contrato where contrato_id = '31000000-0000-0000-0000-000000000002'),
  150.00::numeric,
  'calcula contrato por serviço pela quantidade e valor unitário'
);

select is(
  (select valor_total from apticket.medicoes_contrato where contrato_id = '31000000-0000-0000-0000-000000000003'),
  300.00::numeric,
  'calcula pacote de horas pelo valor fixo mensal'
);

select is(
  (select array_agg(numero_contrato order by numero_contrato) from apticket.contracts where tenant_id = '11000000-0000-0000-0000-000000000001'),
  array['000001/2026', '000002/2026', '000003/2026'],
  'numeração do contrato é sequencial por tenant'
);

update apticket.equipments
set name = 'Nome alterado depois da medição'
where id = '41000000-0000-0000-0000-000000000001';

select ok(
  exists (
    select 1 from apticket.medicao_itens
    where referencia_id = '41000000-0000-0000-0000-000000000001'
      and descricao like 'Servidor principal%'
  ),
  'descrição do item permanece como snapshot histórico'
);

select lives_ok(
  $$select apticket.gerar_medicoes_contrato(null, '2026-09-01', true)$$,
  'segunda execução da mesma competência é idempotente'
);

select is(
  (select count(*)::integer from apticket.medicoes_contrato where tenant_id = '11000000-0000-0000-0000-000000000001'),
  3,
  'idempotência impede medições duplicadas'
);

select ok(
  not has_table_privilege('authenticated', 'apticket.medicoes_contrato', 'UPDATE'),
  'usuário autenticado não altera diretamente o histórico'
);

select ok(
  not has_table_privilege('authenticated', 'apticket.medicao_itens', 'INSERT'),
  'usuário autenticado não insere itens diretamente'
);

select * from finish();
rollback;
