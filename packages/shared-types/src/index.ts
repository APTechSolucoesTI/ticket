// Tipos compartilhados entre apps/web e apps/api. Espelham os enums reais
// do schema `apticket` no Postgres (supabase/migrations) — não são fonte da
// verdade, são o contrato de transporte entre frontend e backend novo.
//
// Só os tipos de RESPOSTA ficam aqui — o payload de requisição de cada rota
// é validado pelos DTOs do próprio Nest (class-validator, em
// apps/api/src/channels/*/dto/), que são a fonte real do contrato de
// entrada. Um tipo de request duplicado aqui sem uso real só apodrece.

export type TicketChannel = "email" | "whatsapp" | "chat" | "manual" | "portal";
export type TicketStatus = "new" | "in_progress" | "pending" | "resolved" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "urgent";

// --- Canal de e-mail ---

export interface EmailAccountDto {
  tenantId: string;
  inboxAddress: string | null;
  imapHost: string | null;
  imapPort: number;
  imapUser: string | null;
  imapSecure: boolean;
  smtpHost: string | null;
  smtpPort: number;
  smtpSecure: boolean;
  pollIntervalMinutes: number;
  enabled: boolean;
  lastPolledAt: string | null;
}

export interface TestConnectionResultDto {
  imapOk: boolean;
  smtpOk: boolean;
  error?: string;
}

// --- Canal de WhatsApp ---

export type WhatsappInstanceStatus = "disconnected" | "qr_pending" | "connected";

export interface WhatsappInstanceDto {
  tenantId: string;
  baseUrl: string | null;
  instanceName: string | null;
  connectedNumber: string | null;
  status: WhatsappInstanceStatus;
  webhookSecret: string | null;
}

// --- Canal de chat (WebSocket) ---

export interface ChatMessageEventDto {
  ticketId: string;
  content: string;
  authorId: string;
  authorType: "agent" | "contact";
}

export interface ChatTypingEventDto {
  ticketId: string;
  userId: string;
  isTyping: boolean;
}

export interface ChatPresenceEventDto {
  userId: string;
  online: boolean;
}
