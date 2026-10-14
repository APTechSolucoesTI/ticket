# Rateios financeiros de contratos

Migration: `supabase/migrations/20261014134553_contract_dimension_allocations.sql`.

Os contratos de clientes e fornecedores possuem dois rateios independentes: categorias financeiras e centros de custo. Cada conjunto exige pelo menos um item, itens distintos e soma exata de 100%. Percentuais aceitam no máximo duas casas e devem ser maiores que zero. O frontend soma centésimos de percentual inteiros; o banco valida com `numeric`, antes de persistir em `numeric(5,2)`.

## Banco, API e compatibilidade

As quatro tabelas filhas são `contracts_category_allocations`, `contracts_cost_center_allocations`, `supplier_contracts_category_allocations` e `supplier_contracts_cost_center_allocations`. Possuem chave por contrato/item, FK de contrato, FK de dimensão/tenant, check de percentual e RLS que segue a visibilidade do contrato. A API recebe `category_allocations` e `cost_center_allocations` na própria gravação do contrato. Triggers validam e normalizam os dois conjuntos e sincronizam os filhos na mesma transação. Os filhos são somente leitura pela API: não podem ser alterados separadamente.

Exemplo de payload, junto aos demais campos do contrato:

```json
{
  "category_allocations": [
    { "item_id": "UUID-CATEGORIA-A", "percentage": "70" },
    { "item_id": "UUID-CATEGORIA-B", "percentage": "30" }
  ],
  "cost_center_allocations": [
    { "item_id": "UUID-CENTRO-A", "percentage": "60" },
    { "item_id": "UUID-CENTRO-B", "percentage": "40" }
  ]
}
```

O banco devolve também `code` e `name` nos itens. Esses valores são preenchidos pelo servidor, sem confiar nos nomes enviados pelo cliente.

As colunas `financial_category_id` e `cost_center_id` permanecem como espelhos do maior percentual, com desempate pelo UUID. Clientes antigos podem continuar enviando os campos individuais; quando um campo individual muda sem alterar seu array, ele substitui o respectivo rateio por um item de 100%. Para editar vários itens, consumidores devem usar os arrays. PATCH que omite os campos preserva os conjuntos atuais.

Vínculos individuais existentes são migrados para 100%. Contratos sem classificação não recebem classificações arbitrárias. Na verificação anterior à implantação, os 76 contratos de clientes ativos estavam sem esses vínculos, e não havia contratos de fornecedores. Eles continuam gerando documentos sem classificação até serem ajustados; sua próxima edição exige preencher ambos os conjuntos. Operações de suspensão, cancelamento e arquivamento preservam o histórico, assim como manutenção automática de contratos legados sem classificação.

Itens precisam ser analíticos, ativos, não excluídos e pertencer à tenant e à empresa operadora, ou ser globais da mesma tenant. Categorias precisam ter natureza compatível. A inativação mantém o histórico; a próxima edição comercial do contrato e a geração de novos documentos classificados exigem substituir itens indisponíveis. Os snapshots de lançamentos anteriores não são reclassificados.

## Lançamentos e relatórios

O trigger existente de contas a receber e contas a pagar guarda os dois rateios na classificação versionada do documento. A geração recorrente e por medição passa por esse trigger. Alterar o contrato não altera documentos já gerados; classificação manual cria uma nova versão com 100% na categoria/centro selecionados, informando isso na interface.

`allocate_financial_amount` calcula cada dimensão separadamente em centavos inteiros: trunca as parcelas e atribui todos os centavos restantes ao maior percentual, com desempate por UUID. Por exemplo, R$ 100,01 em 70%/30% resulta em R$ 70,01/R$ 30,00; os centros de 60%/40% recebem R$ 60,01/R$ 40,00. A interseção dos intervalos cumulativos de centavos produz a matriz categoria × centro e conserva os totais de ambas as dimensões. Não se pressupõe independência estatística entre categoria e centro: não existe um vínculo informado pelo usuário entre esses dois conjuntos. Valores negativos mantêm o sinal; os totais previsto, aberto, realizado e diferença são distribuídos separadamente.

`cash_flow_entries` preserva a API com um registro por documento para integrações existentes. A nova `cash_flow_allocation_entries` expõe parcelas contábeis e snapshots. Nela, `source_id` pode repetir: consumidores identificam linhas por origem + documento + categoria + centro, e contam documentos distintos. A tela de fluxo de caixa e o orçamento usam essa projeção. A DRE, o fechamento e as exportações da DRE consomem os valores do orçamento atualizado. Competências já fechadas continuam usando seus snapshots existentes. Listagens/exportações de contratos e telas de contas a pagar/receber exibem todos os percentuais. Indicadores de receita e lucratividade que usam documentos brutos permanecem com uma linha por documento.

## Aplicar e reverter

No Supabase self-hosted, execute **somente esta migration**, em transação, como proprietário do schema (`supabase_admin` nesta instalação). Antes, faça backup de schema e das tabelas de contratos/classificações. Registre a versão `20261014134553` no histórico `supabase_migrations.schema_migrations` na mesma transação. Na implantação desta entrega, esse procedimento é executado por SSH, sem credenciais no repositório.

Para um ambiente com conexão PostgreSQL configurada, a execução SQL pode ser feita com:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -f supabase/migrations/20261014134553_contract_dimension_allocations.sql
```

O comando acima executa o SQL; o registro no histórico deve ser feito pelo executor de migrations do ambiente. Não execute migrations antigas pendentes indiscriminadamente nesta base compartilhada.

A reversão está em `supabase/rollbacks/20261014134553_contract_dimension_allocations.sql`. Ela restaura triggers e relatórios antigos e remove as estruturas novas. **Não foi aplicada em produção**. Deve ser revisada e autorizada antes de execução, pois remove estruturas. Seu bloqueio inicial impede a reversão se houver rateios múltiplos em contratos ou snapshots financeiros, evitando perda silenciosa desses dados. Nesse caso, mantenha o banco e prepare uma conversão aprovada ou restaure somente a aplicação anterior, preservando os dados. Coordene a reversão com a restauração do commit anterior do frontend.

## Validação

- `node --test scripts/test-contract-allocations.mjs`: cinco testes de parsing decimal, somas, duplicidade, validação independente e transporte.
- `supabase/tests/contract_allocations_test.sql`: 44 verificações transacionais, incluindo quatro vínculos legados, edição, atomicidade, percentuais inválidos, FK/RLS, centavos, geração real de fornecedor, recebível, DRE e snapshots. O executor de pré-implantação insere a migration duas vezes no ponto indicado para testar backfill e idempotência; tudo termina em rollback.
- Reversão simulada em transação preserva o contrato legado.
- A suíte existente `financial_cost_centers_and_categories_test.sql`: 47 testes passaram com a migration aplicada depois dos fixtures.
- Lint dos arquivos alterados e build de produção passaram. O lint global e o typecheck global possuem falhas anteriores à entrega; o typecheck repete os erros registrados em `.codex-contacts-tsc.log`, fora dos arquivos alterados. Outras suítes financeiras antigas também falham no baseline porque seus fixtures omitem a empresa operadora, hoje obrigatória.
- `scripts/test-contract-allocations-ui.mjs`, com `PLAYWRIGHT_MODULE` apontando para Playwright: fluxo real de frontend com APIs isoladas em 1440, 768 e 390 px, incluindo bloqueio, percentuais, itens duplicados, criação, edição e remoção. Evidências locais em `artifacts/contract-allocations/`.

Validação manual após implantação: escolher classificações reais nos contratos legados, conferir permissões do perfil usado, gerar uma medição e comparar os valores por categoria e centro com a DRE/fluxo. Os testes não criam classificações reais nem alteram permanentemente contratos de produção.
