import {
  extractExternalId,
  extractMedia,
  extractName,
  extractPhone,
  extractStructuredAttachments,
  extractText,
  isFromMe,
  normalizeStatus,
  sanitizeWebhookPayload,
  samePhone,
} from './whatsapp-parser.util';

describe('whatsapp-parser', () => {
  it('extrai telefone (com DDI) de um payload típico de mensagem', () => {
    const payload = {
      key: { remoteJid: '5511999998888@s.whatsapp.net' },
      pushName: 'Ana',
    };
    expect(extractPhone(payload)).toBe('5511999998888');
  });

  it('extrai texto de extendedTextMessage aninhado', () => {
    const payload = {
      message: { extendedTextMessage: { text: 'Olá, preciso de ajuda' } },
    };
    expect(extractText(payload)).toBe('Olá, preciso de ajuda');
  });

  it('extrai texto simples de conversation', () => {
    const payload = { message: { conversation: 'Bom dia' } };
    expect(extractText(payload)).toBe('Bom dia');
  });

  it('extrai o id externo de dentro de key.id', () => {
    const payload = { key: { id: '3EB0ABC123' } };
    expect(extractExternalId(payload)).toBe('3EB0ABC123');
  });

  it('extrai pushName', () => {
    expect(extractName({ pushName: 'Carlos Silva' })).toBe('Carlos Silva');
  });

  it('ignora mensagem enviada pela própria instância (fromMe)', () => {
    expect(isFromMe({ key: { fromMe: true } })).toBe(true);
    expect(isFromMe({ key: { fromMe: false } })).toBe(false);
  });

  it('compara telefones com e sem DDI 55', () => {
    expect(samePhone('5511999998888', '11999998888')).toBe(true);
    expect(samePhone('5511999998888', '11888887777')).toBe(false);
  });

  it('normaliza status de entrega', () => {
    expect(normalizeStatus('READ')).toBe('read');
    expect(normalizeStatus('DELIVERY_ACK')).toBe('delivered');
    expect(normalizeStatus('SERVER_ACK')).toBe('sent');
    expect(normalizeStatus(null)).toBeNull();
  });

  it.each([
    ['image', 'image/jpeg', 'image'],
    ['video', 'video/mp4', 'video'],
    ['audio', 'audio/ogg', 'audio'],
    ['document', 'application/pdf', 'document'],
    ['sticker', 'image/webp', 'sticker'],
  ])('extrai mídia UAZAPI v2: %s', (mediaType, mimetype, expectedType) => {
    const message = {
      type: 'media',
      mediaType,
      messageType: `${mediaType}Message`,
      content: {
        URL: 'https://mmg.whatsapp.net/media/test',
        mimetype,
        fileLength: '1234',
      },
    };
    expect(extractMedia({ message }, message)).toMatchObject({
      hasAttachment: true,
      mediaUrl: 'https://mmg.whatsapp.net/media/test',
      mimetype,
      mediaType: expectedType,
      size: 1234,
    });
  });

  it('extrai localização e contato estruturados', () => {
    const location = {
      messageType: 'LocationMessage',
      content: {
        degreesLatitude: -23.55,
        degreesLongitude: -46.63,
        name: 'São Paulo',
      },
    };
    expect(
      extractStructuredAttachments({ message: location }, location)[0],
    ).toMatchObject({
      kind: 'location',
      location: { latitude: -23.55, longitude: -46.63, name: 'São Paulo' },
    });
    const contact = {
      messageType: 'ContactMessage',
      content: {
        fullName: 'Ana',
        phoneNumber: '5511999998888',
      },
    };
    expect(
      extractStructuredAttachments({ message: contact }, contact)[0],
    ).toMatchObject({
      kind: 'contact',
      contact: { name: 'Ana', phone: '5511999998888' },
    });
  });

  it('extrai telefone de vCard com item1.TEL e waid', () => {
    const contact = {
      messageType: 'ContactMessage',
      content: {
        displayName: 'Silvia',
        vcard:
          'BEGIN:VCARD\nVERSION:3.0\nFN:Silvia\nitem1.TEL;waid=5511987654321:+55 11 98765-4321\nEND:VCARD',
      },
    };

    expect(
      extractStructuredAttachments({ message: contact }, contact)[0],
    ).toMatchObject({
      kind: 'contact',
      contact: { name: 'Silvia', phone: '5511987654321' },
    });
  });

  it('extrai vCard em string e localização aninhada', () => {
    const contact = {
      messageType: 'ContactMessage',
      content:
        'BEGIN:VCARD\nVERSION:3.0\nFN:João\nTEL;TYPE=CELL:+55 11 99999-8888\nEND:VCARD',
    };
    expect(
      extractStructuredAttachments({ message: contact }, contact)[0],
    ).toMatchObject({
      kind: 'contact',
      contact: { name: 'João', phone: '+55 11 99999-8888' },
    });

    const location = {
      messageType: 'LocationMessage',
      message: {
        locationMessage: {
          degreesLatitude: -23.55,
          degreesLongitude: -46.63,
          address: 'Av. Paulista',
        },
      },
    };
    expect(
      extractStructuredAttachments({ message: location }, location)[0],
    ).toMatchObject({
      kind: 'location',
      location: {
        latitude: -23.55,
        longitude: -46.63,
        address: 'Av. Paulista',
      },
    });
  });

  it('remove credenciais e chaves de mídia do payload persistido', () => {
    expect(
      sanitizeWebhookPayload({
        token: 'segredo',
        message: {
          content: { URL: 'https://media', mediaKey: 'chave', caption: 'ok' },
        },
      }),
    ).toEqual({
      message: { content: { URL: 'https://media', caption: 'ok' } },
    });
  });
});
