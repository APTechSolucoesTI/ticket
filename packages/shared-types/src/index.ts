// Tipos compartilhados entre apps/web e apps/api. Espelham os enums reais
// do schema `apticket` no Postgres (supabase/migrations) — não são fonte da
// verdade, são o contrato de transporte entre frontend e backend novo.

export type TicketChannel = "email" | "whatsapp" | "chat" | "manual" | "portal";
export type TicketStatus = "new" | "in_progress" | "pending" | "resolved" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "urgent";

// --- Canal de e-mail ---

export interface EmailAccountDto {
  tenantId: string;
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

export interface UpsertEmailAccountDto {
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPassword: string; // texto puro só no payload da requisição; nunca armazenado assim
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  pollIntervalMinutes: number;
  enabled: boolean;
}

export interface TestConnectionResultDto {
  imapOk: boolean;
  smtpOk: boolean;
  error?: string;
}

export interface SendEmailReplyDto {
  ticketId: string;
  html: string;
}

// --- Canal de WhatsApp ---

export type WhatsappInstanceStatus = "disconnected" | "qr_pending" | "connected";

export interface WhatsappInstanceDto {
  tenantId: string;
  instanceName: string | null;
  connectedNumber: string | null;
  status: WhatsappInstanceStatus;
}

export interface WhatsappSendMessageDto {
  ticketId: string;
  content: string;
}

export interface WhatsappWebhookEventDto {
  instanceId: string;
  messageId: string;
  from: string;
  content: string;
  timestamp: string;
  type: "message" | "status";
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
