-- Repara a carga inicial que pode ter sido transmitida por um terminal Windows
-- sem suporte a UTF-8. Os literais abaixo sao ASCII e usam escapes Unicode do
-- PostgreSQL, tornando a migration independente da codificacao do executor.
with corrected(code,name,description) as (
  values
    ('REC-SERVICOS',U&'Receita de servi\00E7os',U&'Receitas provenientes de suporte, consultoria, projetos e demais servi\00E7os.'),
    ('REC-LICENCAS',U&'Receita de licen\00E7as e assinaturas',U&'Revenda de licen\00E7as, softwares, subscri\00E7\00F5es e servi\00E7os recorrentes.'),
    ('REC-EQUIPAMENTOS','Venda de equipamentos',U&'Receitas com venda de equipamentos, pe\00E7as e perif\00E9ricos.'),
    ('REC-JUROS','Juros e multas recebidos','Encargos financeiros recebidos de clientes.'),
    ('REC-OUTRAS','Outras receitas',U&'Demais entradas operacionais ou n\00E3o operacionais.'),
    ('DES-PESSOAL',U&'Pessoal e remunera\00E7\00E3o',U&'Sal\00E1rios, pr\00F3-labore, benef\00EDcios e demais despesas com pessoas.'),
    ('DES-ENCARGOS','Encargos trabalhistas',U&'Encargos, provis\00F5es e obriga\00E7\00F5es trabalhistas.'),
    ('DES-FORNECEDORES','Fornecedores e terceiros',U&'Aquisi\00E7\00F5es e servi\00E7os prestados por fornecedores e terceiros.'),
    ('DES-SOFTWARE',U&'Softwares e licen\00E7as',U&'Licen\00E7as, assinaturas e ferramentas utilizadas na opera\00E7\00E3o.'),
    ('DES-INFRA','Infraestrutura e datacenter',U&'Cloud, datacenter, hospedagem, energia e infraestrutura t\00E9cnica.'),
    ('DES-TELECOM','Telefonia e conectividade',U&'Internet, links, telefonia e servi\00E7os de comunica\00E7\00E3o.'),
    ('DES-IMPOSTOS','Impostos e tributos',U&'Impostos, taxas, contribui\00E7\00F5es e obriga\00E7\00F5es fiscais.'),
    ('DES-ALUGUEL',U&'Aluguel e ocupa\00E7\00E3o',U&'Aluguel, condom\00EDnio, manuten\00E7\00E3o predial e utilidades.'),
    ('DES-MARKETING','Marketing e publicidade','Campanhas, eventos, publicidade e materiais promocionais.'),
    ('DES-VIAGENS','Viagens e deslocamentos',U&'Combust\00EDvel, ped\00E1gio, estacionamento, hospedagem e viagens.'),
    ('DES-BANCARIAS',U&'Tarifas banc\00E1rias',U&'Tarifas banc\00E1rias, adquir\00EAncia e custos de cobran\00E7a.'),
    ('DES-JUROS','Juros e multas pagos','Juros, multas e encargos financeiros pagos.'),
    ('DES-OUTRAS','Outras despesas',U&'Demais sa\00EDdas operacionais ou n\00E3o operacionais.'),
    ('MOV-TRANSFERENCIAS',U&'Transfer\00EAncias entre contas',U&'Transfer\00EAncias internas que podem representar entrada ou sa\00EDda.'),
    ('MOV-AJUSTES','Ajustes financeiros',U&'Ajustes, estornos e regulariza\00E7\00F5es financeiras.')
)
update apticket.financial_categories target
set name=corrected.name,
    description=corrected.description,
    updated_at=clock_timestamp()
from corrected
where target.code=corrected.code
  and target.deleted_at is null
  and (target.name like '%?%' or coalesce(target.description,'') like '%?%');

with corrected(code,name,description) as (
  values
    ('ADM','Administrativo',U&'Administra\00E7\00E3o geral, estrutura corporativa e despesas compartilhadas.'),
    ('COM','Comercial',U&'Prospec\00E7\00E3o, vendas, relacionamento comercial e pr\00E9-vendas.'),
    ('FIN','Financeiro',U&'Tesouraria, cobran\00E7a, faturamento, controladoria e contabilidade.'),
    ('SUP',U&'Suporte t\00E9cnico','Central de atendimento, service desk e suporte aos clientes.'),
    ('PRO',U&'Projetos e implanta\00E7\00E3o',U&'Projetos, implanta\00E7\00F5es, migra\00E7\00F5es e servi\00E7os profissionais.'),
    ('INF','Infraestrutura e NOC',U&'Opera\00E7\00E3o de infraestrutura, datacenter, cloud e monitoramento.'),
    ('MKT','Marketing',U&'Marketing, comunica\00E7\00E3o, eventos e gera\00E7\00E3o de demanda.'),
    ('PES','Pessoas e RH',U&'Recrutamento, desenvolvimento, benef\00EDcios e gest\00E3o de pessoas.')
)
update apticket.financial_cost_centers target
set name=corrected.name,
    description=corrected.description,
    updated_at=clock_timestamp()
from corrected
where target.code=corrected.code
  and target.deleted_at is null
  and (target.name like '%?%' or coalesce(target.description,'') like '%?%');

notify pgrst,'reload schema';
