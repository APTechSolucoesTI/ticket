# Seletores com pesquisa

O `components/ui/select.tsx` utiliza Popover e Command, os mesmos componentes usados pelo seletor de clientes dos contatos. A mudança alcança 145 instâncias em 49 arquivos do frontend, incluindo os seis seletores nativos que existiam em contratos do portal, empresa operadora, respostas padrão, status do ticket, técnico responsável e motivo de pausa.

- Pesquisa no topo, lista com rolagem e ação **Concluir**.
- Busca por texto ou código, sem distinção de maiúsculas e acentos; informa quando não encontra opções.
- Mantém os identificadores, callbacks, valores selecionados e permissões dos formulários existentes.
- Campos de seleção única continuam escolhendo um único valor e fecham ao selecionar. **Concluir**, Escape e clique externo fecham sem alterar o valor.
- Foco inicial na pesquisa; setas e Enter navegam e selecionam; Escape retorna ao campo sem fechar o formulário.
- O seletor de clientes dos contatos mantém sua seleção múltipla.
- Opções em ordem alfabética pelo texto exibido, usando português do Brasil, sem diferenciar maiúsculas e acentos e com ordenação natural de números (Empresa 2 antes de Empresa 10). Filtros múltiplos mantêm a ação **Todos/Todas** no início.
- A pesquisa mantém os resultados em ordem alfabética. A ordenação visual não altera os identificadores nem o cliente principal escolhido.
- A roda do mouse movimenta a lista, inclusive nos seletores abertos dentro de formulários modais. O popover impede que o bloqueio de rolagem da janela cancele esse evento; a lista contém a rolagem nos seus limites.
- O único `<select>` restante é invisível, interno ao componente, para compatibilidade com formulários nativos que usem `name` ou `required`.

## Validação

Aplicação compilada, APIs isoladas e navegadores em 1440, 768 e 390 pixels:

- `scripts/test-entry-allocations-ui.mjs`: contas a pagar e receber, busca com acentos, resultado vazio, lista longa, teclado, foco, descarte, rateios, itens desabilitados e gravação dos percentuais.
- `scripts/test-searchable-select-ui.mjs`: status, repetição da mesma resposta padrão, motivo de pausa, identificação e remoção do técnico, somente leitura e troca de empresa operadora com reinício da confirmação.
- `scripts/test-select-options-ui.mjs`: roda do mouse nas duas direções sem mover o formulário/página, ordenação A–Z com acentos e números, resultados filtrados, teclado, filtros múltiplos e preservação do cliente principal. Cobre seleção única, filtros múltiplos e clientes de contatos em 1440, 768 e 390 pixels.
- `scripts/test-financial-synthetic-ui.mjs`: criação e edição de categorias e centros de custo sintéticos e hierarquia.
- `scripts/test-fixed-payables-ui.mjs`: contas fixas, classificações, filtros e confirmação de previsões.

Execução: definir `PLAYWRIGHT_MODULE` com o caminho do Playwright instalado e executar cada script com Node, após o build do frontend. Cada script inicia e encerra seu próprio servidor local. Capturas ficam em `artifacts/`, ignoradas pelo Git.

Lint dos arquivos alterados e build do frontend. Os 17 erros anteriores de TypeScript em `payable-suppliers`, configurações Inter e contatos do portal foram corrigidos; os typechecks completos do frontend e do backend passam sem erros.

Não há alteração no banco ou migration nesta entrega. Publicação somente do frontend, pelo fluxo GitHub → Dokploy.
