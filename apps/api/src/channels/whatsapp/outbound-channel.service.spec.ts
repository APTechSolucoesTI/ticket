import { BadRequestException } from '@nestjs/common';
import { OutboundChannelService } from './outbound-channel.service';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { SecretsService } from '../../crypto/secrets.service';
import type { UazapiService } from './uazapi.service';
import type { UpsertOutboundChannelDto } from './dto/upsert-outbound-channel.dto';

describe('OutboundChannelService', () => {
  const service = new OutboundChannelService(
    { client: {} } as SupabaseService,
    {} as SecretsService,
    {} as UazapiService,
  );

  it.each([
    [
      'nome ausente',
      { baseUrl: 'https://uazapi.local', token: 'token' },
      'Informe o nome do canal.',
    ],
    [
      'URL ausente',
      { name: 'Financeiro', token: 'token' },
      'Informe a URL base da uazapi.',
    ],
    [
      'token vazio no primeiro cadastro',
      { name: 'Financeiro', baseUrl: 'https://uazapi.local', token: '   ' },
      'Informe o token da uazapi no primeiro cadastro.',
    ],
  ])('retorna erro de domínio quando %s', async (_case, input, expected) => {
    await expect(
      service.upsert('tenant-id', null, input as UpsertOutboundChannelDto),
    ).rejects.toEqual(new BadRequestException(expected));
  });
});
