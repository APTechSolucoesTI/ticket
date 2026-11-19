import { AutomationDispatchService } from './automation-dispatch.service';

describe('document publication notifications', () => {
  const dispatch = {
    id: 'dispatch',
    tenant_id: 'tenant',
    company_id: 'company',
    related_entity_id: 'batch',
    trigger_id: 'documentos_disponibilizados',
    attempt_count: 1,
    payload: {},
  };

  function fixture() {
    const config = { get: jest.fn(() => 'https://apticket.example.test') };
    const secrets = { decrypt: jest.fn(() => 'synthetic-credential') };
    const email = {
      sendTenantEmail: jest.fn().mockResolvedValue({ messageId: 'mail' }),
    };
    const whatsapp = { sendText: jest.fn().mockResolvedValue({ ok: true }) };
    const redis = {
      checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
    };
    const outputs: Record<string, unknown> = {
      automations: [
        {
          id: 'automation',
          recipient_profile: 'financeiro',
          outbound_channels: {
            active: true,
            base_url: 'https://wa.example.test',
            access_token: 'encrypted',
          },
          canned_responses: { body: 'Documentos disponíveis: {{portal_link}}' },
        },
      ],
      contact_companies: [],
      contacts: [
        {
          id: 'financial',
          name: 'Financeiro',
          email: 'finance@example.test',
          phone: '5511999991234',
          is_portal_financial: true,
        },
        {
          id: 'other',
          name: 'Outro',
          email: 'other@example.test',
          phone: '5511999992222',
          is_portal_financial: false,
        },
      ],
      client_documents: [{ competencia: '2026-11-01' }],
      companies: { name: 'Cliente' },
      tenants: {
        email_enabled: true,
        email_smtp_host: 'smtp.example.test',
        email_smtp_port: 465,
        email_smtp_secure: true,
        email_imap_user: 'sender@example.test',
        email_imap_password: 'encrypted',
      },
    };
    const client = {
      from: jest.fn((table: string) => {
        const result = Promise.resolve({ data: outputs[table], error: null });
        return Object.assign(result, {
          select: jest.fn().mockReturnValue(result),
          eq: jest.fn().mockReturnValue(result),
          is: jest.fn().mockReturnValue(result),
          not: jest.fn().mockReturnValue(result),
          maybeSingle: jest.fn().mockReturnValue(result),
          insert: jest.fn().mockReturnValue(result),
        });
      }),
    };
    const service = new AutomationDispatchService(
      { client } as never,
      secrets as never,
      redis as never,
      whatsapp as never,
      email as never,
      config as never,
    );
    return { service, email, whatsapp, outputs };
  }

  it('uses the configured outbound channel and emails the eligible financial contact', async () => {
    const { service, email, whatsapp } = fixture();
    await service.process(dispatch);
    expect(email.sendTenantEmail).toHaveBeenCalledTimes(1);
    expect(email.sendTenantEmail).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.example.test' }),
      expect.objectContaining({
        to: 'finance@example.test',
        text: 'Há novos documentos disponíveis no Portal do Cliente do APTicket. Acesse: https://apticket.example.test/portal',
      }),
    );
    expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendText).toHaveBeenCalledWith(
      'https://wa.example.test',
      'synthetic-credential',
      '5511999991234',
      'Documentos disponíveis: https://apticket.example.test/portal',
    );
  });

  it('sends the email even when no WhatsApp automation is active', async () => {
    const { service, email, whatsapp, outputs } = fixture();
    outputs.automations = [];
    await service.process(dispatch);
    expect(email.sendTenantEmail).toHaveBeenCalledTimes(1);
    expect(whatsapp.sendText).not.toHaveBeenCalled();
  });

  it('attempts WhatsApp even when email fails and reports the failed delivery', async () => {
    const { service, email, whatsapp } = fixture();
    email.sendTenantEmail.mockRejectedValueOnce(
      new Error('fixture mail failure'),
    );
    await expect(service.process(dispatch)).rejects.toThrow('Falha no envio');
    expect(whatsapp.sendText).toHaveBeenCalledTimes(1);
  });
});
