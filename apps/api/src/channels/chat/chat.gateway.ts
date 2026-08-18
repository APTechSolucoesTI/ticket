import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { SupabaseService } from '../../supabase/supabase.service';
import { RedisService } from '../../queue/redis.service';
import type {
  ChatMessageEventDto,
  ChatPresenceEventDto,
  ChatTypingEventDto,
} from '@apticket/shared-types';

const PRESENCE_TTL_SECONDS = 60; // expira sozinho se o socket cair sem "disconnect" limpo
const TYPING_TTL_SECONDS = 10;

interface SocketAuth {
  tenantId: string;
  userId: string;
  name: string;
}

interface SocketData {
  auth?: SocketAuth;
}

function getAuth(socket: Socket): SocketAuth | undefined {
  return (socket.data as SocketData).auth;
}

function setAuth(socket: Socket, auth: SocketAuth): void {
  (socket.data as SocketData).auth = auth;
}

// Namespace /chat, Socket.IO (não WS cru — reconexão automática, rooms e
// fallback de transporte de graça). O adapter Redis (RedisIoAdapter,
// plugado no main.ts) é quem faz `server.to(room).emit(...)` alcançar
// sockets conectados em OUTRA réplica da API, não só na atual.
@WebSocketGateway({
  namespace: 'chat',
  cors: { origin: true, credentials: true },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly redis: RedisService,
  ) {}

  async handleConnection(socket: Socket) {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return this.reject(socket, 'missing token');

    const user = await this.supabase.getUserFromJwt(token);
    if (!user) return this.reject(socket, 'invalid token');

    const { data: profile } = await this.supabase.client
      .from('profiles')
      .select('tenant_id, name')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile?.tenant_id) return this.reject(socket, 'no tenant');

    const auth: SocketAuth = {
      tenantId: profile.tenant_id,
      userId: user.id,
      name: profile.name,
    };
    setAuth(socket, auth);
    await socket.join(`tenant:${auth.tenantId}`);

    await this.redis.client.set(
      `chat:presence:${auth.tenantId}:${auth.userId}`,
      '1',
      'EX',
      PRESENCE_TTL_SECONDS,
    );
    const event: ChatPresenceEventDto = { userId: auth.userId, online: true };
    this.server.to(`tenant:${auth.tenantId}`).emit('presence:update', event);
  }

  async handleDisconnect(socket: Socket) {
    const auth = getAuth(socket);
    if (!auth) return;
    await this.redis.client.del(
      `chat:presence:${auth.tenantId}:${auth.userId}`,
    );
    const event: ChatPresenceEventDto = { userId: auth.userId, online: false };
    this.server.to(`tenant:${auth.tenantId}`).emit('presence:update', event);
  }

  private reject(socket: Socket, reason: string) {
    this.logger.warn(`connection rejected: ${reason}`);
    socket.disconnect(true);
  }

  @SubscribeMessage('ticket:join')
  async onJoinTicket(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { ticketId: string },
  ) {
    const auth = getAuth(socket);
    if (!auth) return;
    // Confia no RLS/tenant scoping do resto da API pra decidir quem pode ver
    // qual ticket — aqui só confere que o ticket é do mesmo tenant do socket.
    const { data: ticket } = await this.supabase.client
      .from('tickets')
      .select('id')
      .eq('id', body.ticketId)
      .eq('tenant_id', auth.tenantId)
      .maybeSingle();
    if (!ticket) return;
    await socket.join(`ticket:${body.ticketId}`);
  }

  @SubscribeMessage('message:send')
  async onMessageSend(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { ticketId: string; content: string },
  ) {
    const auth = getAuth(socket);
    if (!auth || !body.content?.trim()) return;

    const { data: ticket } = await this.supabase.client
      .from('tickets')
      .select('id, tenant_id')
      .eq('id', body.ticketId)
      .eq('tenant_id', auth.tenantId)
      .maybeSingle();
    if (!ticket) return;

    const { data: inserted, error } = await this.supabase.client
      .from('messages')
      .insert({
        tenant_id: auth.tenantId,
        ticket_id: ticket.id,
        author_id: auth.userId,
        author_type: 'agent',
        channel: 'chat',
        is_internal: false,
        content: body.content,
      })
      .select('id, created_at')
      .single();
    if (error) {
      this.logger.error(`message insert failed: ${error.message}`);
      return;
    }

    const event: ChatMessageEventDto & { id: string; createdAt: string } = {
      ticketId: ticket.id,
      content: body.content,
      authorId: auth.userId,
      authorType: 'agent',
      id: inserted.id,
      createdAt: inserted.created_at,
    };
    this.server.to(`ticket:${ticket.id}`).emit('message:receive', event);
  }

  @SubscribeMessage('typing')
  async onTyping(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { ticketId: string; isTyping: boolean },
  ) {
    const auth = getAuth(socket);
    if (!auth) return;
    const key = `chat:typing:${body.ticketId}:${auth.userId}`;
    if (body.isTyping)
      await this.redis.client.set(key, '1', 'EX', TYPING_TTL_SECONDS);
    else await this.redis.client.del(key);

    const event: ChatTypingEventDto = {
      ticketId: body.ticketId,
      userId: auth.userId,
      isTyping: body.isTyping,
    };
    socket.to(`ticket:${body.ticketId}`).emit('typing', event);
  }

  /** Chamado por outros módulos (ex.: ao reatribuir um ticket) — não gatilho ainda. */
  notifyTicketAssigned(
    tenantId: string,
    ticketId: string,
    assigneeId: string | null,
  ) {
    this.server
      .to(`tenant:${tenantId}`)
      .emit('ticket:assigned', { ticketId, assigneeId });
  }
}
