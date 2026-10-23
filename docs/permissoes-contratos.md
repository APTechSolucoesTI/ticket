# Permissões de contratos de clientes e de fornecedores

## Configuração dos acessos

Em **Configurações → Papéis**, os contratos têm dois controles independentes:

| Área | Ações |
| --- | --- |
| Contratos de clientes | Visualiza, Cria, Edita e Exclui |
| Contratos de fornecedores | Visualiza, Cria, Edita e Exclui |

As mesmas áreas aparecem em **Configurações → Permissões**, para exceções
individuais de usuários com papéis personalizados. O módulo interno `contratos`
continua representando clientes, preservando os vínculos e regras existentes.
Fornecedores usam o novo módulo `contratos_fornecedores`.

O grupo **Contratos** do menu mostra somente as áreas permitidas. Usuários com
acesso apenas a fornecedores conseguem abrir o grupo e sua página sem receber
acesso a clientes ou à tela de Contas a pagar. O acesso direto pelas URLs também
é verificado; esconder itens do menu não é a única proteção.

Para fornecedores, as ações de criar, editar e excluir são independentes na
interface e no banco. A exclusão permanece um arquivamento controlado: contratos
com medições não podem ser excluídos. O escopo de empresas operadoras é preservado
pelo cadastro existente de acesso por empresa (`financial_access`). Admin e
Financeiro mantêm seu escopo de grupo dentro da própria organização.

O formulário consulta somente os dados de referência necessários de fornecedores,
empresas, categorias e centros de custo. Isso não concede acesso às respectivas
telas de cadastro ou aos lançamentos financeiros. A geração de medições e
lançamentos de fornecedores exige a edição do contrato **e** a autorização
financeira correspondente; o histórico financeiro exige sua permissão de leitura.

## Administradores

O papel **Admin de sistema** mantém acesso integral a todas as permissões do
catálogo, inclusive quando uma nova área é adicionada. Essa condição usa o
marcador protegido de papel de sistema, não um nome arbitrário de papel.

As matrizes de Papéis e Permissões refletem esse acesso integral. Uma exceção
individual anterior não restringe um usuário enquanto ele estiver nesse papel,
e novas revogações individuais são recusadas também pelo banco. Para restringir
um administrador, atribua um papel personalizado com as permissões desejadas.
As regras que impedem alterar o próprio papel e escalar privilégios permanecem.

Acesso integral refere-se à própria organização. Isolamento entre tenants,
exigência de sessão válida, bloqueio de usuário inativo e regras de integridade
dos registros continuam em vigor.

## Migração dos acessos existentes

Migration: `20261023103945_split_supplier_contract_permissions.sql`.

- As permissões de clientes e seus vínculos são preservados.
- O acesso legado de fornecedores é derivado de Contas a pagar e dos pré-requisitos
  de Financeiro: leitura origina a nova leitura; edição origina as novas ações
  de criar, editar e excluir.
- Concessões e revogações individuais são copiadas. A migração compara também
  o acesso efetivo anterior, conservando restrições que vinham do módulo pai
  Financeiro, sem ampliar silenciosamente o acesso.
- Todos os papéis de sistema existentes recebem as entradas novas. A resolução
  efetiva garante acesso integral mesmo a futuras entradas do catálogo.
- Em organizações novas, Admin recebe tudo; Financeiro recebe os contratos de
  fornecedores; Agente e Solicitante não recebem essa área por padrão.

Depois da migração, mudanças em Contas a pagar não alteram automaticamente o
acesso a contratos de fornecedores: cada área passa a ser administrada na sua
própria linha da matriz. Atualize a página após a publicação para carregar os
novos controles; os administradores não precisam ter seus papéis reatribuídos.

## Validação e reversão

A suíte inclui cenários com acesso somente a clientes, somente a fornecedores,
somente a Contas a pagar e leitura de fornecedores, além de ações CRUD separadas,
escopo por empresa, tenant estrangeiro, promoção a Admin com uma revogação antiga
e novas permissões no catálogo. Há uma verificação adicional de migração com
dados sintéticos anteriores à mudança, incluindo restrição no pai Financeiro.

As interfaces de Papéis e Permissões são verificadas em 1440, 820 e 390 pixels
com dados fictícios; o cenário de fornecedores também verifica menu e recusa da
rota de clientes. Não são usados registros de clientes nessas evidências.

O [rollback](../supabase/rollbacks/20261023103945_split_supplier_contract_permissions.sql)
restaura as funções e policies anteriores e remove o catálogo de fornecedores.
Ele deve ser executado transacionalmente e em conjunto com a reversão do
frontend; a interface nova depende do contrato novo. A remoção do catálogo
também remove seus vínculos e exceções individuais: antes de reverter uma
instalação já configurada após a migração, preserve esses ajustes.

O rollback suspende apenas o trigger de proteção de exclusão dos vínculos de
papéis de sistema durante a remoção transacional do catálogo e o reativa na
mesma transação. Não desabilita RLS, verificação de sessão ou controles de outros
sistemas no Supabase compartilhado.

## Publicação de 23/10/2026

- Código publicado: `487f5639f0092ce6eb077635869f076eb1f54524`.
- [CI aprovado nos cinco jobs](https://github.com/APTechSolucoesTI/ticket/actions/runs/39943249125),
  incluindo lint global Linux, builds, tipos, sessões, dependências e segredos.
- Suíte SQL completa: **42 arquivos e 1.606 asserções**, mais quatro verificações
  do backfill de anexos e nove do backfill de permissões. O novo arquivo de
  permissões contém 32 verificações. Reversão/reaplicação também aprovadas.
- Verificação visual com dados fictícios em desktop, tablet e celular, incluindo
  o aviso de acesso integral do Admin e o menu de usuário exclusivo de fornecedores.
- Migration aplicada e registrada transacionalmente em **23/10 às 08:09:33 de
  Brasília** (`11:09:33Z`). SHA-256 canônico do SQL:
  `9e0a0e1c9ddaea20b49d2b96b0cd36075f2ec35c630f95d2153f9ec2548578f0`.
- Revisão em produção: **dois administradores ativos, zero permissões ausentes**,
  quatro permissões de fornecedores e nenhum vínculo faltante nos papéis de
  sistema. A consulta de referências funcionou no contexto autenticado desses
  administradores e o escopo de outro tenant foi recusado.
- Frontend publicado via GitHub → Dokploy, deployment `done` criado em
  `2026-10-23T11:09:44.079Z`. Swarm concluído, novo container e commit conferidos;
  frontend/API HTTP 200. HTTPS público validado com CSP com nonce, HSTS e nosniff.
- Backup prévio do schema e das configurações de acesso, SQL de reversão e
  registros da execução restritos à área de backup do servidor. Nenhuma linha
  de cliente foi exportada para a estação nos testes ou na revisão dos usuários.
