begin;
select plan(11);

insert into apticket.tenants (id, name, slug)
values ('10000000-0000-0000-0000-000000000001', 'Tenant teste avulso', 'tenant-teste-avulso');

insert into apticket.profiles (id, tenant_id, name, email)
values (
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  'Administrador teste',
  'admin-avulso@example.com'
);

update apticket.tabela_precos_avulso
set valor_fixo = 100,
    valor_hora_tecnica = 200,
    limite_valor_fixo_minutos = 90
where tenant_id = '10000000-0000-0000-0000-000000000001';

insert into apticket.companies (id, tenant_id, name) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Cliente sem contrato'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Cliente com contrato');

insert into apticket.contracts (
  id, tenant_id, company_id, status, starts_at, ends_at
) values (
  '30000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  'active', current_date - 1, current_date + 30
);

insert into apticket.equipments (id, tenant_id, company_id, name) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Ativo fora do contrato'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Ativo coberto');

insert into apticket.contract_equipments (tenant_id, contract_id, equipment_id)
values (
  '10000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000002'
);

insert into apticket.tickets (id, tenant_id, company_id, equipment_id, subject) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, 'Cliente sem contrato'),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', null, 'Ticket contratual'),
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 'Equipamento fora do contrato'),
  ('50000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'Equipamento coberto');

select is(
  (select tipo_atendimento::text from apticket.tickets where id = '50000000-0000-0000-0000-000000000001'),
  'avulso',
  'cliente sem contrato gera ticket avulso'
);
select is(
  (select motivo_avulso::text from apticket.tickets where id = '50000000-0000-0000-0000-000000000001'),
  'cliente_sem_contrato',
  'motivo do cliente sem contrato fica registrado'
);
select is(
  (select tipo_atendimento::text from apticket.tickets where id = '50000000-0000-0000-0000-000000000002'),
  'contratual',
  'cliente com contrato e sem ativo segue contratual'
);
select is(
  (select tipo_atendimento::text from apticket.tickets where id = '50000000-0000-0000-0000-000000000003'),
  'avulso',
  'equipamento sem vínculo gera ticket avulso'
);
select is(
  (select motivo_avulso::text from apticket.tickets where id = '50000000-0000-0000-0000-000000000003'),
  'equipamento_sem_contrato',
  'motivo do equipamento fora do contrato fica registrado'
);
select is(
  (select tipo_atendimento::text from apticket.tickets where id = '50000000-0000-0000-0000-000000000004'),
  'contratual',
  'equipamento vinculado segue contratual'
);
select is(
  (select count(*)::integer from apticket.tickets_cobranca_avulsa),
  2,
  'somente tickets avulsos geram cobrança'
);
select is(
  (select valor_base from apticket.tickets_cobranca_avulsa where ticket_id = '50000000-0000-0000-0000-000000000001'),
  100.00::numeric,
  'até 90 minutos usa o valor fixo'
);

insert into apticket.time_entries (
  tenant_id, ticket_id, agent_id, minutes, description
) values (
  '10000000-0000-0000-0000-000000000001',
  '50000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  91,
  'Atendimento acima do limite fixo'
);

select is(
  (select valor_base from apticket.tickets_cobranca_avulsa where ticket_id = '50000000-0000-0000-0000-000000000001'),
  303.33::numeric,
  'acima de 90 minutos usa o total de horas pela hora técnica'
);

update apticket.tickets_cobranca_avulsa
set valor_final = 280,
    justificativa_ajuste = 'Ajuste comercial aprovado'
where ticket_id = '50000000-0000-0000-0000-000000000001';

select ok(
  (select valor_ajustado_manualmente from apticket.tickets_cobranca_avulsa where ticket_id = '50000000-0000-0000-0000-000000000001'),
  'ajuste administrativo fica sinalizado'
);
select ok(
  not has_table_privilege('authenticated', 'apticket.tickets_cobranca_avulsa', 'DELETE'),
  'papel autenticado não pode apagar cobranças'
);

select * from finish();
rollback;
