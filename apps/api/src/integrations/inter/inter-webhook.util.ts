import { createHash } from 'node:crypto';
import { z } from 'zod';

const situations = [
  'RECEBIDO',
  'A_RECEBER',
  'MARCADO_RECEBIDO',
  'ATRASADO',
  'CANCELADO',
  'EXPIRADO',
  'FALHA_EMISSAO',
  'EM_PROCESSAMENTO',
  'PROTESTO',
] as const;

const callbackSchema = z
  .array(
    z
      .object({
        codigoSolicitacao: z.string().uuid(),
        situacao: z.enum(situations).optional(),
        dataHoraSituacao: z.string().datetime({ offset: true }).optional(),
      })
      .passthrough(),
  )
  .min(1)
  .max(50);

export type NormalizedInterCallback = {
  codigo_solicitacao: string;
  situacao: (typeof situations)[number] | null;
  data_hora_situacao: string | null;
};

export function normalizeInterCallback(
  payload: unknown,
): NormalizedInterCallback[] {
  return callbackSchema.parse(payload).map((item) => ({
    codigo_solicitacao: item.codigoSolicitacao,
    situacao: item.situacao ?? null,
    data_hora_situacao: item.dataHoraSituacao ?? null,
  }));
}

export function hashWebhookToken(token: string): string {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error('invalid_token');
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
