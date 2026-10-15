# Seletores com pesquisa

O `components/ui/select.tsx` utiliza Popover e Command, os mesmos componentes usados pelo seletor de clientes dos contatos. A mudança alcança 145 instâncias em 49 arquivos do frontend, incluindo os seis seletores nativos que existiam em contratos do portal, empresa operadora, respostas padrão, status do ticket, técnico responsável e motivo de pausa.

- Pesquisa no topo, lista com rolagem e ação **Concluir**.
- Busca por texto ou código, sem distinção de maiúsculas e acentos; informa quando não encontra opções.
- Mantém os identificadores, callbacks, valores selecionados e permissões dos formulários existentes.
- Campos de seleção única continuam escolhendo um único valor e fecham ao selecionar. **Concluir**, Escape e clique externo fecham sem alterar o valor.
- Foco inicial na pesquisa; setas e Enter navegam e selecionam; Escape retorna ao campo sem fechar o formulário.
- O seletor de clientes dos contatos mantém sua seleção múltipla.
- O único `<select>` restante é invisível, interno ao componente, para compatibilidade com formulários nativos que usem `name` ou `required`.

## Validação

Aplicação compilada, APIs isoladas e navegadores em 1440, 768 e 390 pixels:

- `scripts/test-entry-allocations-ui.mjs`: contas a pagar e receber, busca com acentos, resultado vazio, lista longa, teclado, foco, descarte, rateios, itens desabilitados e gravação dos percentuais.
- `scripts/test-searchable-select-ui.mjs`: status, repetição da mesma resposta padrão, motivo de pausa, identificação e remoção do técnico, somente leitura e troca de empresa operadora com reinício da confirmação.
- `scripts/test-financial-synthetic-ui.mjs`: criação e edição de categorias e centros de custo sintéticos e hierarquia.
- `scripts/test-fixed-payables-ui.mjs`: contas fixas, classificações, filtros e confirmação de previsões.

Execução: definir `PLAYWRIGHT_MODULE` com o caminho do Playwright instalado e executar cada script com Node, após o build do frontend. Cada script inicia e encerra seu próprio servidor local. Capturas ficam em `artifacts/`, ignoradas pelo Git.

Lint dos arquivos alterados e build do frontend. O typecheck completo mantém os erros anteriores em `payable-suppliers`, configurações Inter e contatos do portal, sem novos erros nos componentes alterados.

Não há alteração no banco ou migration nesta entrega. Publicação somente do frontend, pelo fluxo GitHub → Dokploy.
