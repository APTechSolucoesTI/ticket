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
  Bearer nas chamadas pro backend novo — o "como consumir" está prático e testado
  (`tsc` limpo), pronto pra ser usado nas telas.

## O que falta (não fiz às pressas pra não entregar quebrado)

**Trocar as chamadas do frontend.** As telas de Configurações (canais de e-mail/WhatsApp),
"Fila de E-mail" (botão "Sincronizar agora") e "Responder ao Cliente" ainda chamam
`supabase-js`/server functions diretas (`email-channel.functions.ts`, `whatsapp.functions.ts`) —
funcionam, mas duplicam o que a API nova já faz. Trocar é mecânico (mesmo padrão em toda parte):
trocar a chamada por `backendClient.get/post(...)`, ex.:

```ts
// antes
const result = await testImapConnection({ data: { host, port, user, password } });
// depois
const result = await backendClient.post("/channels/email/accounts/me/test-connection", {
  imapHost: host, imapPort: port, imapUser: user, imapPassword: password,
});
```

Depois de trocar todas as chamadas, remover o código server-only redundante do `apps/web`:
`src/lib/{email-channel,imap-poll,email-send}.server.ts`, `email-channel.functions.ts`,
`whatsapp.functions.ts`, e as rotas `src/routes/api/public/hooks/{email-ingest,
email-imap-poll,uazapi/$tenantId}.ts` — junto com `imapflow`/`mailparser`/`nodemailer` do
`apps/web/package.json` (só a API precisa deles agora). Nesse ponto dá pra tirar `VITE_*` que
hoje carregam segredo nenhum sobra no bundle do front (já não sobrava, mas a API é quem deveria
ser a única a ter `SUPABASE_SERVICE_ROLE_KEY`/SMTP/uazapi token daqui pra frente).

**Chat no frontend.** O `ChatGateway` existe e funciona (testável com um client Socket.IO
qualquer), mas não tem UI nova conectando nele ainda — o app não tinha uma tela de chat em tempo
real antes, então não havia o que portar.

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
