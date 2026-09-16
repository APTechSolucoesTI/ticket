-- origin_type é uma coluna gerada em supplier_payables; o vínculo com RH fica
-- no snapshot e na classificação, sem tentar gravar a coluna diretamente.
create or replace function apticket.integrate_employee_financial_event(p_event_id uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare event apticket.funcionario_eventos_financeiros; employee apticket.funcionarios; bank apticket.funcionario_dados_bancarios;
  supplier_id uuid; payable_id uuid; category apticket.financial_categories; center apticket.financial_cost_centers; actor_name text;
begin
  select * into event from apticket.funcionario_eventos_financeiros where id=p_event_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Evento financeiro não encontrado.'; end if;
  if auth.uid() is null or event.tenant_id<>apticket.current_tenant_id() or not (
    apticket.has_permission(auth.uid(),'funcionarios','payroll') or apticket.has_permission(auth.uid(),'financeiro_contas_pagar','edit')) then
    raise exception using errcode='42501',message='Sem permissão para integrar a folha ao financeiro.';
  end if;
  if event.conta_pagar_id is not null then return event.conta_pagar_id; end if;
  select * into employee from apticket.funcionarios where id=event.funcionario_id and deleted_at is null;
  select * into bank from apticket.funcionario_dados_bancarios where funcionario_id=employee.id and is_atual and deleted_at is null;
  if bank.id is null then raise exception using errcode='23514',message='Cadastre os dados bancários vigentes antes de gerar a conta a pagar.'; end if;
  supplier_id:=employee.fornecedor_id;
  if supplier_id is null then select id into supplier_id from apticket.suppliers where tenant_id=event.tenant_id and tax_id=employee.cpf and deleted_at is null limit 1; end if;
  if supplier_id is null then
    insert into apticket.suppliers(tenant_id,legal_name,trade_name,tax_id,category,email,phone,notes,created_by)
      values(event.tenant_id,employee.nome_completo,employee.nome_social,employee.cpf,'other',coalesce(employee.email_corporativo,employee.email_pessoal),employee.telefone_principal,'Favorecido criado automaticamente pelo módulo de funcionários.',auth.uid()) returning id into supplier_id;
  end if;
  update apticket.funcionarios set fornecedor_id=supplier_id where id=employee.id;
  select * into category from apticket.financial_categories where tenant_id=event.tenant_id and operating_company_id=event.operating_company_id
    and (id=event.financial_category_id or (event.financial_category_id is null and code='DES-PESSOAL')) and is_active and deleted_at is null order by (id=event.financial_category_id) desc limit 1;
  select * into center from apticket.financial_cost_centers where tenant_id=event.tenant_id and operating_company_id=event.operating_company_id
    and id=coalesce(event.cost_center_id,employee.centro_custo_id) and is_active and deleted_at is null;
  if category.id is null or center.id is null then raise exception using errcode='23514',message='Informe categoria financeira e centro de custo válidos para o evento.'; end if;
  payable_id:=gen_random_uuid();
  insert into apticket.supplier_payables(id,tenant_id,operating_company_id,supplier_id,supplier_contract_id,
    document_number,description,cycle_start,cycle_end,due_date,billing_unit,measured_quantity,unit_price,total_amount,
    allocation_status,status,terms_snapshot,created_by)
  values(payable_id,event.tenant_id,event.operating_company_id,supplier_id,null,
    'RH-'||to_char(event.competencia,'YYYYMM')||'-'||upper(substr(event.id::text,1,8)),
    case event.tipo_evento when 'pagamento_folha' then 'Folha de pagamento' when 'adiantamento_salarial' then 'Adiantamento salarial'
      when 'vale_transporte' then 'Vale-transporte' when 'vale_refeicao' then 'Vale-refeição'
      when 'ferias' then 'Férias' when 'banco_horas' then 'Banco de horas' else '13º salário' end||' - '||employee.nome_completo,
    event.competencia,(event.competencia+interval '1 month')::date,event.data_prevista_pagamento,'fixed',1,event.valor_liquido,event.valor_liquido,
    'complete','scheduled',jsonb_build_object('origin_type','employee','supplier_name',employee.nome_completo,'employee_id',employee.id,'employee_cpf',employee.cpf,
      'event_id',event.id,'event_type',event.tipo_evento,'bank_snapshot',jsonb_build_object('tipo_recebimento',bank.tipo_recebimento,
      'banco_codigo',bank.banco_codigo,'banco_nome',bank.banco_nome,'agencia',bank.agencia,'agencia_dv',bank.agencia_dv,
      'conta',bank.conta,'conta_dv',bank.conta_dv,'chave_pix',bank.chave_pix,'tipo_chave_pix',bank.tipo_chave_pix,
      'titular_nome',bank.titular_nome,'titular_cpf',bank.titular_cpf)),auth.uid());
  select name into actor_name from apticket.profiles where id=auth.uid();
  insert into apticket.financial_entry_classifications(tenant_id,operating_company_id,source_type,source_id,direction,
    financial_category_id,financial_category_code,financial_category_name,cost_center_id,cost_center_code,cost_center_name,notes,classified_by,classified_by_name)
  values(event.tenant_id,event.operating_company_id,'supplier_payable',payable_id,'outflow',category.id,category.code,category.name,
    center.id,center.code,center.name,'Gerado pelo módulo de funcionários',auth.uid(),coalesce(actor_name,'Sistema'));
  update apticket.funcionario_eventos_financeiros set conta_pagar_id=payable_id,status_integracao='enviado',erro_integracao=null,
    financial_category_id=category.id,cost_center_id=center.id,updated_at=clock_timestamp() where id=event.id;
  return payable_id;
exception when others then
  if event.id is not null then update apticket.funcionario_eventos_financeiros set status_integracao='erro',erro_integracao=sqlerrm,updated_at=clock_timestamp() where id=event.id; end if;
  return null;
end $$;
