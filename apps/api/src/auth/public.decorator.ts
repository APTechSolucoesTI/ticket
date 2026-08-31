import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca uma rota como pública (sem exigir JWT de usuário) - só usado nos
 * webhooks (uazapi), que se autenticam por segredo próprio do tenant, não
 * por sessão de usuário logado.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
