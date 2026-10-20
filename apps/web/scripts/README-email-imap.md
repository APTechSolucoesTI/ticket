# Worker IMAP externo (legado opcional)

O backend Node do APTicket já faz polling IMAP com BullMQ. Este script é uma alternativa para instalações que usam o endpoint /api/public/hooks/email-ingest; não ative os dois coletores para a mesma caixa.

Execute a partir de um checkout completo deste monorepo, com Node 22 e as dependências do lockfile instaladas por corepack pnpm install --frozen-lockfile. O script compartilha ImapFlow/mailparser com a API e a proteção de destinos externos com os aplicativos. Copiar apenas o arquivo .mjs não é suficiente.

Configure um arquivo protegido, por exemplo /etc/apticket/imap-worker.env, legível somente pelo usuário do serviço:

```env
APTICKET_INGEST_URL=https://seu-apticket.example/api/public/hooks/email-ingest
APTICKET_INGEST_TOKEN=<secret configurado no servidor>
IMAP_HOST=imap.seu-provedor.example
IMAP_PORT=993
IMAP_SECURE=true
IMAP_USER=<conta de serviço>
IMAP_PASS=<senha da conta>
IMAP_MAILBOX=INBOX
```

O host IMAP deve resolver exclusivamente para IPs públicos. O IP validado fica fixado na conexão e o hostname original continua sendo usado para validar TLS. APTICKET_INGEST_URL é um destino interno confiável definido pelo operador; o POST não segue redirecionamentos e tem timeout de 30 segundos.

No diretório raiz do checkout:

```bash
node --env-file=/etc/apticket/imap-worker.env apps/web/scripts/email-imap-worker.mjs
```

Para agendamento, use o mesmo comando em um serviço/timer com diretório de trabalho fixo e execuções sem sobreposição. Não carregue o arquivo de credenciais com xargs nem o versione. Este ajuste não instala ou agenda o worker.

O coletor consulta mensagens não lidas, envia o conteúdo ao endpoint e marca como lida a mensagem aceita. A autorização, deduplicação e associação ao ticket são responsabilidade do endpoint de ingestão configurado.
