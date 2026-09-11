import {
  CollectionDispatchError,
  CollectionDispatchService,
} from './collection-dispatch.service';
import type { CollectionAction } from './collection.types';

const action = (channel: CollectionAction['channel']): CollectionAction => ({
  id: '10000000-0000-0000-0000-000000000001',
  tenant_id: '10000000-0000-0000-0000-000000000002',
  operating_company_id: '10000000-0000-0000-0000-000000000003',
  channel,
  attempt_count: 1,
  recipient_snapshot: {
    name: 'Maria',
    customer_name: 'Empresa Cliente',
    email: 'financeiro@example.test',
    phone: '+55 (19) 99999-0000',
  },
  content_snapshot: {
    subject: 'Cobrança pendente',
    message_template:
      'Olá {{cliente}}, o título {{documento}} de {{valor}} venceu em {{vencimento}}.',
    document: 'REC-100',
    amount: 982.44,
    due_date: '2026-09-10',
  },
});

describe('CollectionDispatchService', () => {
  const tenant = {
    name: 'APTech',
    email_enabled: true,
    email_imap_user: 'sender@example.test',
    email_imap_password: 'encrypted',
    email_smtp_host: 'smtp.example.test',
    email_smtp_port: 587,
    email_smtp_secure: false,
    whatsapp_enabled: true,
    whatsapp_uazapi_base_url: 'https://uazapi.example.test',
    whatsapp_uazapi_token: 'encrypted-token',
  };
  const maybeSingle = jest
    .fn()
    .mockResolvedValue({ data: tenant, error: null });
  const supabase = {
    client: {
      rpc: jest.fn(),
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ maybeSingle }),
        }),
      }),
    },
  };
  const secrets = { decrypt: jest.fn((value: string) => `plain:${value}`) };
  const redis = {
    checkRateLimit: jest
      .fn()
      .mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
  };
  const email = {
    sendTenantEmail: jest.fn((smtp: unknown, options: { text: string }) => {
      void smtp;
      void options;
      return Promise.resolve({ messageId: 'mail-1' });
    }),
  };
  const uazapi = {
    sendText: jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, body: { id: 'wa-1' } }),
  };
  const service = new CollectionDispatchService(
    supabase as never,
    secrets as never,
    redis as never,
    email as never,
    uazapi as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('envia e-mail com variáveis financeiras renderizadas', async () => {
    await expect(service.dispatch(action('email'))).resolves.toBe('mail-1');
    expect(email.sendTenantEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'sender@example.test',
        password: 'plain:encrypted',
      }),
      expect.objectContaining({
        to: 'financeiro@example.test',
        subject: 'Cobrança pendente',
      }),
    );
    expect(email.sendTenantEmail.mock.calls[0]?.[1].text).toContain('982,44');
  });

  it('envia WhatsApp usando token descriptografado e preserva o id externo', async () => {
    await expect(service.dispatch(action('whatsapp'))).resolves.toBe('wa-1');
    expect(uazapi.sendText).toHaveBeenCalledWith(
      'https://uazapi.example.test',
      'plain:encrypted-token',
      '+55 (19) 99999-0000',
      expect.stringContaining('REC-100'),
    );
  });

  it('mantém SMS bloqueado sem provedor', async () => {
    await expect(
      service.dispatch(action('sms')),
    ).rejects.toMatchObject<CollectionDispatchError>({
      retryable: false,
    });
  });

  it('processa suspensões financeiras pelo RPC de serviço', async () => {
    supabase.client.rpc.mockResolvedValueOnce({
      data: {
        suspended_contracts: 1,
        released_contracts: 0,
        ignored_events: 0,
        failed_events: 0,
      },
      error: null,
    });

    await expect(service.processContractEvents()).resolves.toEqual(
      expect.objectContaining({ suspended_contracts: 1 }),
    );
    expect(supabase.client.rpc).toHaveBeenCalledWith(
      'process_contract_financial_events',
      expect.objectContaining({ p_limit: 100 }),
    );
  });
});
