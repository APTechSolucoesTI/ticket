// Portado 1:1 de apps/web/src/routes/api/public/hooks/uazapi/$tenantId.ts —
// o payload da uazapi varia de formato entre eventos (mensagem de texto,
// mídia, status, grupo), então essas funções tentam várias formas
// conhecidas do payload antes de desistir.

export type UnknownRec = Record<string, unknown>;

export function digits(v: unknown): string {
  const str = typeof v === 'string' || typeof v === 'number' ? String(v) : '';
  return str.replace(/\D/g, '');
}

export function asRecord(v: unknown): UnknownRec | null {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? (v as UnknownRec)
    : null;
}

export function firstRecord(v: unknown): UnknownRec | null {
  if (Array.isArray(v)) return asRecord(v[0]);
  return asRecord(v);
}

export function stripBrazilCountryCode(v: string): string {
  return v.startsWith('55') && v.length > 11 ? v.slice(2) : v;
}

export function phoneVariants(v: unknown): string[] {
  const d = digits(v);
  if (!d) return [];
  return Array.from(
    new Set([d, stripBrazilCountryCode(d)].filter((p) => p.length >= 8)),
  );
}

export function samePhone(a: unknown, b: unknown): boolean {
  const av = phoneVariants(a);
  const bv = phoneVariants(b);
  return av.some((x) =>
    bv.some(
      (y) =>
        x === y ||
        (x.length >= 8 && y.length >= 8 && (x.endsWith(y) || y.endsWith(x))),
    ),
  );
}

export function candidateRecords(payload: UnknownRec): UnknownRec[] {
  const data = asRecord(payload.data);
  const message = asRecord(payload.message);
  const firstMessage =
    firstRecord(payload.messages) ?? firstRecord(data?.messages);
  const nestedMessage = asRecord(message?.message) ?? asRecord(data?.message);
  const firstNestedMessage = firstRecord(nestedMessage?.messages);

  return [
    payload,
    data,
    message,
    firstMessage,
    nestedMessage,
    firstNestedMessage,
  ].filter(Boolean) as UnknownRec[];
}

export function extractPhone(payload: UnknownRec): string | null {
  for (const record of candidateRecords(payload)) {
    const key = asRecord(record.key);
    const candidates = [
      record.phone,
      record.number,
      record.from,
      record.chatid,
      record.chatId,
      record.sender,
      record.senderJid,
      record.remoteJid,
      key?.participant,
      key?.remoteJid,
      record.chatJid,
    ];
    for (const c of candidates) {
      const variants = phoneVariants(c);
      if (variants[0]) return variants[0];
    }
  }
  return null;
}

function textFromRecord(record: UnknownRec | null): string | null {
  if (!record) return null;
  const nested = asRecord(record.message);
  const extended =
    asRecord(nested?.extendedTextMessage) ??
    asRecord(record.extendedTextMessage);
  const image = asRecord(nested?.imageMessage) ?? asRecord(record.imageMessage);
  const video = asRecord(nested?.videoMessage) ?? asRecord(record.videoMessage);
  const document =
    asRecord(nested?.documentMessage) ?? asRecord(record.documentMessage);
  const candidates = [
    record.text,
    record.body,
    record.caption,
    record.transcription,
    record.conversation,
    record.content,
    nested?.conversation,
    extended?.text,
    image?.caption,
    video?.caption,
    document?.caption,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim())
      return candidate.trim();
  }
  return null;
}

export function extractText(payload: UnknownRec): string {
  const messageList: UnknownRec[] = [
    payload.messages,
    asRecord(payload.data)?.messages,
  ]
    .flatMap((value): unknown[] =>
      Array.isArray(value) ? (value as unknown[]) : [],
    )
    .map(asRecord)
    .filter((r): r is UnknownRec => r !== null);
  const groupedText = messageList
    .map(textFromRecord)
    .filter(Boolean)
    .join('\n');
  if (groupedText.trim()) return groupedText.trim();

  for (const record of candidateRecords(payload)) {
    const text = textFromRecord(record);
    if (text) return text;
  }

  return typeof payload.message === 'string' ? payload.message.trim() : '';
}

export function extractExternalId(payload: UnknownRec): string | null {
  for (const record of candidateRecords(payload)) {
    const key = asRecord(record.key);
    const id =
      record.id ??
      record.messageid ??
      record.messageId ??
      record.messageID ??
      key?.id;
    if (typeof id === 'string' && id.trim()) return id.trim();
  }
  return null;
}

export function extractName(payload: UnknownRec): string | null {
  for (const record of candidateRecords(payload)) {
    const name =
      record.pushname ??
      record.pushName ??
      record.senderName ??
      record.notifyName;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  return null;
}

export function normalizeStatus(raw: unknown): string | null {
  const s = (
    typeof raw === 'string' || typeof raw === 'number' ? String(raw) : ''
  ).toLowerCase();
  if (!s) return null;
  if (s.includes('read')) return 'read';
  if (s.includes('deliver')) return 'delivered';
  if (s.includes('sent') || s.includes('server')) return 'sent';
  if (s.includes('fail') || s.includes('error')) return 'failed';
  return s;
}

export function extractMedia(payload: UnknownRec, messageObj: UnknownRec) {
  const nestedMsg = asRecord(messageObj.message);
  const imageMsg =
    asRecord(nestedMsg?.imageMessage) ?? asRecord(messageObj.imageMessage);
  const stickerMsg =
    asRecord(nestedMsg?.stickerMessage) ?? asRecord(messageObj.stickerMessage);
  const audioMsg =
    asRecord(nestedMsg?.audioMessage) ?? asRecord(messageObj.audioMessage);
  const videoMsg =
    asRecord(nestedMsg?.videoMessage) ?? asRecord(messageObj.videoMessage);
  const documentMsg =
    asRecord(nestedMsg?.documentMessage) ??
    asRecord(messageObj.documentMessage);
  const nestedMedia =
    imageMsg ?? stickerMsg ?? audioMsg ?? videoMsg ?? documentMsg ?? null;
  const mediaObj = (messageObj.media ??
    messageObj.attachment ??
    nestedMedia ??
    null) as UnknownRec | null;
  const mediaUrl =
    (messageObj.mediaUrl as string | undefined) ??
    (messageObj.fileUrl as string | undefined) ??
    (messageObj.fileURL as string | undefined) ??
    (messageObj.url as string | undefined) ??
    (mediaObj?.url as string | undefined) ??
    (mediaObj?.fileURL as string | undefined) ??
    (mediaObj?.directPath as string | undefined) ??
    null;
  const mediaType: string | null = stickerMsg
    ? 'sticker'
    : imageMsg
      ? 'image'
      : audioMsg
        ? 'audio'
        : videoMsg
          ? 'video'
          : documentMsg
            ? 'document'
            : ((messageObj.type as string | undefined) ?? null);
  const defaultMime =
    mediaType === 'sticker'
      ? 'image/webp'
      : mediaType === 'image'
        ? 'image/jpeg'
        : mediaType === 'audio'
          ? 'audio/ogg'
          : mediaType === 'video'
            ? 'video/mp4'
            : 'application/octet-stream';
  const mimetype =
    (messageObj.mimetype as string | undefined) ??
    (mediaObj?.mimetype as string | undefined) ??
    (mediaObj?.type as string | undefined) ??
    defaultMime;
  const fileName =
    (messageObj.filename as string | undefined) ??
    (mediaObj?.filename as string | undefined) ??
    (mediaObj?.name as string | undefined) ??
    (mediaType === 'sticker'
      ? `sticker-${Date.now()}.webp`
      : `anexo-${Date.now()}`);
  const hasAttachment = mediaUrl != null || mediaObj != null;
  return { hasAttachment, mediaUrl, mimetype, fileName };
}

export function isFromMe(payload: UnknownRec): boolean {
  return candidateRecords(payload).some((record) => {
    const key = asRecord(record.key);
    return (
      record.fromMe === true || record.fromme === true || key?.fromMe === true
    );
  });
}
