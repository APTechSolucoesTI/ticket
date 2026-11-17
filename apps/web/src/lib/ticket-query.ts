import { z } from "zod";

const statuses = z.enum(["new", "in_progress", "pending", "resolved", "closed"]);
const priorities = z.enum(["low", "medium", "high", "urgent"]);
const channels = z.enum(["email", "whatsapp", "chat", "manual", "portal"]);
const attendance = z.enum(["contratual", "avulso"]);
const sortKeys = z.enum([
  "",
  "number",
  "subject",
  "customer",
  "company",
  "contact",
  "assignee",
  "priority",
  "sla",
  "status",
  "channel",
  "created_at",
]);
const arrayInput = (value: unknown) =>
  typeof value === "string" ? value.split(",").filter(Boolean) : value;
const list = <T extends z.ZodType>(item: T) => z.preprocess(arrayInput, z.array(item).max(100));
export const ticketListSearchSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1).catch(1),
  pageSize: z.coerce
    .number()
    .refine((value) => [10, 20, 30, 50, 100].includes(value))
    .default(10)
    .catch(10),
  search: z.string().trim().max(200).default("").catch(""),
  status: list(statuses).default(["new", "in_progress", "pending"]).catch([]),
  attendanceType: list(attendance).default([]).catch([]),
  priority: list(priorities).default([]).catch([]),
  channel: list(channels).default([]).catch([]),
  assignee: list(z.uuid()).default([]).catch([]),
  department: list(z.uuid()).default([]).catch([]),
  sortKey: sortKeys.default("").catch(""),
  sortDirection: z.enum(["asc", "desc"]).default("desc").catch("desc"),
  view: z.enum(["list", "kanban"]).default("list").catch("list"),
});
export type TicketListQuery = z.infer<typeof ticketListSearchSchema>;
export const ticketRowSchema = z.object({
  id: z.uuid(),
  tenant_id: z.uuid(),
  number: z.number().int(),
  subject: z.string(),
  status: statuses,
  pending_type: z
    .enum(["awaiting_tech", "awaiting_customer", "tech_response", "in_progress"])
    .nullable(),
  priority: priorities,
  channel: channels,
  company_id: z.uuid().nullable(),
  contact_id: z.uuid().nullable(),
  contract_id: z.uuid().nullable(),
  tipo_atendimento: attendance,
  motivo_avulso: z.enum(["cliente_sem_contrato", "equipamento_sem_contrato"]).nullable(),
  department_id: z.uuid().nullable(),
  assigned_to: z.uuid().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  sla_resolution_due_at: z.string().nullable(),
  sla_paused_at: z.string().nullable(),
  resolved_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  resolution_summary: z.string().nullable(),
  companies: z.object({ name: z.string() }).nullable(),
  contacts: z.object({ name: z.string() }).nullable(),
  assigneeName: z.string().nullable(),
});
export const ticketInboxResultSchema = z.object({
  items: z.array(ticketRowSchema).max(100),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().refine((value) => [10, 20, 30, 50, 100].includes(value)),
});
export const ticketSummarySchema = z.object({
  inProgress: z.number().nonnegative(),
  pending: z.number().nonnegative(),
  finished: z.number().nonnegative(),
  last7Count: z.number().nonnegative(),
  last7DailyAverage: z.number().nonnegative(),
  trendPercent: z.number(),
  averageResolutionMs: z.number().nonnegative().nullable(),
  resolutionSample: z.number().int().nonnegative(),
});
export const ticketMetricsSchema = z.object({
  newCount: z.number().nonnegative(),
  inProgress: z.number().nonnegative(),
  pending: z.number().nonnegative(),
  finished: z.number().nonnegative(),
  openCount: z.number().nonnegative(),
  slaAtRisk: z.number().nonnegative(),
  currentPeriodCount: z.number().nonnegative(),
  previousPeriodCount: z.number().nonnegative(),
  averageResolutionHours: z.number().nonnegative(),
  summary: ticketSummarySchema,
  volume: z.array(
    z.object({
      date: z.string(),
      iso: z.string(),
      criados: z.number().nonnegative(),
      resolvidos: z.number().nonnegative(),
    }),
  ),
  latest: z.array(ticketRowSchema).max(6),
  timezone: z.literal("America/Sao_Paulo"),
});
export const emptyTicketSummary = ticketSummarySchema.parse({
  inProgress: 0,
  pending: 0,
  finished: 0,
  last7Count: 0,
  last7DailyAverage: 0,
  trendPercent: 0,
  averageResolutionMs: null,
  resolutionSample: 0,
});
export const emptyTicketMetrics = ticketMetricsSchema.parse({
  newCount: 0,
  inProgress: 0,
  pending: 0,
  finished: 0,
  openCount: 0,
  slaAtRisk: 0,
  currentPeriodCount: 0,
  previousPeriodCount: 0,
  averageResolutionHours: 0,
  summary: emptyTicketSummary,
  volume: [],
  latest: [],
  timezone: "America/Sao_Paulo",
});
