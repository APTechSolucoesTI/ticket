# Continuação da auditoria — 20/10/2026

Este documento complementa [a auditoria inicial](./auditoria-20261019.md). O responsável autorizou a publicação do lote `4151865`, a atualização principal do Nodemailer, a revogação das sessões anteriores após reset e a consulta dos destinos configurados em produção. Testes de credenciais continuam usando somente fixtures locais ou containers descartáveis.

## SEC-08 — Nodemailer

Atualizado de 9.1.1 para **10.1.7**, com versão exata nos dois aplicativos e no override do workspace. O `pnpm audit` passou com **zero avisos** em todas as severidades; isso é um retrato do catálogo consultado, não garantia de ausência de vulnerabilidades futuras.

Teste: `node scripts/security/test-mail-compatibility.mjs`. SMTP real limitado a loopback, sem carregar `.env` e sem destinatários reais. Verifica o envio do código do portal, resposta do tenant com threading, anexo PDF lido pelo mailparser e recusa SMTP. Usa os consumidores reais do web e da API compilada. Nenhuma mensagem externa foi enviada.

Antes: dois avisos altos e três moderados remanescentes no Nodemailer 9. Depois: nenhum aviso no audit. Rollback: revert do commit e instalação pelo lockfile; reabre os avisos corrigidos.

## Publicação anterior

O lote `4151865` foi enviado ao GitHub e as duas aplicações do Dokploy concluíram o deploy em 19/10/2026. O estado de deployment foi consultado no Dokploy. A verificação HTTP por dentro da rede será registrada separadamente; conclusão de build, sozinha, não atesta disponibilidade pública.

## SEC-07 — credenciais e revogação de sessões

Antes: convite/reset faziam gravações separadas; podiam emitir JWT após falha de consumo do link. JWTs antigos permaneciam válidos após trocar a senha. A decisão de revogar todas as sessões anteriores foi confirmada pelo responsável.

Depois: migration incremental `20261019231722_session_version_revocation.sql` adiciona contador privado de sessão por perfil e duas RPCs exclusivas de `service_role`. Um lock no perfil serializa alterações de credenciais; consumo condicional do link, troca da senha e invalidação dos demais links são uma única transação. Falha de gravação desfaz o consumo. O trigger incrementa a versão em qualquer alteração efetiva do hash da senha.

Login, convite, reset e renovação de contato emitem a versão corrente no JWT. Tokens legados sem essa claim continuam válidos na versão zero até a primeira troca de senha. API e middleware web consultam o perfil atual; a ação financeira que usa service role valida a versão explicitamente. No chat, a versão é conferida antes de cada pacote recebido e de cada broadcast, incluindo destinatários alcançados pelo adapter Redis. Falha de consulta bloqueia a entrega. Sockets antigos ociosos podem continuar conectados até a próxima operação, sem autorização para transmitir ou receber dados protegidos.

No banco, políticas restritivas adicionais cobrem as 118 tabelas atuais do clone, inclusive políticas baseadas só em `auth.uid()`, e os oito buckets APTicket. O helper de tenant exige sessão atual. Um hook de pré-requisição do PostgREST impede também acesso a RPCs `SECURITY DEFINER` com JWT revogado. O hook atua apenas nos JWTs identificados como APTicket; a migration recusa sobrescrever um hook diferente. O schema de helpers é privado e o `search_path` é fixo. Novas tabelas/políticas futuras precisam manter esse controle.

A troca voluntária pelo perfil renova a sessão do navegador atual na nova versão e usa compare-and-set para não sobrescrever uma troca concorrente. Respostas 401 da API/PostgREST removem a sessão rejeitada do navegador; uma resposta atrasada de token antigo preserva uma sessão já renovada. URLs de Storage previamente assinadas continuam com sua validade original: são capacidades temporárias, independentes do JWT revogado.

### Provas e regressão

- Teste HTTP do build anterior reproduziu emissão de sessão após falha de persistência. O mesmo teste passou no build corrigido: falha de transação, reset/replay, login corrente, ação financeira com token revogado, troca de senha pelo perfil e ativação/replay de convite. Usa bcrypt real e backend HTTP de fixtures.
- 34 asserções pgTAP passaram no clone de esquema de produção, sem linhas de negócio copiadas. Cobrem grants, versão privada, RLS, Storage com política permissiva compartilhada, legado, isolamento de tenant, expiração, replay e rollback após falha de gravação. Reversão e reaplicação da migration também passaram nesse clone.
- PostgreSQL + PostgREST v14.12 reais: duas requisições simultâneas ao mesmo reset resultaram em exatamente um sucesso e uma recusa. O JWT antigo recebeu HTTP 401 em tabela e RPC privilegiada; o novo funcionou; outro usuário, outra aplicação e fluxos anônimos mantiveram seu comportamento. Prova automatizada em `scripts/security/test-session-postgrest.py`, limitada por verificações de labels/rede interna/ausência de volumes e portas publicadas.
- Dez testes dedicados de guard/chat passaram, incluindo sockets existentes, perfil inativo, falha de banco, expiração e tenant incompatível. A API completa passou em **74 testes / 14 suites**. O teste de navegador cobre limpeza do token e a corrida com renovação.
- `supabase db advisors --type security`, CLI 2.121.0, passou no clone com resultado vazio. A conexão usou túnel temporário restrito a loopback e o banco sintético; o túnel foi encerrado. Esse resultado não certifica configurações de Auth, TLS ou todas as regras de negócio.

Rollback emergencial: [SQL de reversão](../../supabase/rollbacks/20261019231722_session_version_revocation.sql), coordenado com o revert dos aplicativos. Ele recusa hook inesperado e dependências desconhecidas. **Remover o controle revalida JWTs anteriormente revogados até a expiração original; preferir correção adiante.** Se a migration já estiver registrada, reconciliar também seu registro no histórico após uma reversão deliberada, sem reescrever o histórico Git.

Pré-requisito operacional: as tabelas de produção têm proprietários mistos (`postgres` e `supabase_admin`). A primeira tentativa, pelo papel `postgres`, foi abortada por falta de propriedade de uma tabela; a transação inteira foi revertida, com zero coluna/registro de migration novos. A migration ainda inédita em produção recebeu preflight de propriedade e ownership explícito dos novos helpers para `postgres`, papel BYPASSRLS sem superuser no servidor. Aplicação/reversão exigem um papel de migration com privilégios sobre todos os proprietários; os aplicativos continuam com seus papéis normais.

Após esse ajuste, o runner foi repetido com `supabase_admin` como bootstrap, `postgres` sem superuser e tabelas de proprietários distintos: comprovou recusa antecipada do papel insuficiente, ausência de alteração parcial, ownership final, reversão/reaplicação, 34 asserções e concorrência HTTP. No clone completo, o catálogo de proprietários das tabelas foi reproduzido e os testes SQL/HTTP passaram novamente. O clone completo mantém o superuser de bootstrap do `initdb`; o teste mínimo do CI cobre separadamente a restrição do papel `postgres`.

## CI e validação atual

O workflow recebeu os testes de credenciais, sessão do navegador e SMTP. Um job separado executa `scripts/security/run-session-isolation.py`: cria banco vazio e PostgREST em rede interna, testa migration/reversão/reaplicação, 34 asserções e concorrência HTTP, depois remove somente os recursos criados. O bootstrap `fixtures/session-contract.sql` representa o contrato mínimo de sessão; **não equivale ao esquema completo nem à matriz CRUD das 118 tabelas**. O runner completo passou no servidor, com dados sintéticos, antes de ser incluído no CI.

Builds e typechecks web/API passaram. Lint completo da API e lint dos arquivos web alterados passaram. Lint de segurança: zero erros e 119 avisos heurísticos. O lint global do web foi reexecutado: **333 erros de formatação e 11 avisos preexistentes** permanecem em outros arquivos; o job de aplicação continuará bloqueado nesse passo. O CI remoto ainda precisa ser conferido após o push. Os testes HTTP anteriores de TanStack e portal também passaram no novo build. A suíte Edge e os seletores não foram alterados neste lote; seus resultados anteriores não substituem novos testes das áreas modificadas.

## Destinos de integrações e limitações restantes

A consulta autorizada leu somente hosts/portas, sem tokens, senhas ou dados de clientes: SMTP `srv42.prodns.com.br:465`, IMAP `srv42.prodns.com.br:993` e uazapi/canais `apchat.uazapi.com:443`. Na resolução feita no servidor, esses hosts retornaram somente IPs públicos. Isso não define os destinos internos adicionais mencionados pelo responsável. SEC-05 continua pendente de allowlist operacional explícita; não foi aplicado bloqueio de rede que possa interromper uma integração interna não identificada.

Os demais riscos da auditoria inicial permanecem conforme seus estados, incluindo contador distribuído de tentativas, vínculo imutável objeto–ticket, matriz SQL completa, arquivos/antivírus, MFA do futuro backoffice, CSP/TLS e acesso aos campos cifrados. O backoffice ainda não existe. Este lote não representa encerramento integral da auditoria.
