-- Restore the original RPCs and policy expressions before removing the new catalog.
drop trigger protect_admin_user_permissions on apticket.user_permissions;
drop function apticket_security_private.protect_admin_user_permissions();
CREATE OR REPLACE FUNCTION apticket.get_effective_permissions(_user_id uuid)
 RETURNS TABLE(module text, action text, granted_by_role boolean, override boolean, effective boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select
    p.module,
    p.action,
    (rp.permission_id is not null) as granted_by_role,
    up.granted as override,
    coalesce(up.granted, rp.permission_id is not null) as effective
  from apticket.permissions p
  left join apticket.user_roles ur on ur.user_id = _user_id
  left join apticket.role_permissions rp
    on rp.permission_id = p.id and rp.role_id = ur.role_id
  left join apticket.user_permissions up
    on up.permission_id = p.id and up.user_id = _user_id
  where _user_id = (select auth.uid())
     or current_user in ('service_role', 'postgres');
$function$
;

CREATE OR REPLACE FUNCTION apticket.archive_supplier_contract(p_contract_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare contract apticket.supplier_contracts; begin
  select * into contract from apticket.supplier_contracts
    where id=p_contract_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Contrato de fornecedor nao encontrado.'; end if;
  if auth.uid() is null
    or not apticket.has_financial_scope(contract.tenant_id,contract.operating_company_id,true)
    or not apticket.has_permission(auth.uid(),'financeiro_contas_pagar','edit') then
    raise exception using errcode='42501',message='Sem permissao para excluir este contrato.';
  end if;
  if exists(select 1 from apticket.supplier_payables where supplier_contract_id=contract.id) then
    raise exception using errcode='23514',message='Este contrato possui medicoes e nao pode ser excluido.';
  end if;
  update apticket.supplier_contracts set status='cancelled',is_active=false,
    deleted_at=clock_timestamp(),updated_by=auth.uid(),updated_at=clock_timestamp()
    where id=contract.id;
  return true;
end
$function$
;

CREATE OR REPLACE FUNCTION apticket.generate_supplier_payable(p_supplier_contract_id uuid, p_competence date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  c apticket.supplier_contracts;
  s apticket.suppliers;
  v_actor uuid:=auth.uid();
  v_role text:=coalesce(current_setting('request.jwt.claim.role',true),'');
  v_competence date:=date_trunc('month',coalesce(p_competence,current_date))::date;
  v_anchor date;
  v_start date;
  v_end date;
  v_due date;
  v_id uuid;
  v_total numeric(14,2);
  v_quantity numeric(18,6);
  v_count integer;
begin
  if not apticket.has_permission(auth.uid(),'financeiro_contas_pagar','edit') then
    raise exception using errcode='42501',message='Sem permissao para esta operacao financeira.';
  end if;
  if p_supplier_contract_id is null then
    raise exception using errcode='22023',message='Informe o contrato do fornecedor.';
  end if;
  select * into c from apticket.supplier_contracts
    where id=p_supplier_contract_id and deleted_at is null for update;
  if not found or not c.is_active then
    raise exception using errcode='P0002',message='Contrato de fornecedor ativo nao encontrado.';
  end if;
  if v_role<>'service_role' and (v_actor is null
    or not apticket.has_financial_scope(c.tenant_id,c.operating_company_id,true)) then
    raise exception using errcode='42501',message='Sem permissao financeira para gerar o lancamento.';
  end if;
  select * into s from apticket.suppliers where id=c.supplier_id and deleted_at is null and is_active;
  if not found then
    raise exception using errcode='23514',message='O fornecedor deste contrato nao esta ativo.';
  end if;
  v_anchor:=date_trunc('month',c.starts_at)::date;
  if v_competence<v_anchor or mod(
    (extract(year from age(v_competence,v_anchor))::integer*12)+extract(month from age(v_competence,v_anchor))::integer,
    c.billing_interval_months)<>0 then
    raise exception using errcode='23514',message='A competencia nao corresponde a periodicidade deste contrato.';
  end if;
  v_start:=greatest(v_competence,c.starts_at);
  v_end:=(v_competence+(c.billing_interval_months||' months')::interval)::date;
  if c.ends_at is not null then v_end:=least(v_end,c.ends_at+1); end if;
  if v_start>=v_end then
    raise exception using errcode='23514',message='A competencia esta fora da vigencia do contrato.';
  end if;
  select id into v_id from apticket.supplier_payables
    where supplier_contract_id=c.id and cycle_start=v_start and deleted_at is null;
  if found then return v_id; end if;
  v_due:=v_competence+(least(c.due_day,extract(day from
    (v_competence+interval '1 month - 1 day'))::integer)-1);
  v_id:=gen_random_uuid();
  if c.billing_unit='fixed' then
    v_quantity:=1; v_total:=c.base_amount;
  else
    select count(*),coalesce(sum(x.measured_quantity),0),
      coalesce(sum(round(x.measured_quantity*c.unit_price,2)),0)
      into v_count,v_quantity,v_total
    from apticket.consumption_snapshots x
    where x.tenant_id=c.tenant_id and x.operating_company_id=c.operating_company_id
      and x.metric=c.billing_unit and x.cycle_start>=v_start and x.cycle_end<=v_end
      and x.deleted_at is null;
    if v_count=0 then
      raise exception using errcode='23514',message='O consumo desta competencia ainda nao foi apurado.';
    end if;
  end if;
  insert into apticket.supplier_payables(id,tenant_id,operating_company_id,supplier_id,
    supplier_contract_id,document_number,description,cycle_start,cycle_end,due_date,billing_unit,
    measured_quantity,unit_price,total_amount,allocation_status,terms_snapshot,created_by)
  values(v_id,c.tenant_id,c.operating_company_id,c.supplier_id,c.id,
    'PAG-'||to_char(v_competence,'YYYYMM')||'-'||upper(substr(v_id::text,1,8)),
    c.description,v_start,v_end,v_due,c.billing_unit,v_quantity,
    case when c.billing_unit='fixed' then c.base_amount else c.unit_price end,v_total,
    case when c.billing_unit='fixed' then 'pending_rule' else 'complete' end,
    jsonb_build_object('supplier_name',coalesce(s.trade_name,s.legal_name),'supplier_tax_id',s.tax_id,
      'contract_description',c.description,'billing_interval_months',c.billing_interval_months,
      'base_amount',c.base_amount,'unit_price',c.unit_price,'due_day',c.due_day),v_actor);
  if c.billing_unit<>'fixed' then
    insert into apticket.supplier_payable_allocations(tenant_id,operating_company_id,
      supplier_payable_id,customer_contract_id,consumption_snapshot_id,customer_name,contract_number,
      metric,quantity,unit_price,source_snapshot)
    select c.tenant_id,c.operating_company_id,v_id,x.contract_id,x.id,company.name,client_contract.numero_contrato,x.metric,
      x.measured_quantity,c.unit_price,
      jsonb_build_object('snapshot_id',x.id,'cycle_start',x.cycle_start,'cycle_end',x.cycle_end,
        'measured_quantity',x.measured_quantity,'source_type',x.source_type,'source_items',x.source_items)
    from apticket.consumption_snapshots x
    join apticket.contracts client_contract on client_contract.id=x.contract_id and client_contract.tenant_id=x.tenant_id
    join apticket.companies company on company.id=client_contract.company_id and company.tenant_id=x.tenant_id
    where x.tenant_id=c.tenant_id and x.operating_company_id=c.operating_company_id
      and x.metric=c.billing_unit and x.cycle_start>=v_start and x.cycle_end<=v_end
      and x.deleted_at is null;
  end if;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION apticket.save_supplier_allocation_rules(p_supplier_contract_id uuid, p_effective_from date, p_rules jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare c apticket.supplier_contracts; v_actor uuid:=auth.uid(); v_set_id uuid;
  v_count integer; v_distinct integer; v_total numeric; v_invalid integer; pending_record record;
begin
  select * into c from apticket.supplier_contracts
    where id=p_supplier_contract_id and deleted_at is null for update;
  if not found or not c.is_active then
    raise exception using errcode='23514',message='Selecione um contrato de fornecedor ativo.';
  end if;
  if v_actor is null or not apticket.has_financial_scope(c.tenant_id,c.operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para configurar o rateio.';
  end if;
  if p_effective_from is null or p_effective_from<>date_trunc('month',p_effective_from)::date then
    raise exception using errcode='23514',message='A competencia do rateio deve iniciar no primeiro dia do mes.';
  end if;
  if p_rules is null or jsonb_typeof(p_rules)<>'array' or jsonb_array_length(p_rules)=0 then
    raise exception using errcode='23514',message='Informe ao menos um contrato para o rateio.';
  end if;
  select count(*),count(distinct customer_contract_id),coalesce(sum(percentage),0),
    count(*) filter(where customer_contract_id is null or percentage is null or percentage<=0 or percentage>100)
    into v_count,v_distinct,v_total,v_invalid
  from jsonb_to_recordset(p_rules) as item(customer_contract_id uuid,percentage numeric);
  if v_invalid>0 or v_count<>v_distinct then
    raise exception using errcode='23514',message='Os contratos do rateio devem ser unicos e possuir percentual valido.';
  end if;
  if v_total<>100 then
    raise exception using errcode='23514',message='A soma dos percentuais do rateio deve ser exatamente 100%.';
  end if;
  select count(*) into v_invalid
  from jsonb_to_recordset(p_rules) as item(customer_contract_id uuid,percentage numeric)
  where not exists(select 1 from apticket.contract_financial_terms f
    where f.contract_id=item.customer_contract_id and f.tenant_id=c.tenant_id
      and f.operating_company_id=c.operating_company_id and f.deleted_at is null);
  if v_invalid>0 then
    raise exception using errcode='23514',message='Um contrato de cliente nao pertence a esta empresa operadora.';
  end if;
  select id into v_set_id from apticket.supplier_allocation_rule_sets
    where supplier_contract_id=c.id and effective_from=p_effective_from and deleted_at is null for update;
  if found then
    if exists(select 1 from apticket.supplier_payable_allocations a
      join apticket.supplier_allocation_rules r on r.id=a.allocation_rule_id
      where r.rule_set_id=v_set_id and a.deleted_at is null) then
      raise exception using errcode='23514',message='O rateio desta medicao ja foi utilizado e nao pode ser alterado.';
    end if;
    update apticket.supplier_allocation_rules set deleted_at=clock_timestamp()
      where rule_set_id=v_set_id and deleted_at is null;
  else
    v_set_id:=gen_random_uuid();
    insert into apticket.supplier_allocation_rule_sets(id,tenant_id,operating_company_id,
      supplier_contract_id,effective_from,created_by)
    values(v_set_id,c.tenant_id,c.operating_company_id,c.id,p_effective_from,v_actor);
  end if;
  insert into apticket.supplier_allocation_rules(tenant_id,operating_company_id,rule_set_id,
    customer_contract_id,percentage,created_by)
  select c.tenant_id,c.operating_company_id,v_set_id,item.customer_contract_id,item.percentage,v_actor
  from jsonb_to_recordset(p_rules) as item(customer_contract_id uuid,percentage numeric);
  for pending_record in select id from apticket.supplier_payables
    where supplier_contract_id=c.id and allocation_status='pending_rule'
      and cycle_start>=p_effective_from and deleted_at is null for update
  loop perform apticket_finance_private.apply_fixed_supplier_allocation(pending_record.id); end loop;
  return v_set_id;
end $function$
;

CREATE OR REPLACE FUNCTION apticket.seed_tenant_default_roles(_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'apticket'
AS $function$
declare
  v_admin uuid;
  v_agent uuid;
  v_req uuid;
  v_fin uuid;
begin
  insert into apticket.roles (tenant_id, name, description, is_system)
    values (_tenant_id, 'Admin', 'Acesso total ao workspace', true)
    returning id into v_admin;
  insert into apticket.roles (tenant_id, name, description, is_system)
    values (_tenant_id, 'Agente', 'Atende tickets e opera o dia a dia', false)
    returning id into v_agent;
  insert into apticket.roles (tenant_id, name, description, is_system)
    values (_tenant_id, 'Solicitante', 'Abre e acompanha os próprios tickets', false)
    returning id into v_req;
  insert into apticket.roles (tenant_id, name, description, is_system)
    values (_tenant_id, 'Financeiro', 'Faturamento e recebimento de atendimentos avulsos', false)
    returning id into v_fin;

  insert into apticket.role_permissions (role_id, permission_id)
    select v_admin, id from apticket.permissions;

  insert into apticket.role_permissions (role_id, permission_id)
    select r, id
    from apticket.permissions, unnest(array[v_agent, v_req]) as r
    where module not in ('papeis','permissoes','usuarios','financeiro','fornecedores') and module not like 'financeiro\_%' escape '\'
      and not (module = 'canais' and action = 'edit')
      and not (module = 'empresa' and action = 'edit')
      and not (module = 'configuracoes' and action = 'edit')
      and not (module = 'base_conhecimento' and action in ('create','edit','delete'))
      and not (module = 'respostas_padrao' and action in ('create','edit','delete'))
      and not (
        module in ('departamentos','familia_servicos','servicos_prestados','tipos_contrato','slas','figurinhas')
        and action in ('create','edit','delete')
      );

  insert into apticket.role_permissions (role_id, permission_id)
    select v_fin, id from apticket.permissions
    where ((module = 'financeiro' and action in ('view', 'edit')) or module like 'financeiro\_%' escape '\' or module='fornecedores')
       or (module in ('tickets', 'relatorios') and action = 'view') or (module='configuracoes' and action='view') or (module='empresa_operadora' and action in ('view','edit'));

  insert into apticket.tabela_precos_avulso (tenant_id, criado_por)
    values (_tenant_id, null);
end;
$function$
;

alter policy "financial_area_read_guard" on apticket.supplier_contracts using (apticket.has_permission(auth.uid(), 'financeiro_contas_pagar'::text, 'view'::text));
alter policy "payable_insert" on apticket.supplier_contracts with check (((deleted_at IS NULL) AND apticket.has_financial_scope(tenant_id, operating_company_id, true)));
alter policy "payable_read" on apticket.supplier_contracts using (apticket.has_financial_scope(tenant_id, operating_company_id));
alter policy "payable_update" on apticket.supplier_contracts using (((deleted_at IS NULL) AND apticket.has_financial_scope(tenant_id, operating_company_id, true))) with check (apticket.has_financial_scope(tenant_id, operating_company_id, true));
alter policy "supplier_contract_area_insert" on apticket.supplier_contracts with check (apticket.has_permission(auth.uid(), 'financeiro_contas_pagar'::text, 'edit'::text));
alter policy "supplier_contract_area_update" on apticket.supplier_contracts using (apticket.has_permission(auth.uid(), 'financeiro_contas_pagar'::text, 'edit'::text)) with check (apticket.has_permission(auth.uid(), 'financeiro_contas_pagar'::text, 'edit'::text));
drop function apticket.get_supplier_contract_options(uuid);
drop function apticket.has_supplier_contract_scope(uuid,uuid,boolean);
-- Only during this transactional DBA rollback: allow cascades for the removed catalog.
alter table apticket.role_permissions disable trigger role_permissions_protect_system;
delete from apticket.permissions where module='contratos_fornecedores';
alter table apticket.role_permissions enable trigger role_permissions_protect_system;
notify pgrst,'reload schema';
