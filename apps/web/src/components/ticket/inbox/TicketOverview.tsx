import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Clock3,
  Mail,
  MessageCircle,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatDecimal,
  formatResolutionTime,
  trendDescription,
  trendIcon,
  type TicketSummary,
} from "@/lib/ticket-inbox";

type QueueSummary = {
  email: { hasPending: boolean; error: boolean };
  whatsapp: { hasPending: boolean; error: boolean };
};

export function TicketOverview({
  summary,
  loading,
  hasError,
  queueSummary,
  queueLoading,
  canViewEmailQueue,
  canViewWhatsappQueue,
}: {
  summary: TicketSummary;
  loading: boolean;
  hasError: boolean;
  queueSummary?: QueueSummary;
  queueLoading: boolean;
  canViewEmailQueue: boolean;
  canViewWhatsappQueue: boolean;
}) {
  const TrendIcon = trendIcon(summary.trendPercent);

  return (
    <section
      aria-labelledby="ticket-overview-title"
      className="shrink-0 border-b bg-gradient-to-br from-background via-background to-primary/[0.04] px-3 py-3"
    >
      <div className="mb-2.5 flex items-end justify-between gap-3">
        <div>
          <h1 id="ticket-overview-title" className="text-base font-semibold tracking-tight">
            Visão geral dos atendimentos
          </h1>
          <p className="text-[11px] text-muted-foreground">
            Volume atual, tendência recente e filas que precisam de ação.
          </p>
        </div>
        {hasError && <span className="text-[11px] text-destructive">Dados indisponíveis</span>}
      </div>

      <div className="grid auto-cols-[minmax(168px,1fr)] grid-flow-col gap-2 overflow-x-auto pb-1 xl:grid-flow-row xl:grid-cols-5 xl:overflow-visible xl:pb-0">
        <MetricCard
          label="Em atendimento"
          value={summary.inProgress}
          description="Tickets em execução agora"
          icon={CircleDot}
          tone="blue"
          loading={loading}
        />
        <MetricCard
          label="Pendentes"
          value={summary.pending}
          description="Aguardando novo retorno"
          icon={Clock3}
          tone="amber"
          loading={loading}
        />
        <MetricCard
          label="Resolvidos / Fechados"
          value={summary.finished}
          description="Atendimentos concluídos"
          icon={CheckCircle2}
          tone="green"
          loading={loading}
        />
        <MetricCard
          label="Últimos 7 dias"
          value={`${formatDecimal(summary.last7DailyAverage)} / dia`}
          description={trendDescription(summary.trendPercent, summary.last7Count)}
          icon={TrendIcon}
          tone={summary.trendPercent > 0 ? "blue" : summary.trendPercent < 0 ? "rose" : "slate"}
          loading={loading}
        />
        <MetricCard
          label="Tempo médio para resolução"
          value={formatResolutionTime(summary.averageResolutionMs)}
          description={`${summary.resolutionSample} atendimento(s) concluído(s)`}
          icon={Timer}
          tone="violet"
          loading={loading}
        />
      </div>

      {(canViewEmailQueue || canViewWhatsappQueue) && (
        <div className="mt-2 grid auto-cols-[minmax(250px,1fr)] grid-flow-col gap-2 overflow-x-auto pb-1 md:grid-flow-row md:grid-cols-2 md:overflow-visible md:pb-0">
          {canViewEmailQueue && (
            <QueueSummaryCard
              to="/email-pending"
              label="Fila de E-mail"
              hasPending={queueSummary?.email.hasPending ?? false}
              icon={Mail}
              loading={queueLoading}
              error={queueSummary?.email.error ?? false}
            />
          )}
          {canViewWhatsappQueue && (
            <QueueSummaryCard
              to="/whatsapp-pending"
              label="Fila do WhatsApp"
              hasPending={queueSummary?.whatsapp.hasPending ?? false}
              icon={MessageCircle}
              loading={queueLoading}
              error={queueSummary?.whatsapp.error ?? false}
            />
          )}
        </div>
      )}
    </section>
  );
}

const metricTones = {
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-300",
  amber: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  rose: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  slate: "bg-muted text-muted-foreground",
} as const;

function MetricCard({
  label,
  value,
  description,
  icon: Icon,
  tone,
  loading,
}: {
  label: string;
  value: number | string;
  description: string;
  icon: LucideIcon;
  tone: keyof typeof metricTones;
  loading: boolean;
}) {
  return (
    <article className="min-w-0 rounded-lg border bg-card p-3 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          {loading ? (
            <div className="mt-2 h-7 w-20 animate-pulse rounded bg-muted" />
          ) : (
            <p className="mt-1 font-mono text-xl font-semibold tracking-tight text-foreground">
              {value}
            </p>
          )}
        </div>
        <span className={cn("rounded-md p-2", metricTones[tone])} aria-hidden="true">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-1 truncate text-[10px] text-muted-foreground">{description}</p>
    </article>
  );
}

function QueueSummaryCard({
  to,
  label,
  hasPending,
  icon: Icon,
  loading,
  error,
}: {
  to: "/email-pending" | "/whatsapp-pending";
  label: string;
  hasPending: boolean;
  icon: LucideIcon;
  loading: boolean;
  error: boolean;
}) {
  const description = error
    ? "Não foi possível consultar a fila"
    : hasPending
      ? "Há mensagens aguardando tratamento"
      : "Nenhuma mensagem aguardando tratamento";

  return (
    <Link
      to={to}
      aria-label={`Abrir ${label}: ${description}`}
      className={cn(
        "group flex min-w-0 items-center gap-3 rounded-lg border bg-card px-3 py-2.5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        hasPending && !error ? "border-amber-500/35" : "border-border",
      )}
    >
      <span
        className={cn(
          "rounded-md p-2",
          hasPending && !error
            ? "bg-amber-500/12 text-amber-700 dark:text-amber-300"
            : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        )}
        aria-hidden="true"
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="text-xs font-semibold">{label}</p>
          {loading ? (
            <span className="h-4 w-7 animate-pulse rounded bg-muted" />
          ) : (
            <span className="font-mono text-sm font-semibold">
              {error ? "-" : hasPending ? "Pendente" : "Livre"}
            </span>
          )}
        </div>
        <p className="truncate text-[10px] text-muted-foreground">
          {loading ? "Consultando fila…" : description}
        </p>
      </div>
      <ArrowRight
        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
        aria-hidden="true"
      />
    </Link>
  );
}
