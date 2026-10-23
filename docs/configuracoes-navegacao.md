# Navegação das configurações

Implementação de 23/10/2026. As configurações passaram a ter páginas próprias e submenus expansíveis no menu lateral. /settings permanece como uma visão geral com links e descrições das áreas autorizadas.

## Organização e endereços

| Grupo | Configuração | Endereço |
| --- | --- | --- |
| Configurações | Empresa | /settings/company |
| Parâmetros financeiros | Preferências financeiras | /settings/financial/preferences |
| Parâmetros financeiros | Empresa Operadora | /settings/financial/operating-companies |
| Parâmetros financeiros → Integrações bancárias | Banco Inter | /settings/financial/banking/inter |
| Cadastros | Departamentos | /settings/catalogs/departments |
| Cadastros | Família de Serviços | /settings/catalogs/service-families |
| Cadastros | Serviços Prestados | /settings/catalogs/provided-services |
| Cadastros | Tipos de Contratos | /settings/catalogs/contract-types |
| Cadastros | SLAs | /settings/catalogs/slas |
| Cadastros | Respostas Padrão | /settings/catalogs/canned-responses |
| Cadastros | Figurinhas | /settings/catalogs/stickers |
| Integrações | Canais | /settings/integrations/channels |
| Integrações | Automações | /settings/integrations/automations |
| Permissões e acessos | Usuários | /settings/access/users |
| Permissões e acessos | Papéis | /settings/access/roles |
| Permissões e acessos | Permissões | /settings/access/permissions |

“Preferências financeiras” diferencia os parâmetros da área operacional Financeiro. “Papéis” mantém a terminologia usada na matriz de acesso. As abas internas específicas de um recurso, como canais de entrada/saída, continuam dentro da respectiva página.

## Comportamento e permissões

- Os grupos são organizacionais: expandir um grupo não altera permissões.
- Menu, visão geral e páginas usam o mesmo catálogo de seções e a mesma verificação de acesso.
- Toda seção exige configuracoes.view e a visualização do módulo correspondente. Banco Inter exige também financeiro.view e empresa_operadora.view, além de financeiro_bancos.view.
- Empresa Operadora usa empresa_operadora.view sem exigir acesso aos bancos. Isso corrige as condições trocadas dos conteúdos das abas anteriores.
- Grupos sem configurações autorizadas ficam ocultos. O acesso direto por URL também é bloqueado antes de montar o formulário e suas consultas.
- Os controles existentes de criação, edição e exclusão continuam nos formulários e no banco/API. O papel de sistema Admin conserva acesso integral.
- As páginas suportam atualização, links diretos e histórico do navegador. O caminho no topo permite voltar à visão geral.
- No celular/tablet, expandir grupos mantém o menu aberto; selecionar uma página fecha o menu.

Não há alteração de esquema, catálogo de permissões ou dados; esta entrega não exige migration do Supabase.

## Implementação

- apps/web/src/lib/settings-navigation.ts: hierarquia, rótulos, endereços e regras compartilhadas.
- apps/web/src/components/settings/settings-navigation.tsx: submenus recursivos com controles acessíveis.
- apps/web/src/components/settings/settings-layout.tsx: cabeçalho, caminho e proteção da área.
- apps/web/src/components/settings/settings-section.tsx: proteção da seção e contexto de permissões.
- apps/web/src/components/settings/settings-sections.tsx: formulários extraídos da antiga rota unificada.
- apps/web/src/routes/_authenticated/settings*.tsx: layout, visão geral e 16 rotas de conteúdo.

## Validação

- Build de produção com NITRO_PRESET=node-server, typecheck e ESLint dos arquivos alterados.
- node scripts/security/test-settings-navigation.mjs: incluído no CI; valida acesso Admin, permissões da raiz/seção/pai, independência de Empresa Operadora, grupos vazios e ligação das 16 rotas aos conteúdos protegidos.
- node scripts/security/test-server-functions.mjs: regressão HTTP das funções de servidor.
- node scripts/test-settings-navigation-ui.mjs: aplicação compilada real com identidades fictícias e APIs locais, sem acesso aos dados de produção. Requer PLAYWRIGHT_MODULE apontando para uma instalação de playwright-core e PLAYWRIGHT_CHROMIUM apontando para o executável Chromium.
- Navegador: 16 páginas, matriz Admin, histórico, atualização em URL interna, menu bancário em três níveis, somente leitura, bloqueio de URL sem permissão, grupos ocultos e regressão do menu de contratos de fornecedores.
- Inspeção visual em 1440, 820 e 390 pixels, sem erros JavaScript. Capturas ficam na pasta temporária apticket-settings-navigation, ou no destino informado em SETTINGS_SCREENSHOTS.
- O teste existente scripts/test-financial-settings-ui.mjs foi atualizado para o novo endereço das preferências financeiras.

## Publicação em produção

- Código publicado em main no commit dec77f524a4b076fc89ab5eef325c1fcc5448510.
- [CI do lote](https://github.com/APTechSolucoesTI/ticket/actions/runs/39946184632): cinco jobs aprovados, incluindo aplicação, suíte SQL completa, isolamento de sessão, dependências e segredos. O lint global do frontend passou no Linux.
- Deploy do frontend pelo fluxo GitHub → Dokploy: nkqH4iWo0AfjIOB6MZKx3, iniciado em 23/10/2026 às 11:30:02 UTC e concluído. Atualização do serviço Swarm concluída; container novo saudável, com Node v22.23.4.
- As 16 rotas foram identificadas no JavaScript compilado do container. Conferência do checkout confirmou o mesmo commit aprovado no CI.
- Visão geral e 16 URLs internas responderam HTTP 200 pelo domínio de produção, com TLS validado e cabeçalhos CSP, HSTS e nosniff. Esse check sem autenticação verifica publicação e roteamento; a navegação autenticada e os bloqueios por perfil foram testados na aplicação local com dados fictícios.
- Revisão somente de leitura no banco de produção: dois administradores de sistema ativos, nenhuma permissão do catálogo ausente.
- Não houve migration ou deploy da API neste lote. Atualizações somente deste registro de publicação não exigem recompilar a aplicação.
