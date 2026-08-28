import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { SupabaseService } from '../../supabase/supabase.service';
import { RedisService } from '../../queue/redis.service';
import { verifySessionToken } from '../../auth/jwt.util';
import type { Env } from '../../config/env.validation';
import type {
  ChatPresenceEventDto,
  ChatTypingEventDto,
} from '@apticket/shared-types';
import {
  ChatMessageService,
  type PersistedChatMessage,
} from './chat-message.service';

const PRESENCE_TTL_SECONDS = 60; // expira sozinho se o socket cair sem "disconnect" limpo
const TYPING_TTL_SECONDS = 10;

interface SocketAuth {
  tenantId: string;
  userId: string;
  name: string;
  permissions: Set<string>;
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
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(ChatGateway.name);
  private readonly jwtSecret: string;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly redis: RedisService,
    private readonly messages: ChatMessageService,
    config: ConfigService<Env, true>,
  ) {
    this.jwtSecret = config.get('JWT_SECRET', { infer: true });
  }

  // Middleware de namespace: roda ANTES do handshake completar, ou seja,
  // antes do client receber o evento "connect". Sem isso, autenticar dentro
  // de handleConnection (que é async — 2 chamadas de rede) cria uma corrida:
  // o client já recebe "connect" e dispara "ticket:join" antes do servidor
  // terminar de resolver token → tenant, e o join é silenciosamente negado
  // (socket.data.auth ainda undefined). Autenticando aqui, o handshake só
  // termina depois que `socket.data.auth` já está setado.
  afterInit(namespace: Server) {
    namespace.use((socket: Socket, next: (err?: Error) => void) => {
      this.authenticate(socket).then(
        (auth) => {
          if (!auth) {
            next(new Error('unauthorized'));
            return;
          }
          setAuth(socket, auth);
          next();
        },
        (err: unknown) => {
          this.logger.error(
            `auth middleware falhou: ${err instanceof Error ? err.message : String(err)}`,
          );
          next(new Error('unauthorized'));
        },
      );
    });
  }

  private async authenticate(socket: Socket): Promise<SocketAuth | null> {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return null;

    const claims = verifySessionToken(token, this.jwtSecret);
    if (!claims) return null;

    const { data: profile } = await this.supabase.client
      .from('profiles')
      .select('tenant_id, name, is_active')
      .eq('id', claims.sub)
      .maybeSingle();
    if (
      !profile?.tenant_id ||
      !profile.is_active ||
      profile.tenant_id !== claims.tenantId
    )
      return null;

    const { data: permissionRows, error: permissionError } =
      await this.supabase.client.rpc('get_effective_permissions', {
        _user_id: claims.sub,
      });
    if (permissionError) return null;

    const permissions = new Set(
      (permissionRows ?? [])
        .filter((row) => row.effective)
        .map((row) => `${row.module}:${row.action}`),
    );
    if (!permissions.has('tickets:view')) return null;

    return {
      tenantId: profile.tenant_id,
      userId: claims.sub,
      name: profile.name,
      permissions,
    };
  }

  async handleConnection(socket: Socket) {
    // Se chegou até aqui, o middleware de `afterInit` já autenticou e
    // rejeitou quem não tinha token/tenant válido — isso aqui é só o que
    // precisa da conexão já aceita (rooms, presença).
    const auth = getAuth(socket);
    if (!auth) return;

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

  @SubscribeMessage('ticket:join')
  async onJoinTicket(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { ticketId: string },
  ) {
    const auth = getAuth(socket);
    if (!auth) {
      this.logger.warn('ticket:join sem auth no socket');
      return;
    }
    if (!auth.permissions.has('tickets:view')) return;
    // Confia no RLS/tenant scoping do resto da API pra decidir quem pode ver
    // qual ticket — aqui só confere que o ticket é do mesmo tenant do socket.
    const { data: ticket, error } = await this.supabase.client
      .from('tickets')
      .select('id')
      .eq('id', body.ticketId)
      .eq('tenant_id', auth.tenantId)
      .maybeSingle();
    if (error) {
      this.logger.error(`ticket:join lookup failed: ${error.message}`);
      return;
    }
    if (!ticket) {
      this.logger.warn(
        `ticket:join negado — ticket ${body.ticketId} nao pertence ao tenant ${auth.tenantId}`,
      );
      return;
    }
    await socket.join(`ticket:${body.ticketId}`);
    this.logger.log(`socket ${socket.id} entrou em ticket:${body.ticketId}`);
  }

  @SubscribeMessage('message:send')
  async onMessageSend(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { ticketId: string; content: string },
  ) {
    const auth = getAuth(socket);
    if (!auth) {
      this.logger.warn('message:send sem auth no socket');
      return;
    }
    if (!auth.permissions.has('tickets:edit')) return;
    try {
      const message = await this.messages.sendAgentMessage(
        auth.tenantId,
        auth.userId,
        body.ticketId,
        body.content,
      );
      this.logger.log(`message:send ok, id=${message.id}`);
      this.publishMessage(message);
      return { ok: true, messageId: message.id };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`message:send failed: ${detail}`);
      return { ok: false, error: detail };
    }
  }

  @SubscribeMessage('typing')
  async onTyping(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { ticketId: string; isTyping: boolean },
  ) {
    const auth = getAuth(socket);
    if (!auth) return;
    if (
      !auth.permissions.has('tickets:view') ||
      !socket.rooms.has(`ticket:${body.ticketId}`)
    )
      return;
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

  publishMessage(message: PersistedChatMessage) {
    this.server
      .to(`ticket:${message.ticketId}`)
      .emit('message:receive', message);
  }
}
