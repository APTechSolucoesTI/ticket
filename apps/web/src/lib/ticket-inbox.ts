import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { PendingType } from "@/components/ticket/PendingBadge";
import type { TicketPriority } from "@/components/ticket/PriorityBadge";
import type { TicketStatus } from "@/components/ticket/TicketBadge";
import type { TicketChannel } from "@/components/ticket/ChannelIcon";

export type TicketRow = {
  id: string;
  tenant_id: string;
  number: number;
  subject: string;
  status: TicketStatus;
  pending_type: PendingType;
  priority: TicketPriority;
  channel: TicketChannel;
  company_id: string | null;
  contact_id: string | null;
  contract_id: string | null;
  department_id: string | null;
  assigned_to: string | null;
  created_at: string;
  sla_resolution_due_at: string | null;
  sla_paused_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  resolution_summary: string | null;
  companies: { name: string } | null;
  contacts: { name: string } | null;
  assigneeName?: string;
};

export type TicketSummary = {
  inProgress: number;
  pending: number;
  finished: number;
  last7Count: number;
  last7DailyAverage: number;
  trendPercent: number;
  averageResolutionMs: number | null;
  resolutionSample: number;
};

export const SLA_DEFAULT_MIN = 240;

export const STATUS_OPTIONS: { value: TicketStatus; label: string }[] = [
  { value: "new", label: "Novo" },
  { value: "in_progress", label: "Em atendimento" },
  { value: "pending", label: "Pendente" },
  { value: "resolved", label: "Resolvido" },
  { value: "closed", label: "Fechado" },
];

export const PRIORITY_OPTIONS: { value: TicketPriority; label: string }[] = [
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Média" },
  { value: "high", label: "Alta" },
  { value: "urgent", label: "Urgente" },
];

export const CHANNEL_OPTIONS: { value: TicketChannel; label: string }[] = [
  { value: "email", label: "E-mail" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "chat", label: "Chat" },
  { value: "manual", label: "Manual" },
  { value: "portal", label: "Portal" },
];

export function calculateTicketSummary(tickets: TicketRow[]): TicketSummary {
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const currentStart = now - sevenDaysMs;
  const previousStart = currentStart - sevenDaysMs;
  let last7Count = 0;
  let previous7Count = 0;
  const resolutionDurations: number[] = [];

  for (const ticket of tickets) {
    const createdAt = new Date(ticket.created_at).getTime();
    if (createdAt >= currentStart && createdAt <= now) last7Count += 1;
    else if (createdAt >= previousStart && createdAt < currentStart) previous7Count += 1;

    const finishedAt = ticket.resolved_at ?? ticket.closed_at;
    if (finishedAt) {
      const duration = new Date(finishedAt).getTime() - createdAt;
      if (Number.isFinite(duration) && duration >= 0) resolutionDurations.push(duration);
    }
  }

  const trendPercent =
    previous7Count === 0
      ? last7Count === 0
        ? 0
        : 100
      : ((last7Count - previous7Count) / previous7Count) * 100;

  return {
    inProgress: tickets.filter((ticket) => ticket.status === "in_progress").length,
    pending: tickets.filter((ticket) => ticket.status === "pending").length,
    finished: tickets.filter((ticket) => ticket.status === "resolved" || ticket.status === "closed")
      .length,
    last7Count,
    last7DailyAverage: last7Count / 7,
    trendPercent,
    averageResolutionMs: resolutionDurations.length
      ? resolutionDurations.reduce((total, duration) => total + duration, 0) /
        resolutionDurations.length
      : null,
    resolutionSample: resolutionDurations.length,
  };
}

export function dueFor(ticket: TicketRow) {
  return (
    ticket.sla_resolution_due_at ??
    new Date(new Date(ticket.created_at).getTime() + SLA_DEFAULT_MIN * 60_000).toISOString()
  );
}

export function formatDecimal(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function trendDescription(trendPercent: number, last7Count: number) {
  const percentage = Math.abs(Math.round(trendPercent));
  if (trendPercent > 0) return `Crescimento de ${percentage}% · ${last7Count} no período`;
  if (trendPercent < 0) return `Declínio de ${percentage}% · ${last7Count} no período`;
  return `Volume estável · ${last7Count} no período`;
}

export function trendIcon(trendPercent: number): LucideIcon {
  if (trendPercent > 0) return ArrowUpRight;
  if (trendPercent < 0) return ArrowDownRight;
  return Minus;
}

export function formatResolutionTime(value: number | null) {
  if (value === null) return "-";
  const minutes = value / 60_000;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${formatDecimal(hours)} h`;
  return `${formatDecimal(hours / 24)} dias`;
}
