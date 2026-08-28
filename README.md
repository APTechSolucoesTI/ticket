# APTicket — monorepo

Sistema de atendimento/tickets. Monorepo pnpm com dois apps:

- **`apps/web`** — frontend (TanStack Start/React/Vite), o app original, movido pra cá sem
  reescrever lógica.
- **`apps/api`** — backend novo (NestJS), responsável por tudo que precisa de segredo, processo
  contínuo, webhook público ou WebSocket: canais de e-mail, WhatsApp e chat.
- **`packages/shared-types`** — DTOs e o `Database` (tipos gerados do Supabase) compartilhados
  entre os dois apps.

## Por que essa divisão

O `apps/web` já rodava num servidor Node (TanStack Start/Nitro) com `service_role key`,
credenciais SMTP/IMAP e o token da uazapi guardados server-side — nunca chegavam ao browser. O
bloqueio real de produção sempre foi **o deploy não subir esse servidor**: a causa raiz (achada
durante o teste local desta migração) é que o preset default do nitro/vite aqui é
`cloudflare-module`, não Node — sem forçar `NITRO_PRESET=node-server` no build, `vite build`
produz saída pra Cloudflare Workers, que rodando como container simples vira só os assets
estáticos, sem servidor real atrás. Isso está corrigido (ver `apps/web/Dockerfile`). Ainda assim,
a reescrita para NestJS + Redis foi feita como pedido, porque:

- **Chat em tempo real** (presença, "digitando…", entrega instantânea) não existia — TanStack
  Start/Nitro não sustenta bem WebSocket com múltiplas réplicas sem uma peça central; o Socket.IO
  + Redis adapter resolve isso de verdade.
- **Filas com retry** (BullMQ) tornam o recebimento de e-mail/WhatsApp resiliente a pico de
  eventos e falha transitória do Postgres — o `pg_cron` batendo num endpoint HTTP a cada minuto
  não tinha isso.
- **Rate limit e dedupe de webhook** corretos com várias réplicas exigem estado compartilhado
  (Redis), não contador em memória por processo.

## O que está pronto e verificado

- Monorepo pnpm (`pnpm-workspace.yaml`, lockfile único, sem `package-lock.json`/`bun.lock`
  remanescente).
- `apps/api` bootstrapado: Auth guard (JWT do Supabase), Swagger em `/docs`, Redis/BullMQ central,
  criptografia (AES-256-GCM) de senha IMAP/SMTP e token da uazapi antes de gravar no Postgres.
- **EmailModule**, **WhatsappModule**, **ChatModule** completos — ver detalhes abaixo. `tsc` +
  `eslint` limpos nos dois apps. 11 testes unitários passando (`pnpm --filter api test`) —
  parser da uazapi e criptografia de segredos.
- **Testado ponta a ponta em localhost** (apps/web + apps/api + Redis reais, sem mock) via
  Playwright, contra dado de tenant real: e-mail (testar conexão IMAP, "Sincronizar agora" puxando
  e-mail de verdade, resposta via SMTP chegando na caixa de destino), WhatsApp (webhook inbound
  sintético → fila de números desconhecidos → vincular → ticket automático; erro de rede tratado,
  não crash), chat (dois clientes Socket.IO simultâneos trocando mensagem em tempo real). 4 bugs
  achados e corrigidos nesse processo:
  1. `SecretsService.decrypt()` quebrava (500) em qualquer tenant com senha IMAP/token salvos
     antes dessa migração (texto puro) — agora trata valor legado como está.
  2. Dialog "Iniciar atendimento?" na tela do ticket reabria sozinho a cada mudança de status
     (inclusive causada pelo próprio clique em "Sim, iniciar"), cobrindo o composer.
  3. `ChatGateway`: corrida entre handshake do socket e o primeiro `ticket:join` — autenticação
     que era assíncrona dentro de `handleConnection` corria contra o client emitindo `ticket:join`
     assim que recebia `connect`. Movida pra middleware de namespace (bloqueia handshake até
     resolver).
  4. `UazapiService`: falha de rede (`fetch` sem resposta HTTP — DNS não resolve, timeout) subia
     cru como 500 em vez de virar um erro tratado.
- `infra/docker-compose.yml` (redis + api) + `apps/api/Dockerfile` + `apps/web/Dockerfile`
  (multi-stage, pnpm, força `NITRO_PRESET=node-server`) + `infra/.env.example`.
- **Proxy same-origin** (`apps/web/src/routes/backend/$.ts`): o browser só fala com o domínio do
  frontend; `/backend/:path*` repassa pra API por trás, removendo o prefixo — `/backend/tickets`
  no browser vira `/tickets` no Nest. Mesmo padrão do `rewrites()` do Next.js usado no Integrador
  Bling (outro projeto de vocês), só que como rota do próprio TanStack Start (Nitro/Vite não tem
  "rewrites" nativo). A API **não** tem `app.setGlobalPrefix('backend')` — o prefixo existe só
  nessa borda.
- `apps/web/src/lib/backend-client.ts`: client HTTP que já anexa o JWT da sessão Supabase como
  Bearer nas chamadas pro backend novo.
- **Frontend trocado.** Configurações → canais de e-mail e WhatsApp, "Sincronizar agora" (Fila de
  E-mail) e "Responder ao Cliente" (e-mail/WhatsApp) agora chamam a API nova via `backendClient`,
  não mais `supabase-js`/server functions direto. Código server-only redundante removido de
  `apps/web`: `src/lib/{email-channel,imap-poll,email-send}.server.ts`,
  `email-channel.functions.ts`, as rotas `src/routes/api/public/hooks/{email-ingest,
  email-imap-poll,uazapi/$tenantId}.ts`, e `imapflow`/`mailparser` do `apps/web/package.json` (só
  a API precisa deles agora). Texto, arquivos, contato, localização, figurinha e ligação do
  WhatsApp passam pelo `WhatsappModule`, inclusive com descriptografia server-side do token UAZAPI.
  `notifyTicketStatus` e `sendCsatInvite` ainda continuam no código legado.
  `nodemailer` continua em `apps/web` (usado por `mailer.server.ts`, o envio de OTP do portal do
  cliente — feature separada, não é o canal de e-mail de ticket).
- **Senha/token nunca voltam em claro.** A API nunca devolve a senha IMAP/token da uazapi salvos
  (ficam criptografados no banco) — os forms de Configurações agora carregam esses campos vazios
  com placeholder "deixe em branco pra manter o atual", e só enviam no payload se o usuário digitar
  algo novo. Backend aceita omissão (exceto na primeira configuração, aí é obrigatório).
- **Segredo do webhook do WhatsApp agora é gerado pelo servidor** (24 bytes aleatórios), não mais
  digitado pelo usuário — a tela só exibe a URL pronta (com o segredo já embutido) pra colar na
  uazapi.
- **Chat no frontend.** `apps/web/src/lib/chat-socket.ts` (hook `useChatSocket`) conecta no
  `ChatGateway` com o JWT da sessão, entra na room do ticket (`ticket:join`), recebe
  `message:receive` (invalida a query de mensagens) e `typing`. O envio do agente usa o endpoint
  autenticado `POST /channels/chat/messages`: o frontend só limpa o campo após a API confirmar a
  persistência, e o `ChatGateway` distribui a mensagem gravada em tempo real. O evento legado
  `message:send` continua suportado pelo gateway com a mesma validação centralizada. Indicador
  "Digitando…" na tela do ticket. Envio de
  anexo pelo chat não foi coberto (o gateway só trata texto) — cai no caminho antigo de anexo
  genérico, mesma limitação que WhatsApp/e-mail já tinham pra outros tipos de mídia não migrados.

## Infra de produção — decidido

Domínio único: **apticket.aptechinfo.com.br**, mesmo padrão do Integrador Bling (outro monorepo
de vocês) — Dokploy publica só o frontend pelo Traefik, backend nunca exposto direto ao browser.

- **REST** (`/backend/*`): resolvido pelo proxy same-origin do `apps/web` — nenhuma config de
  proxy extra necessária, é só HTTP normal indo pro hostname interno do serviço `api` no Docker.
- **Webhook da uazapi** (`/backend/webhooks/whatsapp/:tenantId`): é POST HTTP comum (não
  WebSocket), passa liso pelo mesmo proxy — não precisa de rota especial no Traefik.
- **Chat (WebSocket/Socket.IO)**: única coisa que não passa pelo proxy do `apps/web` (upgrade de
  WebSocket não dá pra fazer num handler de request comum). O client conecta em `VITE_API_URL`,
  que em produção é o **mesmo domínio público** (`https://apticket.aptechinfo.com.br`) — o Traefik
  precisa rotear especificamente o caminho `/socket.io/` (path default do Socket.IO, sem precisar
  configurar nada no client) pro serviço `api`, e todo o resto pro serviço `web`. No Dokploy: aba
  de domínios do projeto → adicionar uma regra extra pro serviço `api` no mesmo domínio, com
  `PathPrefix(/socket.io)`; ou, se preferir declarar via compose, os labels equivalentes já estão
  comentados em `infra/docker-compose.yml` — descomente e ajuste o nome da rede Traefik do Dokploy.

### Variáveis de ambiente pra configurar no Dokploy

**Serviço `web`** (build de `apps/web/Dockerfile`, contexto = raiz do repo):

| Variável | Valor |
|---|---|
| `INTERNAL_BACKEND_URL` | hostname interno do serviço `api` no Docker (ex.: `http://api:3001` — nome exato depende de como o Dokploy nomeia o serviço, conferir na aba de rede do projeto) |
| `VITE_API_URL` | `https://apticket.aptechinfo.com.br` (mesmo domínio público — build-time, vai pro browser) |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | iguais aos que já usam hoje |
| `SUPABASE_SERVICE_ROLE_KEY` | idem (server-only, nunca com prefixo `VITE_`) |
| `SMTP_*`, `PORTAL_SESSION_SECRET` | iguais aos que já usam hoje (portal do cliente, feature separada do canal de e-mail). Defina `SMTP_CLIENT_NAME=apticket.aptechinfo.com.br` para o EHLO/HELO nunca usar `[127.0.0.1]`. |
| `PUBLIC_SITE_URL` | `https://apticket.aptechinfo.com.br` — usada nos links de convite/redefinição de senha (autenticação própria, ver seção abaixo) e no `redirectTo` de qualquer link antigo do GoTrue ainda em trânsito. |
| `JWT_SECRET` | **mesmo valor de `GOTRUE_JWT_SECRET`/`PGRST_JWT_SECRET`** do `.env` do Supabase self-hosted — não gerar um novo. Ver seção "Autenticação própria" abaixo. |
| `PORT` | Nitro usa isso pra escolher a porta — Dokploy geralmente injeta sozinho, conferir |

**Serviço `api`** (`infra/docker-compose.yml`, `.env` conforme `infra/.env.example`):

| Variável | Valor |
|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | mesmo projeto Supabase |
| `JWT_SECRET` | **mesmo valor usado no `apps/web`** (e mesmo do Supabase) — API valida o JWT localmente (assinatura), não pergunta pro GoTrue. |
| `REDIS_URL` | preenchido automaticamente pelo compose (`redis://redis:6379`) |
| `SECRETS_ENCRYPTION_KEY` | **gerar uma chave nova pra produção** — não reusar nenhuma chave de teste/dev; `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CORS_ORIGIN` | `https://apticket.aptechinfo.com.br` |
| `SWAGGER_ENABLED` | `false` em produção pública (expõe o contrato completo da API), ou deixar `true` só se o `/docs` também ficar atrás de basic auth no Traefik |
| `SMTP_CLIENT_NAME` | `apticket.aptechinfo.com.br` — FQDN anunciado pelo Nodemailer no EHLO/HELO; evita o fallback `[127.0.0.1]` bloqueado pela HostGator. |

## Autenticação própria (não depende mais de `auth.users` do Supabase)

Esse Supabase é compartilhado com outro sistema (mesma instância de Auth) — convidar um e-mail
que já existisse em `auth.users` de outro sistema bloqueava o convite com "usuário já
cadastrado". Investigado o blast radius antes de mudar qualquer coisa: **163 chamadas
`supabase.from(...)` direto do browser, em 21 arquivos**, dependiam 100% de RLS
(`tenant_id = apticket.current_tenant_id()`, via `auth.uid()`) — desativar RLS pra resolver o
convite teria exigido reescrever a camada de dado do app inteiro. Decisão: **manter RLS
funcionando**, trocando só quem emite o JWT.

- `apticket.profiles` ganhou `password_hash` (nullable) e perdeu a FK pra `auth.users(id)` — id
  vira um uuid livre, não precisa mais existir em `auth.users`. As outras 6 FKs do schema que
  apontavam pra `auth.users` (`user_roles.user_id`, `tickets.assigned_to`, `messages.author_id`,
  `time_entries.agent_id`, `canned_responses.created_by`, `kb_articles.created_by`) foram
  repontadas pra `apticket.profiles(id)` — nenhum dado mudou, os valores já batiam 1:1.
- Login/convite/redefinição de senha (`apps/web/src/lib/auth.functions.ts`) assinam um JWT
  HS256 próprio com o **mesmo `JWT_SECRET`** que `GOTRUE_JWT_SECRET`/`PGRST_JWT_SECRET` já usam
  no Supabase self-hosted — o PostgREST aceita como se fosse do GoTrue (verifica só a
  assinatura, não se o usuário existe em `auth.users`), então RLS/`auth.uid()` continuam
  funcionando sem tocar em nenhum dos 163 pontos.
- **Achado no meio do caminho**: `supabase.auth.setSession()`/`getSession()`/`getUser()` do
  supabase-js fazem (ou dependem de) chamada de rede pro GoTrue pra "hidratar" a sessão — e o
  GoTrue rejeita qualquer `sub` que não exista em `auth.users`, mesmo com assinatura válida
  (`"User from sub claim in JWT does not exist"`). Por isso a sessão é gerenciada por fora do
  supabase-js: `apps/web/src/lib/session.ts` (token em `localStorage`, decodificado localmente,
  nunca verificado contra o GoTrue) — o client Supabase (`integrations/supabase/client.ts`)
  injeta o `Authorization: Bearer` via fetch customizado, sem passar pelo subsistema `.auth`.
- Login cobre os dois casos no **servidor** (nunca no client): se o profile tem `password_hash`,
  compara bcrypt; se não tem (usuário ainda não migrado), tenta autenticar contra o GoTrue
  direto e, se aceitar, re-assina um JWT nosso com os mesmos dados. O client sempre recebe o
  mesmo formato de token, nunca sabe qual dos dois caminhos foi usado.
- `apps/api`: `SupabaseAuthGuard`/`ChatGateway` verificam o JWT localmente
  (`src/auth/jwt.util.ts`, `jsonwebtoken.verify` com `JWT_SECRET`) em vez de perguntar pro
  GoTrue — mais rápido, e funciona pra usuário que o GoTrue nunca viu.
- **Fase 2, não incluída nesta entrega**: migração em massa dos usuários que ainda só têm conta
  no GoTrue (reset de senha obrigatório) + desligar o fallback antigo de vez. Por enquanto os
  dois caminhos coexistem.
- **Fora de escopo**: papéis/permissões dinâmicos (matriz de módulos × ações, overrides por
  usuário) — o sistema continua no enum simples `apticket.app_role` (admin/agent/requester) que
  já existia, usado direto em `has_role()`/RLS/UI. Trocar isso é outro projeto do mesmo porte,
  não coube junto com a troca de autenticação.

## Antes de ir pra produção com isso (cutover, não é código)

1. **pg_cron**: existia um job chamando `/api/public/hooks/email-imap-poll` a cada minuto — a rota
   foi removida (o polling agora é o `EmailSchedulerService`/BullMQ dentro da própria API). Rodar
   `SELECT cron.unschedule('email-imap-poll');` (ou o nome que o job tiver) no Postgres, senão ele
   fica batendo num 404 sem fazer nada.
2. **Webhook da uazapi**: a URL configurada na uazapi hoje aponta pro `apps/web` antigo
   (`/api/public/hooks/uazapi/:tenantId`, removida). Repontar pra
   `https://apticket.aptechinfo.com.br/backend/webhooks/whatsapp/<tenantId>?secret=<segredo>` — a
   tela de Configurações → WhatsApp já mostra essa URL pronta depois de salvar.
3. Ambos só importam quando o `apps/api` novo estiver realmente no ar — até lá nenhum dos dois
   caminhos (antigo ou novo) está recebendo tráfego de verdade, então não tem pressa, mas não
   esquecer antes do go-live.
4. **Supabase Auth → URL Configuration → Redirect URLs**: adicionar
   `https://apticket.aptechinfo.com.br/**` na allowlist (sem tirar as URLs que o outro sistema que
   compartilha esse projeto já usa) — sem isso o GoTrue ignora o `redirectTo` do convite e cai no
   fallback dele, mandando o link do e-mail pro próprio Supabase em vez do APTicket.
5. **`apticket.handle_new_user()` (trigger `on_auth_user_created`)**: esse Supabase Auth é
   compartilhado com outro sistema (mesma `auth.users`) — sem guard, esse trigger provisionava
   tenant+perfil+role admin no APTicket pra qualquer signup de qualquer app que usa esse mesmo
   Supabase. O guard e o ajuste para papéis dinâmicos foram aplicados em produção em 21/08/2026
   pelas migrations `20260819000000_guard_handle_new_user_cross_app.sql` e
   `20260821141348_repair_legacy_auth_registration_role_assignment.sql`. O trigger agora ignora
   outros apps e nunca aceita tenant ou papel informados em metadata controlada pelo usuário.

## Rodando local

```bash
corepack enable
pnpm install

# frontend
pnpm --filter web dev          # http://localhost:8080

# backend (precisa de Redis rodando — ver infra/docker-compose.yml)
cp infra/.env.example apps/api/.env   # preencha SUPABASE_SERVICE_ROLE_KEY e SECRETS_ENCRYPTION_KEY
pnpm --filter api start:dev    # http://localhost:3001, docs em /docs
```

`apps/web/.env` precisa de `INTERNAL_BACKEND_URL` (proxy same-origin, aponta pro `apps/api` local)
e `VITE_API_URL` (client do chat conecta direto) — em dev os dois apontam pro
`http://localhost:3001`.

## Deploy (Docker — Dokploy/Portainer/docker-compose puro)

```bash
cd infra
cp .env.example .env   # preencha as variáveis (ver comentários no arquivo e tabela acima)
docker compose up -d --build
```

Sobe `redis` (com persistência AOF) e `api` (porta `3001`, healthcheck em `/health`).
`redis-commander` é opcional, atrás de profile: `docker compose --profile debug up`.

`apps/web` é implantado separadamente (app próprio no Dokploy, como já é hoje) usando
`apps/web/Dockerfile` — contexto de build precisa ser a **raiz do monorepo**, não `apps/web/`,
porque ele depende de `packages/shared-types` via workspace.

- **`/docs`**: fica exposto publicamente por padrão (`SWAGGER_ENABLED=true`) — considere
  `SWAGGER_ENABLED=false` em produção, ou basic auth no reverse proxy na frente dele, já que
  expõe o contrato completo da API.
- **CI/CD**: não existia nenhum (`.github/workflows` vazio) antes desta mudança — nada pra
  atualizar, mas também nada automatizando esse build ainda.
