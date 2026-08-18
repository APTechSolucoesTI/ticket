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
bloqueio real de produção sempre foi **o deploy não subir esse servidor** (o container publicado
era um build estático, sem Node nenhum atrás). Ainda assim, a reescrita para NestJS + Redis foi
feita como pedido, porque:

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
  remanescente). `pnpm --filter web dev` e `pnpm --filter web build` testados depois da mudança de
  pastas — build limpo, `tsc`/`eslint` sem erro novo.
- `apps/api` bootstrapado: Auth guard (JWT do Supabase), Swagger em `/docs`, Redis/BullMQ central,
  criptografia (AES-256-GCM) de senha IMAP/SMTP e token da uazapi antes de gravar no Postgres.
- **EmailModule**, **WhatsappModule**, **ChatModule** completos — ver detalhes abaixo. `tsc` +
  `eslint` limpos nos dois apps. 11 testes unitários passando (`pnpm --filter api test`) —
  parser da uazapi e criptografia de segredos.
- `infra/docker-compose.yml` + `apps/api/Dockerfile` (multi-stage, pnpm) + `infra/.env.example`.
- Proxy same-origin (`apps/web/src/routes/api/backend/$.ts`): o browser só fala com o domínio do
  frontend; a rota repassa pra API por trás — mesmo padrão que vocês já usam no outro monorepo
  (Next.js `rewrites()`), só que como rota do próprio app já que o Nitro/Vite daqui não tem um
  "rewrites" nativo.
- `apps/web/src/lib/backend-client.ts`: client HTTP que já anexa o JWT da sessão Supabase como
  Bearer nas chamadas pro backend novo.
- **Frontend trocado.** Configurações → canais de e-mail e WhatsApp, "Sincronizar agora" (Fila de
  E-mail) e "Responder ao Cliente" (e-mail/WhatsApp) agora chamam a API nova via `backendClient`,
  não mais `supabase-js`/server functions direto. Código server-only redundante removido de
  `apps/web`: `src/lib/{email-channel,imap-poll,email-send}.server.ts`,
  `email-channel.functions.ts`, as rotas `src/routes/api/public/hooks/{email-ingest,
  email-imap-poll,uazapi/$tenantId}.ts`, e `imapflow`/`mailparser` do `apps/web/package.json` (só
  a API precisa deles agora). `notifyTicketStatus`/`sendCsatInvite`/envio de mídia-contato-
  localização-sticker-ligação do WhatsApp **continuam no código antigo** — não fazem parte do que
  o WhatsappModule cobre hoje (só resposta de texto), não inventei um substituto pra eles.
  `nodemailer` continua em `apps/web` (usado por `mailer.server.ts`, o envio de OTP do portal do
  cliente — feature separada, não é o canal de e-mail de ticket).
- **Senha/token nunca voltam em claro.** A API nunca devolve a senha IMAP/token da uazapi salvos
  (ficam criptografados no banco) — os forms de Configurações agora carregam esses campos vazios
  com placeholder "deixe em branco pra manter o atual", e só enviam no payload se o usuário digitar
  algo novo. Backend aceita omissão (exceto na primeira configuração, aí é obrigatório).
- **Segredo do webhook do WhatsApp agora é gerado pelo servidor** (24 bytes aleatórios), não mais
  digitado pelo usuário — a tela só exibe a URL pronta (com o segredo já embutido) pra colar na
  uazapi.

## Antes de ir pra produção com isso (cutover de infra, não é código)

1. **pg_cron**: existia um job chamando `/api/public/hooks/email-imap-poll` a cada minuto — a rota
   foi removida (o polling agora é o `EmailSchedulerService`/BullMQ dentro da própria API). Rodar
   `SELECT cron.unschedule('email-imap-poll');` (ou o nome que o job tiver) no Postgres, senão ele
   fica batendo num 404 sem fazer nada.
2. **Webhook da uazapi**: a URL configurada na uazapi hoje aponta pro `apps/web` antigo
   (`/api/public/hooks/uazapi/:tenantId`, removida). Repontar pra
   `https://<domínio>/api/backend/webhooks/whatsapp/<tenantId>?secret=<segredo>` — a tela de
   Configurações → WhatsApp já mostra essa URL pronta depois de salvar.
3. Ambos só importam quando o `apps/api` novo estiver realmente no ar (ver deploy abaixo) — até lá
   nenhum dos dois caminhos (antigo ou novo) está recebendo tráfego de verdade, então não tem
   pressa, mas não esquecer antes do go-live.

## O que ainda falta

**Chat no frontend — feito.** `apps/web/src/lib/chat-socket.ts` (hook `useChatSocket`) conecta no
`ChatGateway` com o JWT da sessão, entra na room do ticket (`ticket:join`), recebe
`message:receive` (invalida a query de mensagens) e `typing`. `TicketComposer` manda pelo socket
(`message:send`) em vez de INSERT direto quando `channel === "chat"` — o `ChatGateway` já persiste
e distribui, então não duplica. Indicador "Digitando…" na tela do ticket. Envio de anexo pelo chat
não foi coberto (o gateway só trata texto) — cai no caminho antigo de anexo genérico, mesma
limitação que WhatsApp/e-mail já tinham pra outros tipos de mídia não migrados.

**WebSocket atrás do proxy.** O proxy same-origin (`$.ts`) só cobre REST — não dá pra fazer
upgrade de WebSocket através de um handler de request comum. Duas opções em produção:

1. Configurar o reverse proxy de infra (Traefik/Nginx) pra rotear `/backend/socket.io` (ou
   caminho equivalente) com os headers de `Upgrade`/`Connection` pro container `api`.
2. Conectar o client Socket.IO direto em `VITE_API_URL` (subdomínio próprio da API), sem passar
   pelo proxy do frontend.

Não decidi por vocês — depende de qual reverse proxy a VPS usa (Coolify/Portainer geram Traefik
por padrão, que suporta isso bem via labels).

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

## Deploy (VPS com Docker — Coolify/Portainer/docker-compose puro)

```bash
cd infra
cp .env.example .env   # preencha as variáveis (ver comentários no arquivo)
docker compose up -d --build
```

Sobe `redis` (com persistência AOF) e `api` (porta `3001`, healthcheck em `/health`).
`redis-commander` é opcional, atrás de profile: `docker compose --profile debug up`.

- **Domínio/reverse proxy**: aponte o mesmo domínio público do `apps/web` pro proxy same-origin
  cobrir REST automaticamente. Pro WebSocket do chat, ver seção acima.
- **`/docs`**: fica exposto publicamente por padrão (`SWAGGER_ENABLED=true`) — considere
  `SWAGGER_ENABLED=false` em produção, ou basic auth no reverse proxy na frente dele, já que
  expõe o contrato completo da API.
- **CI/CD**: não existia nenhum (`.github/workflows` vazio) antes desta mudança — nada pra
  atualizar, mas também nada automatizando esse build ainda.
