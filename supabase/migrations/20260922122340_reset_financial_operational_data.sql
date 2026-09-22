-- Limpeza operacional solicitada para o unico tenant existente em 2026-09-22.
-- O tenant e fixado para impedir que a migration apague dados de tenants
-- criados futuramente.
do $$
begin
  if not exists (
    select 1
    from apticket.tenants
    where id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid
  ) then
    raise exception 'Tenant alvo da limpeza financeira nao encontrado.';
  end if;
end
$$;

-- Impede novas escritas concorrentes enquanto os vinculos sao desfeitos.
lock table
  apticket.medicoes_contrato,
  apticket.contas_receber,
  apticket.supplier_payables,
  apticket.funcionario_eventos_financeiros,
  apticket.financial_categories,
  apticket.financial_cost_centers
in share row exclusive mode;

-- As medicoes permanecem como historico operacional, mas voltam ao ponto em
-- que podem ser revisadas e aprovadas novamente.
alter table apticket.medicoes_contrato
  disable trigger medicoes_contrato_bloquear_alteracao;

update apticket.medicoes_contrato
set
  status = 'gerada',
  aprovada_em = null,
  aprovada_por = null,
  aprovada_por_nome = null,
  cancelada_em = null,
  cancelada_por = null,
  cancelada_por_nome = null,
  justificativa_cancelamento = null
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;

alter table apticket.medicoes_contrato
  enable trigger medicoes_contrato_bloquear_alteracao;

-- Remove a fila sandbox do Inter ligada aos recebiveis que serao apagados.
alter table apticket.inter_charge_dispatch_attempts
  disable trigger inter_dispatch_attempt_no_delete;
alter table apticket.inter_charge_sync_attempts
  disable trigger inter_charge_sync_no_delete;
alter table apticket.inter_charge_webhook_events
  disable trigger inter_charge_webhook_event_no_delete;
alter table apticket.inter_payer_snapshots
  disable trigger inter_payer_no_delete;
alter table apticket.inter_charge_requests
  disable trigger inter_requests_no_delete;

delete from apticket.inter_charge_dispatch_attempts
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;
delete from apticket.inter_charge_sync_attempts
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;
delete from apticket.inter_charge_webhook_events
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;
delete from apticket.inter_payer_snapshots
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;
delete from apticket.inter_charge_requests
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;

alter table apticket.inter_charge_dispatch_attempts
  enable trigger inter_dispatch_attempt_no_delete;
alter table apticket.inter_charge_sync_attempts
  enable trigger inter_charge_sync_no_delete;
alter table apticket.inter_charge_webhook_events
  enable trigger inter_charge_webhook_event_no_delete;
alter table apticket.inter_payer_snapshots
  enable trigger inter_payer_no_delete;
alter table apticket.inter_charge_requests
  enable trigger inter_requests_no_delete;

-- Remove dependencias das contas a receber. Esses registros sao filas e
-- estados derivados; as configuracoes de cobranca permanecem intactas.
alter table apticket.collection_actions disable trigger guard_delete;
alter table apticket.contract_financial_holds disable trigger guard_delete;
alter table apticket.financial_domain_events disable trigger guard_delete;

delete from apticket.collection_actions
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;
delete from apticket.contract_financial_holds
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;
delete from apticket.financial_domain_events
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;

alter table apticket.collection_actions enable trigger guard_delete;
alter table apticket.contract_financial_holds enable trigger guard_delete;
alter table apticket.financial_domain_events enable trigger guard_delete;

alter table apticket.contas_receber disable trigger guard_receivable_delete;
delete from apticket.contas_receber
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;
alter table apticket.contas_receber enable trigger guard_receivable_delete;

-- Limpa o fechamento mensal da folha. Outros eventos avulsos de funcionario
-- sao preservados, mas retornam a pendente e perdem o vinculo financeiro.
update apticket.funcionario_banco_horas_saldo balance
set liquidado_evento_id = null,
    updated_at = clock_timestamp()
where balance.tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid
  and balance.liquidado_evento_id in (
    select event.id
    from apticket.funcionario_eventos_financeiros event
    where event.tenant_id = balance.tenant_id
      and event.tipo_evento = 'pagamento_folha'
  );

delete from apticket.funcionario_eventos_financeiros_itens item
where item.tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid
  and item.evento_id in (
    select event.id
    from apticket.funcionario_eventos_financeiros event
    where event.tenant_id = item.tenant_id
      and event.tipo_evento = 'pagamento_folha'
  );

delete from apticket.funcionario_eventos_financeiros
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid
  and tipo_evento = 'pagamento_folha';

update apticket.funcionario_eventos_financeiros
set
  conta_pagar_id = null,
  financial_category_id = null,
  cost_center_id = null,
  status_integracao = 'pendente',
  erro_integracao = null,
  updated_at = clock_timestamp()
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;

-- Remove pagamentos, aprovacoes, rateios e contas a pagar.
alter table apticket.supplier_payments
  disable trigger supplier_payment_no_delete;
alter table apticket.supplier_payable_approval_steps
  disable trigger supplier_approval_no_delete;
alter table apticket.supplier_payable_approval_requests
  disable trigger supplier_approval_no_delete;
alter table apticket.supplier_payable_allocations
  disable trigger payable_cycle_no_delete;
alter table apticket.supplier_payables
  disable trigger payable_cycle_no_delete;

delete from apticket.supplier_payments
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;
delete from apticket.supplier_payable_approval_steps
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;
delete from apticket.supplier_payable_approval_requests
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;
delete from apticket.supplier_payable_allocations
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;
delete from apticket.supplier_payables
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;

alter table apticket.supplier_payments
  enable trigger supplier_payment_no_delete;
alter table apticket.supplier_payable_approval_steps
  enable trigger supplier_approval_no_delete;
alter table apticket.supplier_payable_approval_requests
  enable trigger supplier_approval_no_delete;
alter table apticket.supplier_payable_allocations
  enable trigger payable_cycle_no_delete;
alter table apticket.supplier_payables
  enable trigger payable_cycle_no_delete;

-- O fluxo de caixa e uma view derivada. Ao remover contas, orcamentos e
-- classificacoes, suas linhas desaparecem automaticamente.
alter table apticket.financial_period_snapshot_lines
  disable trigger guard_financial_period_snapshot;
alter table apticket.financial_period_closures
  disable trigger guard_financial_period_closure;
alter table apticket.financial_budget_entries
  disable trigger financial_budget_no_delete;
alter table apticket.financial_entry_classifications
  disable trigger financial_classification_no_delete;

delete from apticket.financial_period_snapshot_lines
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;
delete from apticket.financial_period_closures
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;
delete from apticket.financial_budget_entries
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;
delete from apticket.financial_entry_classifications
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;

alter table apticket.financial_period_snapshot_lines
  enable trigger guard_financial_period_snapshot;
alter table apticket.financial_period_closures
  enable trigger guard_financial_period_closure;
alter table apticket.financial_budget_entries
  enable trigger financial_budget_no_delete;
alter table apticket.financial_entry_classifications
  enable trigger financial_classification_no_delete;

delete from apticket.financial_manual_entry_groups
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;

-- Remove referencias cadastrais antes de excluir categorias e centros.
update apticket.contracts
set financial_category_id = null,
    cost_center_id = null,
    updated_at = clock_timestamp()
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid
  and (financial_category_id is not null or cost_center_id is not null);

update apticket.supplier_contracts
set financial_category_id = null,
    cost_center_id = null,
    updated_at = clock_timestamp()
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid
  and (financial_category_id is not null or cost_center_id is not null);

update apticket.funcionarios
set centro_custo_id = null,
    updated_at = clock_timestamp()
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid
  and centro_custo_id is not null;

alter table apticket.financial_categories
  disable trigger financial_classification_no_delete;
alter table apticket.financial_cost_centers
  disable trigger financial_classification_no_delete;

delete from apticket.financial_categories
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;
delete from apticket.financial_cost_centers
where tenant_id = '80e28baa-41d8-4a50-9fb1-f5d8ac51a93e'::uuid;

alter table apticket.financial_categories
  enable trigger financial_classification_no_delete;
alter table apticket.financial_cost_centers
  enable trigger financial_classification_no_delete;
