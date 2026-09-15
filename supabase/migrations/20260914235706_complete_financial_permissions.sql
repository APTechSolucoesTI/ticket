-- O Financeiro passa a ser um modulo pai, com acesso independente por area.
-- As permissoes gerais continuam como defesa comum do escopo financeiro;
-- cada tela e cada mutacao privilegiada tambem exige a permissao da area.
insert into apticket.permissions(module,action) values
  ('fornecedores','view'),
  ('fornecedores','create'),
  ('fornecedores','edit'),
  ('fornecedores','delete'),
  ('financeiro_contas_receber','view'),
  ('financeiro_contas_receber','edit'),
  ('financeiro_contas_pagar','view'),
  ('financeiro_contas_pagar','edit'),
  ('financeiro_bancos','view'),
  ('financeiro_bancos','edit'),
  ('financeiro_fluxo_caixa','view'),
  ('financeiro_fluxo_caixa','edit'),
  ('financeiro_planejamento','view'),
  ('financeiro_planejamento','edit'),
  ('financeiro_resultados','view'),
  ('financeiro_fechamento','view'),
  ('financeiro_fechamento','edit')
on conflict(module,action) do nothing;

-- Preserva o acesso anterior de papeis customizados. Depois da migration,
-- administradores podem retirar individualmente cada area na matriz.
insert into apticket.role_permissions(role_id,permission_id)
select distinct role_permission.role_id,child.id
from apticket.role_permissions role_permission
join apticket.permissions parent on parent.id=role_permission.permission_id
join apticket.permissions child on (
  child.module like 'financeiro\_%' escape '\'
  and (
    (parent.module='financeiro' and parent.action='view' and child.action='view')
    or (parent.module='financeiro' and parent.action='edit')
  )
)
on conflict do nothing;

insert into apticket.role_permissions(role_id,permission_id)
select distinct role_permission.role_id,supplier_permission.id
from apticket.role_permissions role_permission
join apticket.permissions parent on parent.id=role_permission.permission_id
join apticket.permissions supplier_permission on supplier_permission.module='fornecedores'
where parent.module='financeiro'
  and (
    (parent.action='view' and supplier_permission.action='view')
    or parent.action='edit'
  )
on conflict do nothing;

-- Admin e Financeiro recebem o catalogo completo da area em todas as tenants.
insert into apticket.role_permissions(role_id,permission_id)
select role.id,permission.id
from apticket.roles role
cross join apticket.permissions permission
where (role.is_system or lower(role.name)='financeiro')
  and (permission.module='fornecedores' or permission.module like 'financeiro%')
on conflict do nothing;

insert into apticket.role_permissions(role_id,permission_id)
select role.id,permission.id
from apticket.roles role
join apticket.permissions permission on (
  (permission.module='configuracoes' and permission.action='view')
  or (permission.module='empresa_operadora' and permission.action in ('view','edit'))
)
where lower(role.name)='financeiro'
on conflict do nothing;

update apticket.roles
set description='Operacao completa de recebimentos, pagamentos, bancos e controles financeiros',
    updated_at=clock_timestamp()
where lower(name)='financeiro'
  and description='Faturamento e recebimento de atendimentos avulsos';

-- Fornecedor e um cadastro compartilhado do grupo, com CRUD proprio.
drop policy supplier_group_read on apticket.suppliers;
drop policy supplier_group_insert on apticket.suppliers;
drop policy supplier_group_update on apticket.suppliers;
create policy supplier_group_read on apticket.suppliers for select to authenticated
using (
  tenant_id=apticket.current_tenant_id()
  and (
    apticket.has_permission(auth.uid(),'fornecedores','view')
    or apticket.has_permission(auth.uid(),'financeiro_contas_pagar','view')
  )
);
create policy supplier_group_insert on apticket.suppliers for insert to authenticated
with check (
  tenant_id=apticket.current_tenant_id() and deleted_at is null
  and apticket.has_permission(auth.uid(),'fornecedores','create')
);
create policy supplier_group_update on apticket.suppliers for update to authenticated
using (
  tenant_id=apticket.current_tenant_id() and deleted_at is null
  and (
    apticket.has_permission(auth.uid(),'fornecedores','edit')
    or apticket.has_permission(auth.uid(),'fornecedores','delete')
  )
)
with check (
  tenant_id=apticket.current_tenant_id()
  and (
    apticket.has_permission(auth.uid(),'fornecedores','edit')
    or apticket.has_permission(auth.uid(),'fornecedores','delete')
  )
);

-- Leituras financeiras tambem sao limitadas no banco. Algumas fontes sao
-- consumidas por mais de uma area (por exemplo, fluxo e resultados), por isso
-- cada tabela declara explicitamente seus consumidores autorizados.
create function apticket_finance_private.add_financial_read_guard(
  p_table regclass,p_modules text[]
) returns void language plpgsql set search_path=pg_catalog as $$
declare predicate text;
begin
  select string_agg(format('apticket.has_permission(auth.uid(),%L,''view'')',module),' or ')
    into predicate from unnest(p_modules) module;
  if predicate is null then raise exception 'Lista de modulos vazia para %',p_table; end if;
  execute format('drop policy if exists financial_area_read_guard on %s',p_table);
  execute format(
    'create policy financial_area_read_guard on %s as restrictive for select to authenticated using (%s)',
    p_table,predicate
  );
end $$;

select apticket_finance_private.add_financial_read_guard(
  table_name::regclass,
  array['financeiro_contas_receber','financeiro_fluxo_caixa','financeiro_planejamento','financeiro_resultados','financeiro_fechamento']
)
from unnest(array[
  'apticket.billing_cycle_items','apticket.billing_cycles','apticket.collection_actions',
  'apticket.collection_policies','apticket.collection_policy_steps',
  'apticket.contract_financial_holds','apticket.contract_financial_terms',
  'apticket.contract_value_versions','apticket.contas_receber'
]) table_name;

select apticket_finance_private.add_financial_read_guard(
  table_name::regclass,
  array['financeiro_contas_receber']
)
from unnest(array[
  'apticket.inter_charge_dispatch_attempts','apticket.inter_charge_requests',
  'apticket.inter_charge_sync_attempts','apticket.inter_payer_snapshots'
]) table_name;

select apticket_finance_private.add_financial_read_guard(
  table_name::regclass,
  array['financeiro_contas_receber','financeiro_contas_pagar','financeiro_planejamento','financeiro_resultados','financeiro_fechamento']
)
from unnest(array['apticket.consumption_snapshots']) table_name;

select apticket_finance_private.add_financial_read_guard(
  table_name::regclass,
  array['financeiro_contas_pagar','financeiro_bancos','financeiro_fluxo_caixa','financeiro_planejamento','financeiro_resultados','financeiro_fechamento']
)
from unnest(array[
  'apticket.supplier_payables','apticket.supplier_payments',
  'apticket.supplier_payable_allocations'
]) table_name;

select apticket_finance_private.add_financial_read_guard(
  table_name::regclass,
  array['financeiro_contas_pagar']
)
from unnest(array[
  'apticket.supplier_allocation_rule_sets','apticket.supplier_allocation_rules',
  'apticket.supplier_approval_policies','apticket.supplier_approval_policy_steps',
  'apticket.supplier_bank_accounts','apticket.supplier_contracts',
  'apticket.supplier_payable_approval_requests','apticket.supplier_payable_approval_steps'
]) table_name;

select apticket_finance_private.add_financial_read_guard(
  table_name::regclass,array['financeiro_bancos']
)
from unnest(array[
  'apticket.bank_statement_imports','apticket.bank_statement_transactions',
  'apticket.operating_bank_accounts','apticket.operating_company_inter_bindings'
]) table_name;

select apticket_finance_private.add_financial_read_guard(
  table_name::regclass,
  array['financeiro_fluxo_caixa','financeiro_planejamento','financeiro_resultados','financeiro_fechamento']
)
from unnest(array[
  'apticket.financial_categories','apticket.financial_cost_centers',
  'apticket.financial_entry_classifications'
]) table_name;

select apticket_finance_private.add_financial_read_guard(
  table_name::regclass,
  array['financeiro_planejamento','financeiro_resultados','financeiro_fechamento']
)
from unnest(array['apticket.financial_budget_entries']) table_name;

select apticket_finance_private.add_financial_read_guard(
  table_name::regclass,array['financeiro_resultados','financeiro_fechamento']
)
from unnest(array[
  'apticket.financial_period_closures','apticket.financial_period_snapshot_lines'
]) table_name;

select apticket_finance_private.add_financial_read_guard(
  table_name::regclass,
  array['financeiro_contas_receber','financeiro_contas_pagar','financeiro_bancos',
    'financeiro_fluxo_caixa','financeiro_planejamento','financeiro_resultados','financeiro_fechamento']
)
from unnest(array[
  'apticket.financial_audit_log','apticket.financial_domain_events'
]) table_name;

drop function apticket_finance_private.add_financial_read_guard(regclass,text[]);

-- Escritas feitas diretamente pelo cliente recebem a mesma defesa granular.
create policy supplier_contract_area_insert on apticket.supplier_contracts
as restrictive for insert to authenticated
with check (apticket.has_permission(auth.uid(),'financeiro_contas_pagar','edit'));
create policy supplier_contract_area_update on apticket.supplier_contracts
as restrictive for update to authenticated
using (apticket.has_permission(auth.uid(),'financeiro_contas_pagar','edit'))
with check (apticket.has_permission(auth.uid(),'financeiro_contas_pagar','edit'));
create policy receivable_area_update on apticket.contas_receber
as restrictive for update to authenticated
using (apticket.has_permission(auth.uid(),'financeiro_contas_receber','edit'))
with check (apticket.has_permission(auth.uid(),'financeiro_contas_receber','edit'));

drop policy "tabela_precos_avulso select" on apticket.tabela_precos_avulso;
drop policy "tabela_precos_avulso insert" on apticket.tabela_precos_avulso;
drop policy "tabela_precos_avulso update" on apticket.tabela_precos_avulso;
create policy "tabela_precos_avulso select" on apticket.tabela_precos_avulso
for select to authenticated using (
  tenant_id=apticket.current_tenant_id()
  and apticket.has_permission(auth.uid(),'financeiro_contas_receber','view')
);
create policy "tabela_precos_avulso insert" on apticket.tabela_precos_avulso
for insert to authenticated with check (
  tenant_id=apticket.current_tenant_id()
  and apticket.has_permission(auth.uid(),'financeiro_contas_receber','edit')
);
create policy "tabela_precos_avulso update" on apticket.tabela_precos_avulso
for update to authenticated
using (
  tenant_id=apticket.current_tenant_id()
  and apticket.has_permission(auth.uid(),'financeiro_contas_receber','edit')
)
with check (
  tenant_id=apticket.current_tenant_id()
  and apticket.has_permission(auth.uid(),'financeiro_contas_receber','edit')
);

drop policy "cobranca_avulsa update" on apticket.tickets_cobranca_avulsa;
drop policy "cobranca_avulsa select" on apticket.tickets_cobranca_avulsa;
create policy "cobranca_avulsa select" on apticket.tickets_cobranca_avulsa
for select to authenticated using (
  tenant_id=apticket.current_tenant_id()
  and (
    apticket.has_permission(auth.uid(),'tickets','view')
    or apticket.has_permission(auth.uid(),'financeiro_contas_receber','view')
  )
);
create policy "cobranca_avulsa update" on apticket.tickets_cobranca_avulsa
for update to authenticated
using (
  tenant_id=apticket.current_tenant_id()
  and apticket.has_permission(auth.uid(),'financeiro_contas_receber','edit')
)
with check (
  tenant_id=apticket.current_tenant_id()
  and apticket.has_permission(auth.uid(),'financeiro_contas_receber','edit')
);

drop policy "cobranca_avulsa_audit select" on apticket.tickets_cobranca_avulsa_audit;
create policy "cobranca_avulsa_audit select" on apticket.tickets_cobranca_avulsa_audit
for select to authenticated using (
  tenant_id=apticket.current_tenant_id()
  and apticket.has_permission(auth.uid(),'financeiro_contas_receber','view')
);

-- Injeta uma verificacao de area no inicio de RPCs SECURITY DEFINER. O helper
-- falha a migration se uma assinatura deixar de existir ou nao for PL/pgSQL.
create function apticket_finance_private.prepend_financial_permission(
  fn regprocedure,p_module text,p_action text
) returns void language plpgsql set search_path=pg_catalog as $$
declare definition text; marker_position integer; guard text;
begin
  select pg_get_functiondef(fn) into definition;
  marker_position:=strpos(lower(definition),E'begin\n');
  if marker_position=0 then
    raise exception 'Nao foi possivel proteger a funcao %',fn;
  end if;
  guard:=format(
    E'begin\n  if not apticket.has_permission(auth.uid(),%L,%L) then\n    raise exception using errcode=''42501'',message=''Sem permissao para esta operacao financeira.'';\n  end if;\n',
    p_module,p_action
  );
  definition:=overlay(definition placing guard from marker_position for 6);
  execute definition;
end $$;

-- Contas a receber, cobranca e regua.
select apticket_finance_private.prepend_financial_permission(
  'apticket.get_collection_policy(uuid)','financeiro_contas_receber','view');
select apticket_finance_private.prepend_financial_permission(
  'apticket.evaluate_collection_policy(uuid,date)','financeiro_contas_receber','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket_finance_private.save_collection_policy(uuid,boolean,integer,jsonb)','financeiro_contas_receber','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket_finance_private.review_inter_payer(uuid)','financeiro_contas_receber','view');
select apticket_finance_private.prepend_financial_permission(
  'apticket_finance_private.review_inter_payer_display(uuid)','financeiro_contas_receber','view');
select apticket_finance_private.prepend_financial_permission(
  'apticket_finance_private.confirm_inter_payer(uuid,text,uuid,uuid,boolean)','financeiro_contas_receber','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket_finance_private.prepare_inter_charge(uuid,text)','financeiro_contas_receber','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket_finance_private.prepare_inter_charge_dispatch(uuid,boolean,boolean)','financeiro_contas_receber','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket_finance_private.prepare_inter_sandbox_dispatch(uuid,boolean)','financeiro_contas_receber','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket_finance_private.prepare_inter_charge_sync(uuid)','financeiro_contas_receber','edit');

-- Contas a pagar e aprovacoes.
select apticket_finance_private.prepend_financial_permission(
  'apticket.apply_supplier_payable_allocation(uuid)','financeiro_contas_pagar','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket.approve_supplier_payable(uuid,text)','financeiro_contas_pagar','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket.archive_supplier_approval_policy(uuid)','financeiro_contas_pagar','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket.archive_supplier_bank_account(uuid)','financeiro_contas_pagar','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket.cancel_supplier_payment(uuid,text)','financeiro_contas_pagar','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket.generate_supplier_payable(uuid,date)','financeiro_contas_pagar','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket.list_supplier_approval_approvers(uuid)','financeiro_contas_pagar','view');
select apticket_finance_private.prepend_financial_permission(
  'apticket.reject_supplier_payable(uuid,text)','financeiro_contas_pagar','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket.save_supplier_allocation_rules(uuid,date,jsonb)','financeiro_contas_pagar','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket.save_supplier_approval_policy(uuid,uuid,text,numeric,numeric,jsonb)','financeiro_contas_pagar','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket.save_supplier_bank_account(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,boolean)','financeiro_contas_pagar','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket.schedule_supplier_payment(uuid,uuid,date,text,text)','financeiro_contas_pagar','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket.settle_supplier_payment(uuid,timestamptz,numeric,text,text,text,text,bigint,text)','financeiro_contas_pagar','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket.submit_supplier_payable_for_approval(uuid)','financeiro_contas_pagar','edit');

-- Banco e conciliacao.
select apticket_finance_private.prepend_financial_permission(
  'apticket.ignore_bank_transaction(uuid,text)','financeiro_bancos','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket.import_bank_statement(uuid,text,text,text,date,date,jsonb)','financeiro_bancos','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket.reconcile_bank_transaction(uuid,text,uuid,text)','financeiro_bancos','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket.save_operating_bank_account(uuid,uuid,text,text,text,text,text,text,numeric,boolean)','financeiro_bancos','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket_finance_private.review_inter_binding(uuid,text)','financeiro_bancos','view');
select apticket_finance_private.prepend_financial_permission(
  'apticket_finance_private.confirm_inter_binding(uuid,text,integer,uuid,boolean)','financeiro_bancos','edit');

-- Fluxo, classificacao, planejamento e fechamento.
select apticket_finance_private.prepend_financial_permission(
  'apticket.archive_financial_dimension(text,uuid)','financeiro_fluxo_caixa','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket.classify_financial_entry(text,uuid,uuid,uuid,text)','financeiro_fluxo_caixa','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket.clear_financial_entry_classification(text,uuid)','financeiro_fluxo_caixa','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket.save_financial_category(uuid,uuid,text,text,text,text)','financeiro_fluxo_caixa','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket.save_financial_cost_center(uuid,uuid,text,text,text)','financeiro_fluxo_caixa','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket.clear_financial_budget_entry(uuid)','financeiro_planejamento','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket.save_financial_budget_entry(uuid,date,text,uuid,uuid,numeric,text)','financeiro_planejamento','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket_finance_private.close_financial_period_internal(uuid,date,text)','financeiro_fechamento','edit');
select apticket_finance_private.prepend_financial_permission(
  'apticket_finance_private.reopen_financial_period_internal(uuid,text)','financeiro_fechamento','edit');

drop function apticket_finance_private.prepend_financial_permission(regprocedure,text,text);

-- Configuracao e teste do Inter recebem o ator explicitamente porque sao
-- executados por uma Edge Function com service_role.
create function apticket_finance_private.patch_financial_function(
  fn regprocedure,old_text text,new_text text
) returns void language plpgsql set search_path=pg_catalog as $$
declare definition text; original text;
begin
  select pg_get_functiondef(fn) into definition;
  original:=definition;
  definition:=replace(definition,old_text,new_text);
  if definition=original then raise exception 'Nao foi possivel adaptar %',fn; end if;
  execute definition;
end $$;

select apticket_finance_private.patch_financial_function(
  'apticket.save_tenant_inter_configuration(uuid,uuid,uuid,text,text,jsonb,timestamptz,text,boolean,boolean,integer)',
  'or not apticket.has_permission(p_actor,''configuracoes'',''view'')',
  'or not apticket.has_permission(p_actor,''configuracoes'',''view'') or not apticket.has_permission(p_actor,''financeiro_bancos'',''edit'')');
select apticket_finance_private.patch_financial_function(
  'apticket.prepare_inter_connection_test(uuid,uuid,uuid,text,integer)',
  'or not apticket.has_permission(p_actor,''empresa_operadora'',''edit'')',
  'or not apticket.has_permission(p_actor,''empresa_operadora'',''edit'') or not apticket.has_permission(p_actor,''financeiro_bancos'',''edit'')');
select apticket_finance_private.patch_financial_function(
  'apticket_finance_private.prepare_inter_webhook_registration(uuid,uuid,uuid,text,integer,text)',
  'or not apticket.has_permission(p_actor,''empresa_operadora'',''edit'')',
  'or not apticket.has_permission(p_actor,''empresa_operadora'',''edit'') or not apticket.has_permission(p_actor,''financeiro_bancos'',''edit'')');

-- Atualiza o seed de novas tenants sem duplicar a extensa definicao vigente.
select apticket_finance_private.patch_financial_function(
  'apticket.seed_tenant_default_roles(uuid)',
  'where module not in (''papeis'',''permissoes'',''usuarios'',''financeiro'')',
  'where module not in (''papeis'',''permissoes'',''usuarios'',''financeiro'',''fornecedores'') and module not like ''financeiro\_%'' escape ''\''');
select apticket_finance_private.patch_financial_function(
  'apticket.seed_tenant_default_roles(uuid)',
  'where (module = ''financeiro'' and action in (''view'', ''edit''))',
  'where ((module = ''financeiro'' and action in (''view'', ''edit'')) or module like ''financeiro\_%'' escape ''\'' or module=''fornecedores'')');
select apticket_finance_private.patch_financial_function(
  'apticket.seed_tenant_default_roles(uuid)',
  'or (module in (''tickets'', ''relatorios'') and action = ''view'');',
  'or (module in (''tickets'', ''relatorios'') and action = ''view'') or (module=''configuracoes'' and action=''view'') or (module=''empresa_operadora'' and action in (''view'',''edit''));');

drop function apticket_finance_private.patch_financial_function(regprocedure,text,text);

notify pgrst,'reload schema';
