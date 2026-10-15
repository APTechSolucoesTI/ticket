-- Category maintenance: validated hierarchy, serialized code allocation and dependency checks.
-- Existing IDs and financial snapshots are retained. No changes to cost-center RPC contracts.
create or replace function apticket_finance_private.category_dependencies(p_tenant uuid,p_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 with target as (select * from apticket.financial_categories where id=p_id and tenant_id=p_tenant),
 active_refs as (
   select id from apticket.contracts c where tenant_id=p_tenant and deleted_at is null
     and (financial_category_id=p_id or category_allocations @> jsonb_build_array(jsonb_build_object('item_id',p_id))
       or exists(select 1 from apticket.contracts_category_allocations a where a.tenant_id=p_tenant and a.contract_id=c.id and a.item_id=p_id))
   union all select id from apticket.supplier_contracts c where tenant_id=p_tenant and deleted_at is null
     and (financial_category_id=p_id or category_allocations @> jsonb_build_array(jsonb_build_object('item_id',p_id))
       or exists(select 1 from apticket.supplier_contracts_category_allocations a where a.tenant_id=p_tenant and a.contract_id=c.id and a.item_id=p_id))
   union all select id from apticket.fixed_payables where tenant_id=p_tenant and deleted_at is null
     and category_allocations @> jsonb_build_array(jsonb_build_object('item_id',p_id))
   union all select id from apticket.fixed_payable_occurrences where tenant_id=p_tenant and deleted_at is null and status='forecast'
     and category_allocations @> jsonb_build_array(jsonb_build_object('item_id',p_id))
   union all select id from apticket.financial_budget_entries where tenant_id=p_tenant and replaced_at is null and financial_category_id=p_id
   union all select id from apticket.funcionario_eventos_financeiros where tenant_id=p_tenant and financial_category_id=p_id
   union all select c.id from apticket.financial_entry_classifications c join apticket.contas_receber r
     on r.id=c.source_id and r.tenant_id=c.tenant_id
     where c.tenant_id=p_tenant and c.replaced_at is null and r.deleted_at is null and r.status_cobranca not in ('recebido','cancelado')
     and c.source_type in ('manual_receivable','measurement_receivable','recurring_receivable')
     and (c.financial_category_id=p_id or c.category_allocations @> jsonb_build_array(jsonb_build_object('item_id',p_id)))
   union all select c.id from apticket.financial_entry_classifications c join apticket.supplier_payables p
     on p.id=c.source_id and p.tenant_id=c.tenant_id
     where c.tenant_id=p_tenant and c.replaced_at is null and p.deleted_at is null and p.status not in ('paid','cancelled')
     and c.source_type='supplier_payable'
     and (c.financial_category_id=p_id or c.category_allocations @> jsonb_build_array(jsonb_build_object('item_id',p_id)))
 ), history_refs as (
   select id from apticket.financial_entry_classifications where tenant_id=p_tenant
     and (financial_category_id=p_id or category_allocations @> jsonb_build_array(jsonb_build_object('item_id',p_id)))
   union all select id from apticket.financial_budget_entries where tenant_id=p_tenant and financial_category_id=p_id
   union all select id from apticket.financial_period_snapshot_lines where tenant_id=p_tenant and financial_category_id=p_id
 )
 select jsonb_build_object(
   'children',(select count(*) from apticket.financial_categories c cross join target t
     where c.tenant_id=p_tenant and c.deleted_at is null and c.code like t.code||'.%'
     and (t.is_global or c.operating_company_id=t.operating_company_id)),
   'active_children',(select count(*) from apticket.financial_categories c cross join target t
     where c.tenant_id=p_tenant and c.deleted_at is null and c.is_active and c.code like t.code||'.%'
     and (t.is_global or c.operating_company_id=t.operating_company_id)),
   'active_links',(select count(*) from active_refs),
   'history_links',(select count(*) from history_refs));
$$;
revoke all on function apticket_finance_private.category_dependencies(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function apticket.get_financial_category_dependencies(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare item apticket.financial_categories; begin
 select * into item from apticket.financial_categories where id=p_id and deleted_at is null;
 if auth.uid() is null or not found or item.tenant_id is distinct from apticket.current_tenant_id()
   or not apticket.has_financial_scope(item.tenant_id,item.operating_company_id,true)
   or not apticket.has_permission(auth.uid(),'financeiro_fluxo_caixa','edit') then
   raise exception using errcode='42501',message='Sem permissão para consultar os vínculos desta categoria.';
 end if;
 return apticket_finance_private.category_dependencies(item.tenant_id,item.id);
end $$;

-- Reviewed APTech catalog. Preserve IDs, codes and historical classification snapshots.
do $$declare v_tenant uuid; owner_company uuid; item record; begin
 select id into v_tenant from apticket.tenants where id='80e28baa-41d8-4a50-9fb1-f5d8ac51a93e' and slug='aptech-solucoes-ti';
 if not found then return; end if;
 lock table apticket.financial_categories in share row exclusive mode;
 select operating_company_id into owner_company from apticket.financial_categories
   where tenant_id=v_tenant and code='01' and is_global and deleted_at is null;
 if not found then raise exception 'Grupo global Receitas não encontrado para revisão do catálogo.'; end if;
 -- Refuse an unexpected catalog rather than silently reclassifying other groups.
 if exists(select 1 from apticket.financial_categories where tenant_id=v_tenant and deleted_at is null
   and ((code='01' and name<>'Receitas') or (code='02' and name<>'Impostos') or (code='03' and name<>'Custos'))) then
   raise exception 'Grupos do catálogo foram alterados; revise a correção de naturezas.';
 end if;
 update apticket.financial_categories set direction=case when left(code,2)='01' then 'inflow' else 'outflow' end,
   updated_at=clock_timestamp()
 where tenant_id=v_tenant and deleted_at is null and left(code,2) in ('01','02','03','04')
   and direction is distinct from case when left(code,2)='01' then 'inflow' else 'outflow' end;
 for item in select * from (values
 ('01',null,'Receitas da empresa. Agrupar vendas e serviços; lançamentos somente nas categorias analíticas.'),
 ('01.01',null,'Receitas de serviços técnicos e projetos avulsos. Serviços recorrentes MSP ficam em 01.04.'),
 ('01.01.0001',null,'Receitas de consultoria técnica, diagnóstico e orientação especializada por projeto ou atendimento.'),
 ('01.01.0002','Desenvolvimento de software','Receitas de criação, evolução e manutenção de software contratado pelo cliente.'),
 ('01.01.0003','Desenvolvimento de BI','Receitas de implantação de BI, painéis, relatórios e projetos de análise de dados.'),
 ('01.01.0004',null,'Receitas de suporte técnico avulso. Contratos de suporte recorrente ficam em 01.04.0001.'),
 ('01.01.0005',null,'Valores recebidos de clientes para reembolsar despesas adiantadas pela empresa; identificar a despesa de origem.'),
 ('01.02',null,'Receitas de produtos e soluções comercializados no portfólio. Revendas identificadas separadamente ficam em 01.03.'),
 ('01.02.0001',null,'Receitas de licenciamento e renovação de antivírus comercializado aos clientes.'),
 ('01.02.0002',null,'Receitas de licenças, assinaturas e renovações de software de firewall.'),
 ('01.02.0003',null,'Receitas de venda de computadores e estações de trabalho.'),
 ('01.02.0004',null,'Receitas de venda de periféricos e acessórios de informática.'),
 ('01.02.0005',null,'Receitas de venda de servidores e equipamentos de infraestrutura.'),
 ('01.02.0006','Backup em nuvem','Receitas da solução de backup em nuvem do portfólio. Revenda de solução de terceiros fica em 01.03.0001; gestão recorrente fica em 01.04.0004.'),
 ('01.02.0007','Hospedagem de sites e e-mails','Receitas de hospedagem de sites, domínios associados e caixas de e-mail comercializados aos clientes.'),
 ('01.02.0008','Gerenciamento de e-mails','Receitas específicas de administração de ambientes de e-mail dos clientes.'),
 ('01.02.0009',null,'Receitas de licenciamento, assinatura e comercialização da solução APCHAT.'),
 ('01.03',null,'Receitas de revenda de soluções de terceiros, identificadas separadamente do portfólio de produtos.'),
 ('01.03.0001','Revenda de backup em nuvem','Receitas da revenda de licenças ou capacidade de backup de terceiros. Gestão recorrente de backup fica em 01.04.0004.'),
 ('01.03.0002',null,'Receitas de revenda de soluções Nextcloud ou ownCloud e respectivas assinaturas.'),
 ('02',null,'Pagamentos de tributos, contribuições e taxas. Agrupamento de saídas, sem lançamentos diretos.'),
 ('02.01',null,'Agrupar pagamentos de impostos, contribuições, taxas e parcelamentos tributários.'),
 ('02.01.0001',null,'Pagamentos de guias DAS, identificando período de apuração e documento.'),
 ('02.01.0002',null,'Pagamentos de guias DARF previdenciário e INSS, identificando competência e documento.'),
 ('02.01.0003',null,'Recolhimentos de FGTS, identificando a competência e a guia correspondente.'),
 ('02.01.0004',null,'Pagamentos de IPTU e parcelas do imposto referentes aos imóveis utilizados pela empresa.'),
 ('02.01.0005',null,'Pagamentos de guias de DIFAL, identificando operação, competência e documento.'),
 ('02.01.0006','Taxas de prefeituras','Pagamentos de taxas municipais, alvarás e outras guias emitidas por prefeituras.'),
 ('02.01.0007','Parcelamentos de impostos','Pagamentos de parcelas de débitos tributários; identificar acordo e número da parcela.'),
 ('03',null,'Custos de estrutura e operação. Custos diretos de ferramentas e serviços MSP ficam no subgrupo 03.02.'),
 ('03.01',null,'Despesas de estrutura e administração compartilhadas pela empresa, separadas dos custos diretos de prestação de serviços MSP.'),
 ('03.01.0001',null,'Pagamentos de aluguel dos imóveis utilizados pela empresa.'),
 ('03.01.0002',null,'Despesas de telefonia, celular e internet da estrutura interna da empresa.'),
 ('03.01.0003',null,'Pagamentos de energia elétrica dos imóveis e da estrutura interna.'),
 ('03.01.0004',null,'Pagamentos de água e esgoto dos imóveis utilizados pela empresa.'),
 ('03.01.0005',null,'Honorários e serviços de contabilidade prestados à empresa.'),
 ('03.01.0006',null,'Aquisições de equipamentos e ferramentas destinados ao laboratório técnico; registrar finalidade e documento.'),
 ('03.01.0007',null,'Aquisições de equipamentos para uso interno nos setores da empresa; registrar destino e documento.'),
 ('03.01.0008',null,'Compras de materiais de papelaria e expediente para uso interno.'),
 ('03.01.0009',null,'Despesas de deslocamento em aplicativos, táxis e outras alternativas de transporte a serviço da empresa.'),
 ('03.01.0010',null,'Compras de produtos e materiais de limpeza para uso interno.'),
 ('03.01.0011',null,'Compras de materiais de copa e consumo interno.'),
 ('03.01.0012',null,'Prêmios e parcelas de seguros contratados para proteção da empresa e sua estrutura.'),
 ('03.01.0013',null,'Licenças de software para uso administrativo interno. Ferramentas usadas na entrega MSP ficam em 03.02.'),
 ('03.01.0014',null,'Despesas de reformas, pintura e conservação dos imóveis utilizados pela empresa.'),
 ('04',null,'Saídas relacionadas a pessoal, remuneração, benefícios e administração de recursos humanos.'),
 ('04.01',null,'Agrupar remuneração, benefícios, encargos e serviços relacionados às pessoas da empresa.'),
 ('04.01.0001','Pró-labore','Pagamentos de pró-labore aos sócios, identificando beneficiário e competência.'),
 ('04.01.0002',null,'Pagamentos de salários e remuneração mensal dos funcionários.'),
 ('04.01.0003','Adiantamento salarial','Adiantamentos de remuneração aos funcionários; identificar beneficiário e competência para conferência com o pagamento final.'),
 ('04.01.0004',null,'Pagamentos de férias dos funcionários, identificando beneficiário e período.'),
 ('04.01.0005','13º salário','Pagamentos de parcelas do décimo terceiro salário, identificando beneficiário e competência.'),
 ('04.01.0006','Bolsa-auxílio','Pagamentos de bolsa-auxílio, identificando beneficiário e período.'),
 ('04.01.0007','Verba rescisória','Pagamentos relativos a rescisões, identificando beneficiário e documento correspondente.'),
 ('04.01.0008',null,'Despesas com exames admissionais dos funcionários.'),
 ('04.01.0009',null,'Despesas com exames demissionais dos funcionários.'),
 ('04.01.0010','Seguro de vida','Pagamentos de seguros de vida oferecidos como benefício ao pessoal.'),
 ('04.01.0011','Plano de saúde','Pagamentos de planos de saúde oferecidos como benefício ao pessoal.'),
 ('04.01.0012','Plano odontológico','Pagamentos de planos odontológicos oferecidos como benefício ao pessoal.'),
 ('04.01.0013','Vale-refeição','Pagamentos e recargas de benefício de alimentação ou refeição dos funcionários.'),
 ('04.01.0014','Vale-transporte','Pagamentos e recargas de vale-transporte dos funcionários.'),
 ('04.01.0015',null,'Pagamentos de sobreaviso, identificando beneficiário e período correspondente.'),
 ('04.01.0016','Software de ponto','Licenciamento e assinatura do sistema de controle de ponto e jornada.'),
 ('04.01.0017',null,'Compras de crachás e uniformes destinados aos funcionários.'),
 ('04.01.0018',null,'Despesas de capacitação, treinamentos e cursos para a equipe.'),
 ('05',null,'Movimentos financeiros e não operacionais, segregados das receitas de serviços e das despesas de estrutura.'),
 ('05.01',null,'Saídas destinadas a aplicações e investimentos financeiros da empresa.'),
 ('05.01.0001',null,'Valores aplicados em investimentos de renda fixa; resgates devem utilizar uma categoria compatível com entrada.'),
 ('05.02',null,'Saídas destinadas à distribuição de lucros aos sócios.'),
 ('05.02.0001',null,'Pagamentos de distribuição de lucros aos sócios, identificando beneficiário e período.'),
 ('05.03',null,'Movimentos não operacionais que não se enquadrem nos demais subgrupos; informar finalidade.'),
 ('05.03.0001',null,'Movimentações de caixa sem enquadramento nas demais categorias; registrar origem, destino e justificativa.'),
 ('05.03.0002',null,'Aportes realizados pela empresa, conforme finalidade da saída. Entradas de capital exigem uma categoria específica de entrada.')
 ) as definitions(code,new_name,description) loop
   update apticket.financial_categories set name=coalesce(item.new_name,btrim(regexp_replace(name,'\s+',' ','g'))),
     description=item.description,updated_at=clock_timestamp()
   where tenant_id=v_tenant and is_global and deleted_at is null and code=item.code
   and row(name,description) is distinct from row(coalesce(item.new_name,btrim(regexp_replace(name,'\s+',' ','g'))),item.description);
 end loop;
 for item in select * from (values
 ('01.04','Serviços gerenciados MSP','inflow','synthetic','Receitas recorrentes da gestão dos ambientes de TI dos clientes, separadas dos serviços avulsos e da venda de produtos.'),
 ('01.04.0001','Gestão de infraestrutura e suporte recorrente','inflow','analytic','Mensalidades de contratos de gestão de infraestrutura, help desk e suporte recorrente.'),
 ('01.04.0002','Monitoramento NOC','inflow','analytic','Receitas específicas de monitoramento de disponibilidade, desempenho e operação dos ambientes de clientes.'),
 ('01.04.0003','Segurança gerenciada SOC','inflow','analytic','Receitas de serviços gerenciados de segurança e acompanhamento de eventos de segurança.'),
 ('01.04.0004','Gestão de backup e recuperação','inflow','analytic','Receitas da gestão recorrente de backup, testes de restauração e recuperação. Licenças ou capacidade vendidas separadamente ficam em 01.02.0006 ou 01.03.0001.'),
 ('03.02','Custos diretos de serviços MSP','outflow','synthetic','Ferramentas, infraestrutura e serviços de terceiros utilizados na entrega dos contratos MSP. Software administrativo fica em 03.01.0013.'),
 ('03.02.0001','Ferramentas RMM','outflow','analytic','Licenças e assinaturas de RMM utilizadas para administrar e monitorar os ambientes de clientes.'),
 ('03.02.0002','Ferramentas PSA e atendimento','outflow','analytic','Licenças e assinaturas de PSA, service desk e atendimento usadas na prestação dos serviços aos clientes.'),
 ('03.02.0003','Soluções de segurança para clientes','outflow','analytic','Custos de licenças e serviços de segurança utilizados na entrega dos contratos de clientes.'),
 ('03.02.0004','Infraestrutura cloud e backup para clientes','outflow','analytic','Custos de nuvem, armazenamento e backup de terceiros utilizados na prestação de serviços aos clientes.'),
 ('03.02.0005','Serviços técnicos subcontratados','outflow','analytic','Custos de serviços técnicos de terceiros contratados para executar entregas ou atender contratos de clientes.')
 ) as additions(code,name,direction,classification_type,description) loop
   if not exists(select 1 from apticket.financial_categories where tenant_id=v_tenant and code=item.code and deleted_at is null) then
     insert into apticket.financial_categories(tenant_id,operating_company_id,code,name,direction,classification_type,description,is_global,is_active)
     values(v_tenant,owner_company,item.code,item.name,item.direction,item.classification_type,item.description,true,true);
   elsif not exists(select 1 from apticket.financial_categories where tenant_id=v_tenant and code=item.code and deleted_at is null
     and is_global and direction=item.direction and classification_type=item.classification_type) then
     raise exception 'Código MSP % já ocupado por cadastro incompatível.',item.code;
   end if;
 end loop;
end $$;
revoke all on function apticket.get_financial_category_dependencies(uuid) from public,anon,service_role;
grant execute on function apticket.get_financial_category_dependencies(uuid) to authenticated;

create or replace function apticket.save_financial_category(
 p_id uuid,p_operating_company_id uuid,p_code text,p_name text,p_direction text,
 p_description text default null,p_is_global boolean default false,p_is_active boolean default true,
 p_classification_type text default 'analytic'
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare v_tenant uuid; v_id uuid; current_row apticket.financial_categories;
 parent_row apticket.financial_categories; v_parent text; deps jsonb;
begin
 select tenant_id into v_tenant from apticket.operating_companies
 where id=p_operating_company_id and deleted_at is null;
 if auth.uid() is null or v_tenant is distinct from apticket.current_tenant_id()
 or not apticket.has_financial_scope(v_tenant,p_operating_company_id,true)
 or not apticket.has_permission(auth.uid(),'financeiro_fluxo_caixa','edit') then
   raise exception using errcode='42501',message='Sem permissão financeira para configurar categorias.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('apticket.category.'||v_tenant::text,0));
 p_code:=btrim(p_code); p_name:=btrim(regexp_replace(p_name,'\s+',' ','g'));
 if p_code is null or p_name is null or length(p_name) not between 2 and 150
 or p_direction is null or p_direction not in ('inflow','outflow','both')
 or p_classification_type is null or p_classification_type not in ('analytic','synthetic')
 or p_is_global is null or p_is_active is null or length(coalesce(p_description,''))>1000
 or (p_classification_type='synthetic' and p_code !~ '^([0-9]{2}|[0-9]{2}\.[0-9]{2}|[0-9]{2}\.[0-9]{2}\.[0-9]{4})$')
 or (p_classification_type='analytic' and p_code !~ '^[0-9]{2}\.[0-9]{2}\.[0-9]{4}$') then
   raise exception using errcode='23514',message='Revise código, nome, natureza e tipo da categoria.';
 end if;
 if exists(select 1 from apticket.financial_categories c where c.tenant_id=v_tenant
   and c.id is distinct from p_id and c.deleted_at is null and c.code=p_code
   and (c.is_global or p_is_global or c.operating_company_id=p_operating_company_id)) then
   raise exception using errcode='23505',message='Já existe uma categoria com este código no escopo informado.';
 end if;
 v_parent:=case when position('.' in p_code)>0 then regexp_replace(p_code,'\.[^.]+$','') end;
 if v_parent is not null then
   select * into parent_row from apticket.financial_categories c where c.tenant_id=v_tenant
     and c.deleted_at is null and c.code=v_parent and c.classification_type='synthetic'
     and (c.is_global or c.operating_company_id=p_operating_company_id) for share;
   if not found or (p_is_active and not parent_row.is_active) then
     raise exception using errcode='23514',message='Selecione um agrupamento sintético ativo para a categoria.';
   end if;
   if (p_is_global and not parent_row.is_global) or parent_row.direction not in (p_direction,'both') then
     raise exception using errcode='23514',message='A natureza e a abrangência devem ser compatíveis com a categoria pai.';
   end if;
 end if;
 if p_id is not null then
   select * into current_row from apticket.financial_categories where id=p_id and tenant_id=v_tenant and deleted_at is null for update;
   if not found or (current_row.operating_company_id<>p_operating_company_id and not current_row.is_global) then
     raise exception using errcode='P0002',message='Categoria financeira não encontrada.';
   end if;
   deps:=apticket_finance_private.category_dependencies(v_tenant,p_id);
   if (deps->>'children')::int>0 and row(current_row.code,current_row.direction,current_row.is_global,current_row.classification_type)
     is distinct from row(p_code,p_direction,p_is_global,p_classification_type) then
     raise exception using errcode='23514',message='Este grupo possui subcategorias. Reorganize os filhos antes de alterar código, natureza, abrangência ou tipo.';
   end if;
   if ((deps->>'active_links')::int+(deps->>'history_links')::int)>0
     and row(current_row.code,current_row.name,current_row.direction,current_row.is_global,current_row.classification_type)
     is distinct from row(p_code,p_name,p_direction,p_is_global,p_classification_type) then
     raise exception using errcode='23514',message='Categoria com vínculos: preserve código, nome, natureza, abrangência e tipo. A descrição pode ser atualizada.';
   end if;
   if not p_is_active and ((deps->>'active_children')::int>0 or (deps->>'active_links')::int>0) then
     raise exception using errcode='23514',message='Desvincule os cadastros ativos e desative as subcategorias antes de inativar este grupo.';
   end if;
   update apticket.financial_categories set code=p_code,name=p_name,direction=p_direction,
     description=nullif(btrim(p_description),''),is_global=p_is_global,is_active=p_is_active,
     classification_type=p_classification_type,updated_by=auth.uid(),updated_at=clock_timestamp() where id=p_id;
   return p_id;
 end if;
 insert into apticket.financial_categories(tenant_id,operating_company_id,code,name,direction,description,
   is_global,is_active,classification_type,created_by,updated_by)
 values(v_tenant,p_operating_company_id,p_code,p_name,p_direction,nullif(btrim(p_description),''),
   p_is_global,p_is_active,p_classification_type,auth.uid(),auth.uid()) returning id into v_id;
 return v_id;
end $$;

create or replace function apticket.create_financial_category(
 p_operating_company_id uuid,p_parent_id uuid,p_name text,p_direction text,
 p_description text default null,p_is_global boolean default false,p_is_active boolean default true,
 p_classification_type text default 'analytic'
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare v_tenant uuid; parent_row apticket.financial_categories; v_code text; v_next int;
begin
 select tenant_id into v_tenant from apticket.operating_companies where id=p_operating_company_id and deleted_at is null;
 if auth.uid() is null or v_tenant is distinct from apticket.current_tenant_id()
 or not apticket.has_financial_scope(v_tenant,p_operating_company_id,true)
 or not apticket.has_permission(auth.uid(),'financeiro_fluxo_caixa','edit') then
   raise exception using errcode='42501',message='Sem permissão financeira para cadastrar categorias.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('apticket.category.'||v_tenant::text,0));
 if p_parent_id is null then
   select coalesce(max(code::int),0)+1 into v_next from apticket.financial_categories
     where tenant_id=v_tenant and code ~ '^[0-9]{2}$';
   if v_next>99 then raise exception using errcode='23514',message='Limite de grupos atingido.'; end if;
   v_code:=lpad(v_next::text,2,'0');
 else
   select * into parent_row from apticket.financial_categories where id=p_parent_id and tenant_id=v_tenant
     and deleted_at is null and is_active and classification_type='synthetic'
     and (is_global or operating_company_id=p_operating_company_id) for share;
   if not found or parent_row.code !~ '^([0-9]{2}|[0-9]{2}\.[0-9]{2})$' then
     raise exception using errcode='23514',message='Selecione um agrupamento ativo de primeiro ou segundo nível.';
   end if;
   select coalesce(max(split_part(code,'.',case when length(parent_row.code)=2 then 2 else 3 end)::int),0)+1
     into v_next from apticket.financial_categories where tenant_id=v_tenant and code like parent_row.code||'.%';
   if v_next>(case when length(parent_row.code)=2 then 99 else 9999 end) then
     raise exception using errcode='23514',message='Limite de subcategorias atingido para este agrupamento.';
   end if;
   v_code:=parent_row.code||'.'||lpad(v_next::text,case when length(parent_row.code)=2 then 2 else 4 end,'0');
 end if;
 return apticket.save_financial_category(null,p_operating_company_id,v_code,p_name,p_direction,p_description,p_is_global,p_is_active,p_classification_type);
end $$;
revoke all on function apticket.create_financial_category(uuid,uuid,text,text,text,boolean,boolean,text) from public,anon,service_role;
grant execute on function apticket.create_financial_category(uuid,uuid,text,text,text,boolean,boolean,text) to authenticated;

-- Keep legacy cost-center archiving and permissions, adding category dependency protection.
create or replace function apticket.archive_financial_dimension(p_dimension text,p_id uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare v_tenant uuid; v_company uuid; deps jsonb; begin
 if not apticket.has_permission(auth.uid(),'financeiro_fluxo_caixa','edit') then
   raise exception using errcode='42501',message='Sem permissão para esta operação financeira.';
 end if;
 if p_dimension='cost_center' then
   select tenant_id,operating_company_id into v_tenant,v_company from apticket.financial_cost_centers where id=p_id and deleted_at is null;
 elsif p_dimension='category' then
   select tenant_id,operating_company_id into v_tenant,v_company from apticket.financial_categories where id=p_id and deleted_at is null;
 else raise exception using errcode='22023',message='Tipo de cadastro financeiro inválido.'; end if;
 if auth.uid() is null or v_tenant is distinct from apticket.current_tenant_id()
   or not apticket.has_financial_scope(v_tenant,v_company,true) then
   raise exception using errcode='42501',message='Sem permissão financeira para arquivar este cadastro.';
 end if;
 if p_dimension='category' then
   perform pg_advisory_xact_lock(hashtextextended('apticket.category.'||v_tenant::text,0));
   perform 1 from apticket.financial_categories where id=p_id for update;
   deps:=apticket_finance_private.category_dependencies(v_tenant,p_id);
   if (deps->>'children')::int>0 or (deps->>'active_links')::int>0 then
     raise exception using errcode='23514',message='Arquivamento bloqueado: reorganize as subcategorias e os vínculos ativos primeiro.';
   end if;
   update apticket.financial_categories set is_active=false,deleted_at=clock_timestamp(),updated_by=auth.uid(),updated_at=clock_timestamp() where id=p_id and deleted_at is null;
 else
   update apticket.financial_cost_centers set is_active=false,deleted_at=clock_timestamp(),updated_by=auth.uid(),updated_at=clock_timestamp() where id=p_id and deleted_at is null;
 end if;
 return true;
end $$;
notify pgrst,'reload schema';
