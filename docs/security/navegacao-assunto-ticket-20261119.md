# Abertura do ticket pelo assunto — 19/11/2026

## Causa

O layout de `/tickets` verificava somente a rota de detalhe resolvida. Durante a transição para `/tickets/$id`, continuava montando a listagem. Como o link não leva o tamanho da página, o efeito de restauração dessa preferência interpretava a ausência como uma inicialização da listagem e navegava de volta para `/tickets`.

A reprodução em navegador registrou a passagem pela URL do ticket seguida do retorno à listagem, sem nenhuma consulta ao detalhe e sem erro JavaScript.

## Correção

O layout reconhece tanto a rota de detalhe resolvida quanto a navegação pendente, independentemente dos parâmetros de busca. Assim, os efeitos de paginação da listagem são desmontados antes de interferirem na entrada do ticket. Links, regras de permissão e a rotina de atribuição do atendimento permanecem nos componentes existentes.

## Verificação

O teste real da aplicação em `scripts/security/test-ticket-ui.mjs` reproduziu a falha antes da correção e passou depois, verificando:

- Clique no assunto carrega o ticket selecionado e apresenta a confirmação de início.
- Confirmar atribui somente esse ticket ao técnico e muda o status para atendimento.
- URL direta abre o detalhe sem inicializar a paginação da listagem.
- Enter no assunto funciona em uma listagem filtrada/paginada; escolher somente leitura não inicia outro atendimento.
- Voltar pelo histórico restaura busca, página e tamanho da página.
- As regressões existentes de paginação remota/offline, preferências de colunas, lista/kanban, erros seguros, teclado, temas e três tamanhos de tela continuam passando.

Typecheck, build e lint da rota passaram. O job de navegador do CI também executa essa jornada com build e serviços de teste isolados, sem usar dados ou credenciais de produção. Não há alteração de banco ou API.
