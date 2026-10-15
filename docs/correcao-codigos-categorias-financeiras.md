# Correção dos códigos de categorias financeiras

Correção do cadastro da organização APTech, limitada às sequências de Impostos,
Custos e RH/Departamento Pessoal. A máscara dos códigos existentes já era válida;
o problema estava na hierarquia: faltavam os subgrupos sintéticos e, em Custos e
RH, o segundo nível era incrementado junto com o terceiro.

O padrão configurado é `99` → `99.99` → `99.99.9999`. Foram criados os subgrupos
globais sintéticos `02.01 — Impostos e Taxas`, `03.01 — Custos Operacionais` e
`04.01 — Pessoal e Benefícios`.

| Área | Correção | Categorias com código alterado |
| --- | --- | ---: |
| Impostos | `02.02.0001…0007` → `02.01.0001…0007` | 7 |
| Custos | Segundo nível fixado em `03.01`; terceiro nível `0001…0014` | 13 |
| RH/Departamento Pessoal | Segundo nível fixado em `04.01`; terceiro nível `0001…0018` | 17 |

Os primeiros itens de Custos (`03.01.0001`) e RH (`04.01.0001`) já tinham o código
correto e foram mantidos. Ao todo, 37 categorias foram corrigidas; o cadastro
passou de 70 para 73 categorias não arquivadas, por conta dos três subgrupos.

A migration `20261015101313_repair_aptech_financial_category_codes.sql` mantém os
IDs das categorias, nomes, natureza, escopo global, status e referências por chave
estrangeira. Registros arquivados e snapshots históricos são preservados.
As novas categorias sintéticas herdam a operadora e a natureza de seus grupos.
As alterações são registradas pela auditoria financeira existente.

O mapeamento é explícito por ID e código anterior. A transação interrompe a carga
caso encontre alteração concorrente ou colisão de código; a execução repetida
não modifica os registros já corrigidos. Não há alteração de regras, permissões,
RLS ou interface.

Validação transacional: mapeamento completo, inexistência de categorias órfãs,
preservação dos 77 IDs existentes e de todos os atributos de negócio, repetição
sem alterações e aceitação das categorias corrigidas nos rateios das duas
empresas operadoras, respeitando sua natureza cadastrada.
