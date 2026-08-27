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
  const content = asRecord(record.content);
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
    content?.text,
    content?.caption,
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
  const content = asRecord(messageObj.content);
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
  const declaredMediaType =
    firstString(
      messageObj.mediaType,
      messageObj.messageType,
      messageObj.type,
    )?.toLowerCase() ?? '';
  const contentIsMedia =
    declaredMediaType.includes('image') ||
    declaredMediaType.includes('video') ||
    declaredMediaType.includes('audio') ||
    declaredMediaType.includes('document') ||
    declaredMediaType.includes('sticker') ||
    messageObj.type === 'media';
  const mediaObj = (messageObj.media ??
    messageObj.attachment ??
    nestedMedia ??
    (contentIsMedia ? content : null) ??
    null) as UnknownRec | null;
  const mediaUrl =
    (messageObj.mediaUrl as string | undefined) ??
    (messageObj.fileUrl as string | undefined) ??
    (messageObj.fileURL as string | undefined) ??
    (messageObj.url as string | undefined) ??
    (mediaObj?.URL as string | undefined) ??
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
            : ((messageObj.mediaType as string | undefined) ??
              (declaredMediaType.includes('sticker')
                ? 'sticker'
                : declaredMediaType.includes('image')
                  ? 'image'
                  : declaredMediaType.includes('audio')
                    ? 'audio'
                    : declaredMediaType.includes('video')
                      ? 'video'
                      : declaredMediaType.includes('document')
                        ? 'document'
                        : null));
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
    (messageObj.fileName as string | undefined) ??
    (mediaObj?.filename as string | undefined) ??
    (mediaObj?.fileName as string | undefined) ??
    (mediaObj?.name as string | undefined) ??
    (mediaType === 'sticker'
      ? `sticker-${Date.now()}.webp`
      : `anexo-${Date.now()}${extensionForMime(mimetype)}`);
  const rawSize = mediaObj?.fileLength ?? messageObj.fileLength;
  const size =
    typeof rawSize === 'number'
      ? rawSize
      : typeof rawSize === 'string'
        ? Number(rawSize) || 0
        : 0;
  const hasAttachment = contentIsMedia && !!mediaUrl;
  return { hasAttachment, mediaUrl, mimetype, fileName, size, mediaType };
}

function extensionForMime(mimetype: string): string {
  const clean = mimetype.split(';')[0].toLowerCase();
  const extensions: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'audio/ogg': '.ogg',
    'audio/opus': '.opus',
    'audio/mpeg': '.mp3',
    'application/pdf': '.pdf',
  };
  return extensions[clean] ?? '';
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const number = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

export type WhatsappStructuredAttachment = {
  path: string;
  url?: string;
  name: string;
  size: number;
  type: string;
  kind?: 'contact' | 'location' | 'sticker';
  contact?: { name: string; phone: string | null };
  location?: {
    latitude: number;
    longitude: number;
    name: string | null;
    address: string | null;
  };
};

export function extractStructuredAttachments(
  payload: UnknownRec,
  messageObj: UnknownRec,
): WhatsappStructuredAttachment[] {
  const media = extractMedia(payload, messageObj);
  if (media.hasAttachment && media.mediaUrl) {
    return [
      {
        path: '',
        url: media.mediaUrl,
        name: media.fileName,
        size: media.size,
        type: media.mimetype,
        ...(media.mediaType === 'sticker' ? { kind: 'sticker' as const } : {}),
      },
    ];
  }

  const content = asRecord(messageObj.content);
  const contentText = firstString(messageObj.content);
  const type =
    firstString(messageObj.messageType, messageObj.type)?.toLowerCase() ?? '';
  const nestedMessage = asRecord(messageObj.message);
  const location =
    asRecord(messageObj.location) ??
    asRecord(messageObj.liveLocation) ??
    asRecord(messageObj.locationMessage) ??
    asRecord(nestedMessage?.locationMessage) ??
    asRecord(content?.location) ??
    asRecord(content?.liveLocation) ??
    (type.includes('location') ? content : null);
  if (location) {
    const latitude = firstNumber(
      location.degreesLatitude,
      location.latitude,
      location.lat,
    );
    const longitude = firstNumber(
      location.degreesLongitude,
      location.longitude,
      location.lng,
      location.lon,
    );
    if (latitude !== null && longitude !== null) {
      const name = firstString(location.name, location.title);
      const address = firstString(location.address, location.description);
      return [
        {
          path: '',
          name: name ?? 'Localização compartilhada',
          size: 0,
          type: 'application/vnd.apticket.whatsapp-location+json',
          kind: 'location',
          location: { latitude, longitude, name, address },
        },
      ];
    }
  }

  const rawContacts =
    (Array.isArray(messageObj.contacts) ? messageObj.contacts : null) ??
    (Array.isArray(content?.contacts) ? content.contacts : null) ??
    (type.includes('contact')
      ? Array.isArray(messageObj.content)
        ? messageObj.content
        : content
          ? [content]
          : contentText
            ? [{ vcard: contentText }]
            : []
      : []);
  const contacts = rawContacts.map(asRecord).filter(Boolean) as UnknownRec[];
  if (contacts.length > 0) {
    return contacts.slice(0, 20).map((contact, index) => {
      const vcard = firstString(contact.vcard, contact.vCard);
      const vcardName = vcard?.match(/(?:^|\n)FN[^:]*:([^\r\n]+)/i)?.[1];
      const vcardWaid = vcard?.match(
        /(?:^|\n)(?:item\d+\.)?TEL[^\r\n:]*;[^\r\n:]*waid=([0-9]+)/i,
      )?.[1];
      const vcardPhone = vcard?.match(
        /(?:^|\n)(?:item\d+\.)?TEL[^:]*:([^\r\n]+)/i,
      )?.[1];
      const name =
        firstString(
          contact.fullName,
          contact.displayName,
          contact.name,
          vcardName,
        ) ?? `Contato ${index + 1}`;
      const phone = firstString(
        contact.phoneNumber,
        contact.phone,
        contact.waid,
        vcardWaid,
        vcardPhone,
      );
      return {
        path: '',
        name,
        size: 0,
        type: 'application/vnd.apticket.whatsapp-contact+json',
        kind: 'contact' as const,
        contact: { name, phone },
      };
    });
  }

  return [];
}

export function sanitizeWebhookPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeWebhookPayload);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record)
      .filter(
        ([key]) =>
          !/token|secret|authorization|mediaKey|fileSHA256|fileEncSHA256|JPEGThumbnail/i.test(
            key,
          ),
      )
      .map(([key, nested]) => [key, sanitizeWebhookPayload(nested)]),
  );
}

export function isFromMe(payload: UnknownRec): boolean {
  return candidateRecords(payload).some((record) => {
    const key = asRecord(record.key);
    return (
      record.fromMe === true || record.fromme === true || key?.fromMe === true
    );
  });
}
