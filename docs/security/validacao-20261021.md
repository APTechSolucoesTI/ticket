# Correções de produção — 21/10/2026

Continuação autorizada da [auditoria](./auditoria-20261019.md) e da [validação anterior](./validacao-20261020.md). Estado de trabalho; resultados de implantação serão registrados após migrations e deploys efetivos.

## Acompanhamento

- [x] Corrigir os erros de formatação que impediam o CI do frontend. Lint local sem erros; avisos de organização de exports continuam visíveis.
- [x] Atualizar a auditoria de dependências: nove avisos novos em Vite/launch-editor; corrigidos com Vite 8.2.4 e launch-editor 2.14.2. Audit novamente sem avisos.
- [x] Preparar contador compartilhado e atômico para os limites existentes do portal/perfil, sem IP/e-mail em claro. 14 asserções SQL e 16 requisições concorrentes reais passaram; exatamente cinco aceitas numa quota de cinco.
- [x] Preparar restrição de leitura/escrita de credenciais e migrar as notificações/CSAT legadas do web para a API. 14 asserções SQL de grants, rollback/reaplicação e testes da API passaram. Nenhum valor real de credencial foi retornado ou registrado.
- [x] Preparar headers web/API e CSP com nonce único. Testes HTTP e Chromium verificam scripts, hidratação e interação, sem isenção de inline/eval para scripts. Zod usa modo sem JIT no navegador.
- [ ] Aplicar limites dos handlers de autenticação após decisão sobre a política proposta.
- [ ] Concluir vínculo imutável dos anexos ao ticket e tratar caminhos legados.
- [ ] Concluir política uniforme de conteúdo/limite de uploads; aguardando decisão sobre formatos e antivírus.
- [ ] Reconciliar fixtures históricas e completar a matriz SQL/CRUD dos tenants.
- [x] Publicar o primeiro lote validado: migrations de contador e grants, API, frontend e verificação HTTPS. Os complementos de anexos/SQL ainda estão em trabalho.

## Primeiro lote implantado

Commit de aplicação `ad7d7e2f7725f5c19d3e6cacf3cc76ad77ce6530`, com commits separados para formatação, dependências, headers, contador e credenciais. O [CI desse lote](https://github.com/APTechSolucoesTI/ticket/actions/runs/39667581702) concluiu **todos os quatro jobs com sucesso**. Inclui o lint global do frontend, 81 testes da API, builds/typechecks, regressões HTTP, SMTP/TLS, SSRF, Edge, audit, segredos e o contrato SQL com 34 + 18 + 14 + 14 asserções, reversão/reaplicação e concorrência real.

Ordem de implantação e evidências:

- Migration `20261021193010` aplicada e registrada em transação; SHA-256 `7caaad044bc7f6ee146b29331830ce0dc7a6f7fedf177a337f5ea385e48c8421`. A RPC é exclusiva de service role. Um teste transacional em produção aceitou a primeira tentativa e recusou a segunda numa quota de um, depois fez rollback.
- API do commit acima implantada primeiro: deployment `done`, criado em `2026-10-21T20:08:18.228Z`; atualização Swarm concluída. Novo serviço de notificações presente; `/health` retornou HTTP 200 e nosniff.
- Frontend: deployment `done`, criado em `2026-10-21T20:12:57.791Z`; atualização Swarm concluída. Checkout dos dois aplicativos conferido. `https://apticket.aptechinfo.com.br:75/auth` retornou HTTP 200, CSP com nonce, HSTS e nosniff, sem unsafe-eval.
- Só depois da troca dos consumidores foi aplicada a migration `20261021193343`, SHA-256 `c77bac4a5fbf81207b1e89d860cae88368ff499b29cd20976a9252187435a7eb`. O catálogo confirmou recusa de SELECT nos tokens para authenticated, manutenção da leitura de nomes e acesso exclusivo do servidor às credenciais. Não houve alteração de valores de credenciais.
- Backups apenas de esquema, com proprietários/grants, e diagnósticos das migrations foram mantidos em `/tmp/apticket-appsec-20261021-production`, com diretório restrito e arquivos `0600`. Não foram copiados dados de clientes nem enviados e-mails/mensagens de teste.

O contador distribuído preserva os limites existentes do portal/perfil. Os limites novos dos handlers de login/cadastro/reset continuam aguardando decisão sobre a política proposta. A suíte SQL histórica completa é um trabalho adicional; a aprovação do contrato de sessão/grants acima não a substitui.

## Verificações operacionais

O endereço público configurado atualmente é `https://apticket.aptechinfo.com.br:75`. Respondeu HTTP 200 com verificação normal do certificado. O Supabase em `https://supabase.aptechinfo.com.br:75` também respondeu por HTTPS. Os checks anteriores sem a porta não representavam esse endpoint. Antes deste lote, o frontend não retornava CSP, HSTS, nosniff, frame options, referrer ou permissions policy.

Uma consulta agregada, sem retornar valores, encontrou zero credenciais de uazapi/e-mail/canais fora do formato AES-GCM esperado. Isso verifica formato de armazenamento; não certifica rotação ou ausência de exposição histórica.

O PostgreSQL compartilhado está em 17.6. A atualização da plataforma exige backup/restauração testados e uma janela que considera os outros sistemas; foram solicitados esses requisitos ao operador. A aplicação não usa os adaptadores Supabase depreciados citados no changelog consultado. Referências: [mudanças de segurança no PostgreSQL](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes), [cifras TLS](https://supabase.com/changelog/cbc-tls-ciphers-deprecated) e [nonce no TanStack](https://tanstack.com/start/latest/docs/framework/react/guide/css-styling).

As decisões pendentes não impedem a preparação e os testes dos demais controles. Não declarar a auditoria integral concluída enquanto houver itens abertos.

## Complemento publicado — anexos e contrato SQL completo

O portal já recusava caminhos externos e de outro tenant. O complemento também
impede usar metadados para obter assinatura de um arquivo de outro ticket do
mesmo tenant ou publicar um anexo interno. A migration `20261021201338` registra
o vínculo entre objeto Storage, tenant e ticket, protege sua identidade e
mantém o signer exclusivo do servidor. O handler exige esse vínculo e uma
mensagem pública atual do contato autorizado antes de assinar.

Arquivos novos recebidos por WhatsApp passam a usar o namespace do ticket. O
envio de mídia/figurinha grava a mensagem e valida seu vínculo antes de assinar
e chamar o provedor; ignora a URL fornecida pelo navegador. E-mails pendentes
mantêm a importação somente para um ticket do mesmo contato. A galeria de
figurinhas preserva seu compartilhamento dentro do tenant.

22 asserções SQL cobrem esses limites; outras quatro verificam o backfill de
referências legadas únicas, ambíguas e misturadas com anexos internos. Caminhos
legados ambíguos não recebem capacidade de assinatura. O preflight agregado de
produção encontrou dois caminhos em mensagens, ambos já no namespace por
ticket, sem caminhos legados ou compartilhados entre tickets. Não foram lidos
arquivos nem retornados nomes de clientes ou conteúdos de mensagens.

O proxy `/backend/*` transmite o corpo com backpressure. Antes, `arrayBuffer()`
acumulava a requisição inteira antes do parser da API. Um teste HTTP mantém o
upload aberto até o upstream receber o primeiro bloco, verificando também o
caminho, os bytes e o encaminhamento da autenticação. Os limites já existentes
no parser da API continuam sendo aplicados pelo upstream.

As fixtures históricas foram atualizadas para os campos e assinaturas atuais,
com calendário e catálogos estruturais. O runner completo usa DDL, owners,
grants, RLS e triggers, sem dados de clientes. Seu container não tem rede,
volumes ou portas publicadas; o Vault usa chave fictícia e o cron está
desabilitado. As factories de testes nunca são instaladas em produção. Papéis
personalizados representam escopo por empresa e leitura; Admin/Financeiro
mantêm o comportamento atual de acesso ao grupo, sem alterar a regra para
acomodar testes antigos.

A reconciliação reproduziu duas falhas adicionais corrigidas incrementalmente:

- `20261021195603`: o trigger invoker de numeração de contratos de fornecedor
  chamava um alocador privado sem EXECUTE. A numeração foi movida para o
  trigger definer de classificação já existente, preservando seu proprietário
  e sem conceder acesso ao alocador para o navegador.
- `20261021203255`: a consulta da régua retornava uma configuração vazia quando
  um Admin informava uma empresa de outro tenant. Agora verifica a identidade
  da empresa e recusa a operação. A consulta anterior filtrava os dados por
  tenant; não foi demonstrada leitura de uma régua estrangeira.

Essas três migrations possuem reversão dedicada e foram aplicadas e registradas
transacionalmente em produção. A API foi publicada primeiro, seguida das
migrations e do frontend. Ambos os aplicativos chegaram ao commit
`e432848c677f0a41aff0472ecabac02aa248fd28`, com deployments `done` em
22/10 às 16:12:36Z e 16:15:27Z, respectivamente, e atualizações Swarm concluídas.
API `/health` e frontend `/auth` responderam HTTP 200. O HTTPS público na porta
75 respondeu com certificado validado, nonce/CSP, HSTS e nosniff.

O [CI do complemento](https://github.com/APTechSolucoesTI/ticket/actions/runs/39811330634)
aprovou os cinco jobs, incluindo 39 arquivos e 1.539 asserções SQL, quatro
verificações de backfill, 89 testes da API, builds, typechecks, lint global,
dependências e segredos. Duas referências de objetos existentes foram vinculadas;
o signer ficou exclusivo de service role. As evoluções posteriores, inclusive a
cobertura das tabelas restantes e os limites aprovados, estão na
[validação de 22/10](./validacao-20261022.md).
