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
});
