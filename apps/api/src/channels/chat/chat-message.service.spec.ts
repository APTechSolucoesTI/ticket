import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChatMessageService } from './chat-message.service';
import type { SupabaseService } from '../../supabase/supabase.service';

function makeService(ticket: { id: string; channel: string } | null) {
  const ticketQuery = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: ticket, error: null }),
  };
  const single = jest.fn().mockResolvedValue({
    data: { id: 'message-id', created_at: '2026-08-28T12:00:00.000Z' },
    error: null,
  });
  const selectInserted = jest.fn(() => ({ single }));
  const insert = jest.fn(() => ({ select: selectInserted }));
  const client = {
    from: jest.fn((table: string) =>
      table === 'tickets' ? ticketQuery : { insert },
    ),
  };
  const service = new ChatMessageService({
    client,
  } as unknown as SupabaseService);
  return { service, ticketQuery, insert };
}

describe('ChatMessageService', () => {
  it('persiste resposta do agente no tenant e canal corretos', async () => {
    const { service, ticketQuery, insert } = makeService({
      id: 'ticket-id',
      channel: 'chat',
    });

    await expect(
      service.sendAgentMessage('tenant-id', 'user-id', 'ticket-id', '  Olá  '),
    ).resolves.toEqual({
      id: 'message-id',
      ticketId: 'ticket-id',
      content: 'Olá',
      authorId: 'user-id',
      authorType: 'agent',
      createdAt: '2026-08-28T12:00:00.000Z',
    });
    expect(ticketQuery.eq).toHaveBeenCalledWith('tenant_id', 'tenant-id');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-id',
        ticket_id: 'ticket-id',
        author_id: 'user-id',
        author_type: 'agent',
        channel: 'chat',
        is_internal: false,
        content: 'Olá',
      }),
    );
  });

  it('não aceita ticket fora do tenant', async () => {
    const { service } = makeService(null);

    await expect(
      service.sendAgentMessage('tenant-id', 'user-id', 'ticket-id', 'Olá'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('não aceita resposta de chat em ticket de outro canal', async () => {
    const { service } = makeService({ id: 'ticket-id', channel: 'email' });

    await expect(
      service.sendAgentMessage('tenant-id', 'user-id', 'ticket-id', 'Olá'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
