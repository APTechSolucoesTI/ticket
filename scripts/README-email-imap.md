# Worker IMAP → APTicket

O backend do APTicket roda em Cloudflare Workers e **não suporta conexões TCP brutas (IMAP)**.
Por isso a captura de e-mails é feita por este script Node externo, agendado via cron.

## Como funciona

1. **Configuração de canal E-mail** (`Configurações → Canais → E-mail → Configurar`): você cadastra IMAP/SMTP da caixa (armazenado localmente para referência).
2. **Worker IMAP** (este script): roda em qualquer host com Node 20+, lê mensagens não-lidas via IMAP e faz `POST` para o endpoint público do APTicket.
3. **Endpoint `/api/public/hooks/email-ingest`**: valida o token, localiza o **contato** pelo e-mail, exige **contrato ativo** da empresa e cria um **ticket** com a mensagem inicial. Deduplica por `Message-ID`.

## Instalação (servidor Linux)

```bash
mkdir -p /opt/apticket && cd /opt/apticket
curl -O https://<seu-host>/email-imap-worker.mjs   # ou copie via scp
npm init -y && npm i imapflow mailparser
```

Crie `/opt/apticket/.env` (carregue antes do cron, p. ex. com `env $(cat .env | xargs)`):

```env
APTICKET_INGEST_URL=https://project--fdf8522c-eec1-41c6-81ec-00eb19eff00d.lovable.app/api/public/hooks/email-ingest
APTICKET_INGEST_TOKEN=<valor do secret EMAIL_INGEST_SECRET>
IMAP_HOST=imap.seu-provedor.com
IMAP_PORT=993
IMAP_SECURE=true
IMAP_USER=suporte@empresa.com
IMAP_PASS=********
IMAP_MAILBOX=INBOX
```

## Cron (a cada 5 minutos)

```cron
*/5 * * * * cd /opt/apticket && env $(cat .env | xargs) node email-imap-worker.mjs >> /var/log/apticket-imap.log 2>&1
```

## Comportamento

- E-mail de remetente sem contato cadastrado → ignorado (`skipped: unknown_contact`).
- Empresa sem contrato `active` → ignorado (`skipped: no_active_contract`).
- `Message-ID` já visto nos últimos 7 dias → ignorado (`duplicate`).
- Sucesso → ticket criado com `channel = email`, prioridade `medium`, status `open`, vinculado ao contrato ativo mais recente, e a mensagem é marcada como lida no IMAP.
