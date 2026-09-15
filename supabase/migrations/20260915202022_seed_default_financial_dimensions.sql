-- Plano financeiro inicial para todas as empresas operadoras ativas do grupo.
-- Os WHERE NOT EXISTS tornam a carga idempotente e preservam personalizacoes.
with category_seed(code,name,direction,description) as (
  values
    ('REC-SERVICOS','Receita de serviços','inflow','Receitas provenientes de suporte, consultoria, projetos e demais serviços.'),
    ('REC-LICENCAS','Receita de licenças e assinaturas','inflow','Revenda de licenças, softwares, subscrições e serviços recorrentes.'),
    ('REC-EQUIPAMENTOS','Venda de equipamentos','inflow','Receitas com venda de equipamentos, peças e periféricos.'),
    ('REC-JUROS','Juros e multas recebidos','inflow','Encargos financeiros recebidos de clientes.'),
    ('REC-OUTRAS','Outras receitas','inflow','Demais entradas operacionais ou não operacionais.'),
    ('DES-PESSOAL','Pessoal e remuneração','outflow','Salários, pró-labore, benefícios e demais despesas com pessoas.'),
    ('DES-ENCARGOS','Encargos trabalhistas','outflow','Encargos, provisões e obrigações trabalhistas.'),
    ('DES-FORNECEDORES','Fornecedores e terceiros','outflow','Aquisições e serviços prestados por fornecedores e terceiros.'),
    ('DES-SOFTWARE','Softwares e licenças','outflow','Licenças, assinaturas e ferramentas utilizadas na operação.'),
    ('DES-INFRA','Infraestrutura e datacenter','outflow','Cloud, datacenter, hospedagem, energia e infraestrutura técnica.'),
    ('DES-TELECOM','Telefonia e conectividade','outflow','Internet, links, telefonia e serviços de comunicação.'),
    ('DES-IMPOSTOS','Impostos e tributos','outflow','Impostos, taxas, contribuições e obrigações fiscais.'),
    ('DES-ALUGUEL','Aluguel e ocupação','outflow','Aluguel, condomínio, manutenção predial e utilidades.'),
    ('DES-MARKETING','Marketing e publicidade','outflow','Campanhas, eventos, publicidade e materiais promocionais.'),
    ('DES-VIAGENS','Viagens e deslocamentos','outflow','Combustível, pedágio, estacionamento, hospedagem e viagens.'),
    ('DES-BANCARIAS','Tarifas bancárias','outflow','Tarifas bancárias, adquirência e custos de cobrança.'),
    ('DES-JUROS','Juros e multas pagos','outflow','Juros, multas e encargos financeiros pagos.'),
    ('DES-OUTRAS','Outras despesas','outflow','Demais saídas operacionais ou não operacionais.'),
    ('MOV-TRANSFERENCIAS','Transferências entre contas','both','Transferências internas que podem representar entrada ou saída.'),
    ('MOV-AJUSTES','Ajustes financeiros','both','Ajustes, estornos e regularizações financeiras.')
)
insert into apticket.financial_categories(
  tenant_id,operating_company_id,code,name,direction,description
)
select company.tenant_id,company.id,seed.code,seed.name,seed.direction,seed.description
from apticket.operating_companies company
cross join category_seed seed
where company.is_active and company.deleted_at is null
  and not exists(
    select 1 from apticket.financial_categories current_category
    where current_category.tenant_id=company.tenant_id
      and current_category.operating_company_id=company.id
      and lower(current_category.code)=lower(seed.code)
      and current_category.deleted_at is null
  );

with cost_center_seed(code,name,description) as (
  values
    ('ADM','Administrativo','Administração geral, estrutura corporativa e despesas compartilhadas.'),
    ('COM','Comercial','Prospecção, vendas, relacionamento comercial e pré-vendas.'),
    ('FIN','Financeiro','Tesouraria, cobrança, faturamento, controladoria e contabilidade.'),
    ('SUP','Suporte técnico','Central de atendimento, service desk e suporte aos clientes.'),
    ('PRO','Projetos e implantação','Projetos, implantações, migrações e serviços profissionais.'),
    ('INF','Infraestrutura e NOC','Operação de infraestrutura, datacenter, cloud e monitoramento.'),
    ('MKT','Marketing','Marketing, comunicação, eventos e geração de demanda.'),
    ('PES','Pessoas e RH','Recrutamento, desenvolvimento, benefícios e gestão de pessoas.')
)
insert into apticket.financial_cost_centers(
  tenant_id,operating_company_id,code,name,description
)
select company.tenant_id,company.id,seed.code,seed.name,seed.description
from apticket.operating_companies company
cross join cost_center_seed seed
where company.is_active and company.deleted_at is null
  and not exists(
    select 1 from apticket.financial_cost_centers current_center
    where current_center.tenant_id=company.tenant_id
      and current_center.operating_company_id=company.id
      and lower(current_center.code)=lower(seed.code)
      and current_center.deleted_at is null
  );

notify pgrst,'reload schema';
