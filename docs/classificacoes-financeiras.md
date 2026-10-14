# Tipos e níveis das classificações financeiras

Categorias financeiras e centros de custo aceitam:

| Código | Tipo permitido |
| --- | --- |
| `01` | Sintética |
| `01.01` | Sintética |
| `01.01.0001` | Sintética ou Analítica |

O primeiro nível continua disponível para os grupos existentes. A partir do
segundo nível, o tipo Sintética permanece disponível, inclusive no terceiro.
Somente classificações analíticas ativas recebem lançamentos ou rateios de contratos.

A hierarquia mantém três níveis. Itens sintéticos do terceiro nível não oferecem
ações para criar filhos ou recolher a árvore, pois não há um quarto nível.

A migration `20261014165607_financial_synthetic_third_level.sql` atualiza as RPCs
de gravação sem transformar códigos ou registros existentes. As regras de
permissão, empresa, duplicidade e preservação de classificações utilizadas continuam
nas mesmas funções.

Validação: `supabase/tests/financial_cost_centers_and_categories_test.sql` cobre
as regras do banco. `scripts/test-financial-synthetic-ui.mjs` usa o build web e
fixtures isoladas para verificar cadastro, edição e hierarquia em 1440, 768 e 390 px.
O teste de interface requer `PLAYWRIGHT_MODULE` apontando para o Playwright instalado.
