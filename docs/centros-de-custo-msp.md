# Centros de custo globais para MSP

Carga de dados da organização APTech: **44 cadastros ativos e globais**,
sendo **17 sintéticos** para agrupamento e **27 analíticos** disponíveis nos
lançamentos, contratos e rateios financeiros.

| Grupo | Área | Centros analíticos |
| --- | --- | ---: |
| 01 | Operações MSP: Service Desk N1, suporte N2/N3 e de campo, NOC, RMM e ITSM | 7 |
| 02 | Infraestrutura e Nuvem: servidores, redes, hosting, backup e Microsoft 365 | 5 |
| 03 | Segurança da Informação: SOC, proteção gerenciada e governança | 3 |
| 04 | Projetos e Consultoria: implantação, migração e arquitetura de soluções | 2 |
| 05 | Relacionamento e Comercial: sucesso do cliente, vendas e marketing | 3 |
| 06 | Administração e Pessoas: financeiro, administrativo, RH e diretoria | 4 |
| 07 | Tecnologia e Desenvolvimento: TI interna, integrações e inovação | 3 |

Os códigos seguem a hierarquia existente: `99` e `99.99` para grupos sintéticos,
e `99.99.9999` para os centros analíticos. As descrições representam as equipes
responsáveis pelos custos; não substituem as categorias financeiras de despesas.

Todos utilizam `is_global = true`, ficando disponíveis às duas empresas
operadoras da mesma organização, conforme as permissões financeiras existentes.
A operadora APTech é apenas a referência de criação; o centro global também pode
ser utilizado pela operadora Alta Performance. Nenhuma outra organização recebe
esses dados.

A migration `20261015100007_seed_msp_global_cost_centers.sql` preserva os cadastros
existentes, não duplica códigos ao ser executada novamente e interrompe a carga
integralmente caso encontre um código ocupado por cadastro incompatível.
As inserções utilizam a auditoria financeira existente, identificadas como carga
de banco. Não há alteração de schema, permissões, RLS ou regras de lançamento.
