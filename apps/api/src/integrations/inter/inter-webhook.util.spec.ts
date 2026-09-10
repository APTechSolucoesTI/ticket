import { hashWebhookToken, normalizeInterCallback } from './inter-webhook.util';

describe('Inter webhook normalization', () => {
  it('keeps only the fields used to trigger active reconciliation', () => {
    const result = normalizeInterCallback([
      {
        codigoSolicitacao: '40000000-0000-4000-8000-000000000004',
        situacao: 'RECEBIDO',
        dataHoraSituacao: '2026-09-10T12:00:00Z',
        valorTotalRecebido: '1500.00',
        pagador: { cpfCnpj: '123' },
      },
    ]);
    expect(result).toEqual([
      {
        codigo_solicitacao: '40000000-0000-4000-8000-000000000004',
        situacao: 'RECEBIDO',
        data_hora_situacao: '2026-09-10T12:00:00Z',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('1500.00');
    expect(JSON.stringify(result)).not.toContain('cpfCnpj');
  });

  it('rejects unknown situations and oversized batches', () => {
    expect(() =>
      normalizeInterCallback([
        {
          codigoSolicitacao: '40000000-0000-4000-8000-000000000004',
          situacao: 'PAGO_INVENTADO',
        },
      ]),
    ).toThrow();
    expect(() =>
      normalizeInterCallback(Array.from({ length: 51 }, () => ({}))),
    ).toThrow();
  });

  it('hashes only strong hexadecimal tokens', () => {
    expect(hashWebhookToken('a'.repeat(64))).toHaveLength(64);
    expect(() => hashWebhookToken('short')).toThrow('invalid_token');
  });
});
