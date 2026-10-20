# Worker IMAP externo (legado opcional)

O backend Node do APTicket j? faz polling IMAP com BullMQ. Este script ? uma alternativa para instala??es que usam o endpoint /api/public/hooks/email-ingest; n?o ative os dois coletores para a mesma caixa.

Execute a partir de um checkout completo deste monorepo, com Node 22 e as depend?ncias do lockfile instaladas por corepack pnpm install --frozen-lockfile. O script compartilha ImapFlow/mailparser com a API e a prote??o de destinos externos com os aplicativos. Copiar apenas o arquivo .mjs n?o ? suficiente.

Configure um arquivo protegido, por exemplo /etc/apticket/imap-worker.env, leg?vel somente pelo usu?rio do servi?o:

```env
APTICKET_INGEST_URL=https://seu-apticket.example/api/public/hooks/email-ingest
APTICKET_INGEST_TOKEN=<secret configurado no servidor>
IMAP_HOST=imap.seu-provedor.example
IMAP_PORT=993
IMAP_SECURE=true
IMAP_USER=<conta de servi?o>
IMAP_PASS=<senha da conta>
IMAP_MAILBOX=INBOX
```

O host IMAP deve resolver exclusivamente para IPs p?blicos. O IP validado fica fixado na conex?o e o hostname original continua sendo usado para validar TLS. APTICKET_INGEST_URL ? um destino interno confi?vel definido pelo operador; o POST n?o segue redirecionamentos e tem timeout de 30 segundos.

No diret?rio raiz do checkout:

```bash
node --env-file=/etc/apticket/imap-worker.env apps/web/scripts/email-imap-worker.mjs
```

Para agendamento, use o mesmo comando em um servi?o/timer com diret?rio de trabalho fixo e execu??es sem sobreposi??o. N?o carregue o arquivo de credenciais com xargs nem o versione. Este ajuste n?o instala ou agenda o worker.

O coletor consulta mensagens n?o lidas, envia o conte?do ao endpoint e marca como lida a mensagem aceita. A autoriza??o, deduplica??o e associa??o ao ticket s?o responsabilidade do endpoint de ingest?o configurado.
