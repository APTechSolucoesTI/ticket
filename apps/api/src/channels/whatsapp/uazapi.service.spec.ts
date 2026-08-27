import { UazapiService } from './uazapi.service';

describe('UazapiService', () => {
  it.each([
    ['image', 'image/png', undefined],
    ['document', 'application/pdf', 'manual.pdf'],
    ['ptt', 'audio/webm;codecs=opus', undefined],
  ] as const)(
    'envia mídia do tipo %s com o contrato atual da API',
    async (type, mimetype, docName) => {
      const service = new UazapiService();
      const call = jest.spyOn(service, 'call').mockResolvedValue({
        ok: true,
        status: 200,
        body: { id: 'message-1' },
      });

      await service.sendMedia('https://uazapi.example', 'secret', {
        number: '(11) 99999-8888',
        type,
        file: 'https://storage.example/file',
        text: 'Legenda',
        docName,
        mimetype,
      });

      expect(call).toHaveBeenCalledWith(
        'https://uazapi.example',
        'secret',
        '/send/media',
        {
          method: 'POST',
          body: JSON.stringify({
            number: '5511999998888',
            type,
            file: 'https://storage.example/file',
            text: 'Legenda',
            docName,
            mimetype,
          }),
        },
      );
    },
  );

  it('envia contato no contrato UAZAPI v2', async () => {
    const service = new UazapiService();
    const call = jest
      .spyOn(service, 'call')
      .mockResolvedValue({ ok: true, status: 200, body: {} });
    await service.sendContact(
      'https://uazapi.example',
      'secret',
      '11988887777',
      {
        name: 'Ana Silva',
        phone: '11999998888',
      },
    );
    expect(call).toHaveBeenCalledWith(
      'https://uazapi.example',
      'secret',
      '/send/contact',
      {
        method: 'POST',
        body: JSON.stringify({
          number: '5511988887777',
          fullName: 'Ana Silva',
          phoneNumber: '5511999998888',
        }),
      },
    );
  });

  it('envia localização, figurinha e ligação nos endpoints corretos', async () => {
    const service = new UazapiService();
    const call = jest
      .spyOn(service, 'call')
      .mockResolvedValue({ ok: true, status: 200, body: {} });
    await service.sendLocation('https://uazapi.example', 'secret', {
      number: '11988887777',
      latitude: -23.55,
      longitude: -46.63,
      name: 'Escritório',
    });
    await service.sendMedia('https://uazapi.example', 'secret', {
      number: '11988887777',
      type: 'sticker',
      file: 'https://storage.example/sticker.webp',
      mimetype: 'image/webp',
    });
    await service.makeCall(
      'https://uazapi.example',
      'secret',
      '11988887777',
      15,
    );
    expect(call.mock.calls[0]).toEqual([
      'https://uazapi.example',
      'secret',
      '/send/location',
      {
        method: 'POST',
        body: JSON.stringify({
          number: '5511988887777',
          latitude: -23.55,
          longitude: -46.63,
          name: 'Escritório',
        }),
      },
    ]);
    expect(call.mock.calls.map((args) => args[2])).toEqual([
      '/send/location',
      '/send/media',
      '/call/make',
    ]);
  });
});
