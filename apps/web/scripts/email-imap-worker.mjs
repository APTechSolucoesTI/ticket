#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Coletor IMAP externo opcional. Execute no checkout completo com Node 22:
 * node --env-file=/etc/apticket/imap-worker.env apps/web/scripts/email-imap-worker.mjs
 * Instale as depend?ncias pelo lockfile do monorepo. Consulte README-email-imap.md.
 * O polling BullMQ da API ? o coletor padr?o; evite ativar ambos na mesma caixa.
 */
import { createRequire } from 'node:module';
import { publicMailEndpoint } from '@apticket/outbound-network';

// The optional legacy worker runs from the monorepo checkout and shares the
// maintained mail dependencies of the API, rather than an unpinned npm install.
const require = createRequire(new URL('../../api/package.json', import.meta.url));
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const {
  APTICKET_INGEST_URL,
  APTICKET_INGEST_TOKEN,
  IMAP_HOST,
  IMAP_PORT = '993',
  IMAP_SECURE = 'true',
  IMAP_USER,
  IMAP_PASS,
  IMAP_MAILBOX = 'INBOX',
} = process.env;

for (const [k, v] of Object.entries({
  APTICKET_INGEST_URL, APTICKET_INGEST_TOKEN, IMAP_HOST, IMAP_USER, IMAP_PASS,
})) {
  if (!v) { console.error(`Faltando env: ${k}`); process.exit(1); }
}

const client = new ImapFlow({
  ...await publicMailEndpoint(IMAP_HOST, Number(IMAP_PORT)),
  secure: IMAP_SECURE === 'true',
  auth: { user: IMAP_USER, pass: IMAP_PASS },
  logger: false,
});

async function postToApticket(payload) {
  const res = await fetch(APTICKET_INGEST_URL, {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${APTICKET_INGEST_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text };
}

(async () => {
  await client.connect();
  const lock = await client.getMailboxLock(IMAP_MAILBOX);
  try {
    const uids = await client.search({ seen: false }, { uid: true });
    if (!uids || uids.length === 0) {
      console.log('Nenhum e-mail novo.');
      return;
    }
    console.log(`Processando ${uids.length} mensagens...`);

    for (const uid of uids) {
      const msg = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true });
      const parsed = await simpleParser(msg.source);
      const from = parsed.from?.value?.[0];
      const payload = {
        message_id: parsed.messageId || `uid-${uid}@${IMAP_HOST}`,
        from_email: from?.address || '',
        from_name: from?.name || null,
        subject: parsed.subject || '(sem assunto)',
        body: parsed.text || parsed.html?.replace(/<[^>]+>/g, ' ') || '',
        received_at: (parsed.date || new Date()).toISOString(),
      };

      if (!payload.from_email) {
        console.warn(`UID ${uid}: remetente vazio, pulando.`);
        continue;
      }

      const result = await postToApticket(payload);
      console.log(`UID ${uid} -> ${result.status} ${result.body}`);

      if (result.ok) {
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
      }
    }
  } finally {
    lock.release();
    await client.logout();
  }
})().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
