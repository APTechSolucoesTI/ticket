import {
  extractExternalId,
  extractName,
  extractPhone,
  extractText,
  isFromMe,
  normalizeStatus,
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
});
