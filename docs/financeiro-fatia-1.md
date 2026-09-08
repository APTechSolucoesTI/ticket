# Financeiro MSP: fatia 1 para revisão

## Escopo entregue

Fundação de dados opt-in para os contratos existentes. O motor de medição,
as cobranças atuais e o gate de tickets não são substituídos nem ativados por
esta migration. Nenhum cadastro existente é copiado, apagado ou vinculado
automaticamente a uma empresa operadora.

| Tabela | Responsabilidade |
| --- | --- |
| `operating_companies` | Empresas operadoras do MSP dentro de um tenant. `companies` continua sendo o cadastro de clientes. |
| `financial_access` | Concessão explícita por usuário/empresa; empresa nula representa escopo de grupo. `can_write` diferencia leitura/escrita. |
| `contract_financial_terms` | Extensão 1:1 do contrato: empresa operadora, periodicidade de cobrança, corte, índice/percentual editável, intervalo, data-base e antecedência do reajuste. |
| `contract_value_versions` | Valor-base exato com início de vigência, índice aplicado, percentual, motivo e autor. Novas versões não sobrescrevem anteriores. |
| `consumption_snapshots` | Uma apuração imutável por contrato/ciclo/métrica, compartilhável entre AR e AP. Quantidade, franquia, quantidade faturável, preço e evidências congeladas. |
| `financial_audit_log` | Registro automático de inclusões/alterações, exclusão lógica e concessões/revogações, com antes/depois, autor, instante, origem e papel de banco. |

## Regras e segurança

- RLS nas seis tabelas; chaves compostas impedem misturar tenant, empresa,
  contrato e versão mesmo nas operações de backend.
- `has_financial_scope` reutiliza a identidade ativa e as permissões existentes
  `financeiro:view/edit`, além da concessão explícita de empresa/grupo.
  O perfil Admin sozinho **não** concede escopo de grupo.
- O cliente consulta apenas suas próprias concessões. Provisionamento e
  revogação de escopo são exclusivos do backend confiável nesta etapa;
  não há endpoint que permita autoelevação de privilégios.
- Sem privilégios de escrita para anônimos. Snapshots só são gravados pelo
  backend. Auditoria não aceita escrita direta nem pelo `service_role`.
- Triggers bloqueiam DELETE/TRUNCATE e alteração de identidade/tenant/empresa.
  Dados financeiros têm `deleted_at`; os clientes consumidores devem filtrar
  `deleted_at is null` nos cadastros ativos. A leitura histórica permanece
  disponível ao usuário autorizado. Auditoria é append-only, sem exclusão lógica.
- Histórico e snapshots preservam todo o conteúdo; somente o backend pode
  marcar `deleted_at`. Não é permitido reutilizar ciclos/versões apagados.
- `validate_version` serializa inserções por contrato, valida ordem de vigência,
  arredondamento do reajuste e impede alterar ciclos já apurados.
- `validate_snapshot` rejeita ciclos duplicados/sobrepostos da mesma métrica e
  versões inadequadas ao período. Um reajuste dentro do ciclo exige dividi-lo.
- `guard_record` e `audit_record` são triggers privados, não endpoints RPC.
  O único `SECURITY DEFINER` novo grava auditoria, com `search_path` fixo e
  execução pública revogada. Consultas e validações usam `SECURITY INVOKER`.
- A view `contract_value_periods` usa `security_invoker=true` e deriva o fim
  exclusivo da vigência com `lead()`, sem atualizar a versão anterior.

## Convenções para a próxima integração

1. Provisionar explicitamente empresa e acesso no backend após validar o
   administrador e o tenant. A primeira concessão não é automática nem
   inferida dos administradores existentes.
2. Cadastrar `contract_financial_terms` para o contrato existente. Na mesma
   transação, inserir sua primeira `contract_value_versions` sem índice ou
   percentual aplicado, com o valor-base aprovado. Não inferir valor fixo de
   contratos por equipamento/serviço a partir do total de uma medição.
3. Um reajuste insere nova versão, com motivo e data de vigência posterior.
   Se houver percentual, `base_amount = round(valor_anterior * (1 + p/100), 2)`.
   Percentuais negativos superiores a -100% são suportados. Valores sempre
   `numeric`, nunca ponto flutuante.
4. `adjustment_base_date` é a primeira data de reajuste previsto; intervalo em
   meses e antecedência ficam armazenados para a futura consulta de alertas.
   O percentual editável é uma proposta; a versão guarda o efetivamente aplicado.
5. Ciclos usam `[cycle_start, cycle_end)`, final exclusivo. Quantidade faturável
   é `greatest(measured_quantity - included_quantity, 0)`.
6. Métricas: `active_users`, `devices`, `excess_tickets`, `technical_hours`.
   `source_type` identifica o apurador e `source_items` é um array de objetos
   com as referências e evidências congeladas. IDs de equipamentos ou itens de
   medição podem integrar essas evidências. Os futuros apuradores deverão
   normalizar e conferir as evidências; esta fatia não implementa a coleta.
7. AR e AP deverão referenciar o mesmo snapshot, não recalcular as origens.
   O job deverá reconhecer uma apuração já existente pelo contrato/período/
   métrica. A restrição impede duplicação; o tratamento de retry pertence ao job.
8. `created_by` é obtido da sessão nas versões/snapshots. Execuções de serviço
   sem usuário têm autor nulo e origem `database_or_job`; chamadas autenticadas
   registram `authenticated_request`. Não registrar tokens/senhas nos snapshots.

## Validação e implantação

Migration: `supabase/migrations/20260908151630_financial_foundation.sql`.
Testes pgTAP: `supabase/tests/financial_foundation_test.sql`, transacionais e com
rollback dos fixtures. Validam RLS, escopo de grupo, acesso indevido, versões,
franquia, auditoria, imutabilidade, precisão e exclusão lógica.

A migration deve ser aplicada em transação junto ao registro em
`supabase_migrations.schema_migrations`. Não depende de alteração no frontend,
rebuild Docker ou configuração de gateway. Faz reload do schema PostgREST.

Validação em 08/09/2026: migration aplicada e registrada em uma transação;
44 testes desta fatia e 31 testes de regressão do motor de medições passaram
após a aplicação. Fixtures removidos por rollback. Backup prévio do schema:
`/home/administrador/apticket-backups/apticket_schema_before_financial_foundation_20260908.sql.gz`
no servidor. Esse backup é estrutural, não um backup de dados financeiros.

Seguindo o skill Supabase, RLS/grants foram entregues junto ao schema. O comando
de advisors não conseguiu acessar o pooler self-hosted (identificador de tenant
exigido). Foram executadas verificações diretas de catálogo por SSH: zero tabelas
novas sem RLS, zero grants anônimos, zero privilégios DELETE/TRUNCATE para os
papéis da API e zero funções definer privadas expostas/inseguras quanto ao
`search_path`. Isso não equivale a uma execução completa do advisor.

## Ainda não entregue nesta fatia

- Telas de empresas/acessos/reajustes e alertas de janela de reajuste.
- Alteração da vigência indeterminada no contrato legado (`ends_at` permanece
  obrigatório) e integração das periodicidades/corte com o motor existente.
- Coleta automática de consumo e ponte com medições existentes.
- Faturas compostas, fechamento automático, pró-rata e alçadas.
- Gateways, boletos/PIX/cartão, webhooks, CNAB/OFX e conciliação.
- AP, rateio, fluxo de caixa, dashboard e consolidação.
- Eventos de negócio e Edge Functions: nenhum criado nesta fatia.
- Migração do financeiro legado para isolamento por empresa: as políticas
  existentes não foram alteradas; o isolamento novo cobre apenas estas tabelas.

**Ponto de revisão:** validar esta estrutura e o provisionamento explícito
antes de avançar para a próxima fatia. Não ativar automações financeiras até
concluir a integração e os testes do respectivo fluxo.
