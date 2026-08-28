import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ChatMessageEventDto } from '@apticket/shared-types';
import { SupabaseService } from '../../supabase/supabase.service';

export type PersistedChatMessage = ChatMessageEventDto & {
  id: string;
  createdAt: string;
};

@Injectable()
export class ChatMessageService {
  constructor(private readonly supabase: SupabaseService) {}

  async sendAgentMessage(
    tenantId: string,
    userId: string,
    ticketId: string,
    content: string,
  ): Promise<PersistedChatMessage> {
    const normalizedContent = content.trim();
    if (!normalizedContent) {
      throw new BadRequestException('Mensagem vazia');
    }

    const { data: ticket, error: ticketError } = await this.supabase.client
      .from('tickets')
      .select('id, channel')
      .eq('id', ticketId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (ticketError) throw ticketError;
    if (!ticket) throw new NotFoundException('Ticket não encontrado');
    if (ticket.channel !== 'chat') {
      throw new BadRequestException('Ticket não é de origem chat');
    }

    const { data: inserted, error } = await this.supabase.client
      .from('messages')
      .insert({
        tenant_id: tenantId,
        ticket_id: ticket.id,
        author_id: userId,
        author_type: 'agent',
        channel: 'chat',
        is_internal: false,
        content: normalizedContent,
      })
      .select('id, created_at')
      .single();
    if (error) throw error;

    return {
      ticketId: ticket.id,
      content: normalizedContent,
      authorId: userId,
      authorType: 'agent',
      id: inserted.id,
      createdAt: inserted.created_at,
    };
  }
}
