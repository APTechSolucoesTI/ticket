import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  CircleDot,
  Clock3,
  FileCheck2,
  Inbox,
  RefreshCw,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/lib/use-permissions";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TicketBadge, type TicketStatus } from "@/components/ticket/TicketBadge";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — APTicket" }] }),
  component: DashboardPage,
});

type TicketRow = {
  id: string;
  number: number;
  subject: string;
  status: string;
  priority: string;
  created_at: string;
  resolved_at: string | null;
  sla_resolution_due_at: string | null;
  assigned_to: string | null;
  company_id: string | null;
};

const PERIOD_OPTIONS = [7, 14, 30] as const;
type PeriodDays = (typeof PERIOD_OPTIONS)[number];

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function formatHours(hours: number) {
  if (!Number.isFinite(hours) || hours <= 0) return "0 min";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return minutes > 0 ? `${whole}h ${minutes}min` : `${whole}h`;
}

function DashboardPage() {
  const permissions = usePermissions();
  const { user } = useAuth();
  const [periodDays, setPeriodDays] = useState<PeriodDays>(14);
  const canTickets = permissions.has("tickets", "view");
  const canCompanies = permissions.has("clientes", "view");
  const canUsers = permissions.has("usuarios", "view");
  const canContracts = permissions.has("contratos", "view");

  const ticketsQuery = useQuery({
    queryKey: ["dashboard", "tickets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tickets")
        .select(
          "id, number, subject, status, priority, created_at, resolved_at, sla_resolution_due_at, assigned_to, company_id",
        )
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as TicketRow[];
    },
    enabled: !permissions.loading && canTickets,
  });

  const companiesQuery = useQuery({
    queryKey: ["dashboard", "companies"],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id, name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !permissions.loading && canTickets && canCompanies,
  });

  const profilesQuery = useQuery({
    queryKey: ["dashboard", "profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !permissions.loading && canTickets && canUsers,
  });

  const contractsQuery = useQuery({
    queryKey: ["dashboard", "contracts-active"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("contracts")
        .select("id", { count: "exact", head: true })
        .eq("status", "active");
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !permissions.loading && canContracts,
  });

  const tickets = useMemo(() => ticketsQuery.data ?? [], [ticketsQuery.data]);
  const companyMap = useMemo(
    () =>
      Object.fromEntries((companiesQuery.data ?? []).map((company) => [company.id, company.name])),
    [companiesQuery.data],
  );
  const profileMap = useMemo(
    () =>
      Object.fromEntries((profilesQuery.data ?? []).map((profile) => [profile.id, profile.name])),
    [profilesQuery.data],
  );

  const now = Date.now();
  const open = tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status));
  const inProgress = tickets.filter((ticket) => ticket.status === "in_progress").length;
  const pending = tickets.filter((ticket) => ticket.status === "pending").length;
  const finished = tickets.filter((ticket) =>
    ["resolved", "closed"].includes(ticket.status),
  ).length;
  const slaAtRisk = open.filter(
    (ticket) =>
      ticket.sla_resolution_due_at && new Date(ticket.sla_resolution_due_at).getTime() < now,
  ).length;
  const resolvedDurations = tickets
    .filter((ticket) => ticket.resolved_at)
    .map(
      (ticket) =>
        (new Date(ticket.resolved_at!).getTime() - new Date(ticket.created_at).getTime()) /
        3_600_000,
    );
  const averageResolutionHours = resolvedDurations.length
    ? resolvedDurations.reduce((sum, duration) => sum + duration, 0) / resolvedDurations.length
    : 0;

  const volumeData = useMemo(() => {
    const buckets: Array<{ date: string; iso: string; criados: number; resolvidos: number }> = [];
    for (let index = periodDays - 1; index >= 0; index--) {
      const date = startOfDay(new Date());
      date.setDate(date.getDate() - index);
      buckets.push({
        date: date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
        iso: date.toISOString().slice(0, 10),
        criados: 0,
        resolvidos: 0,
      });
    }
    const byDate = Object.fromEntries(buckets.map((bucket, index) => [bucket.iso, index]));
    for (const ticket of tickets) {
      const createdIndex = byDate[ticket.created_at?.slice(0, 10)];
      if (createdIndex !== undefined) buckets[createdIndex].criados += 1;
      const resolvedIndex = ticket.resolved_at
        ? byDate[ticket.resolved_at.slice(0, 10)]
        : undefined;
      if (resolvedIndex !== undefined) buckets[resolvedIndex].resolvidos += 1;
    }
    return buckets;
  }, [periodDays, tickets]);

  const currentPeriodStart = startOfDay(new Date());
  currentPeriodStart.setDate(currentPeriodStart.getDate() - periodDays + 1);
  const previousPeriodStart = new Date(currentPeriodStart);
  previousPeriodStart.setDate(previousPeriodStart.getDate() - periodDays);
  const currentPeriodCount = tickets.filter(
    (ticket) => new Date(ticket.created_at) >= currentPeriodStart,
  ).length;
  const previousPeriodCount = tickets.filter((ticket) => {
    const createdAt = new Date(ticket.created_at);
    return createdAt >= previousPeriodStart && createdAt < currentPeriodStart;
  }).length;
  const periodVariation =
    previousPeriodCount === 0
      ? currentPeriodCount > 0
        ? 100
        : 0
      : Math.round(((currentPeriodCount - previousPeriodCount) / previousPeriodCount) * 100);

  const statusBreakdown = [
    {
      status: "Novos",
      count: tickets.filter((ticket) => ticket.status === "new").length,
      color: "#45BDD6",
    },
    { status: "Em atendimento", count: inProgress, color: "#6366F1" },
    { status: "Pendentes", count: pending, color: "#F59E0B" },
    { status: "Concluídos", count: finished, color: "#10B981" },
  ];
  const latest = tickets.slice(0, 6);
  const displayName = user?.name?.trim() || user?.email?.split("@")[0] || "usuário";

  if (permissions.loading || (canTickets && ticketsQuery.isLoading)) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-5 p-4 sm:p-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Olá, {displayName}!</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Painel de controle da operação de suporte
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-label="Período do dashboard">
          <div className="inline-flex rounded-lg border bg-card p-1 shadow-card">
            {PERIOD_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                aria-pressed={periodDays === days}
                onClick={() => setPeriodDays(days)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  periodDays === days
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {days} dias
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void ticketsQuery.refetch();
              void contractsQuery.refetch();
            }}
          >
            <RefreshCw className={cn("size-3.5", ticketsQuery.isFetching && "animate-spin")} />
            Atualizar
          </Button>
        </div>
      </header>

      {canTickets && (
        <section
          aria-labelledby="operation-summary-title"
          className="rounded-xl border border-violet-200/70 bg-gradient-to-r from-violet-50 to-fuchsia-50/60 px-4 py-3 dark:border-violet-500/20 dark:from-violet-500/10 dark:to-fuchsia-500/5"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 rounded-lg bg-violet-500/10 p-2 text-violet-600 dark:text-violet-300">
              <Sparkles className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id="operation-summary-title" className="text-sm font-semibold">
                Resumo da operação
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {open.length} ticket(s) em aberto, {slaAtRisk} fora do prazo de resolução e{" "}
                {currentPeriodCount} criado(s) nos últimos {periodDays} dias.
              </p>
            </div>
          </div>
        </section>
      )}

      <section
        aria-label="Indicadores principais"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {canTickets && (
          <>
            <MetricCard
              label={`Novos em ${periodDays} dias`}
              value={currentPeriodCount}
              description="Tickets criados no período"
              icon={Activity}
              tone="blue"
              trend={periodVariation}
              trendLabel={`${periodDays} dias anteriores`}
              chart={volumeData}
            />
            <MetricCard
              label="Tickets abertos"
              value={open.length}
              description="Demanda ativa neste momento"
              icon={Inbox}
              tone="blue"
            />
            <MetricCard
              label="Em atendimento"
              value={inProgress}
              description="Tickets em execução"
              icon={CircleDot}
              tone="indigo"
            />
            <MetricCard
              label="Pendentes"
              value={pending}
              description="Aguardando novo retorno"
              icon={Clock3}
              tone="amber"
            />
            <MetricCard
              label="SLA em risco"
              value={slaAtRisk}
              description={slaAtRisk > 0 ? "Requer atenção da equipe" : "Nenhum prazo estourado"}
              icon={AlertTriangle}
              tone={slaAtRisk > 0 ? "rose" : "green"}
            />
            <MetricCard
              label="Tempo médio de resolução"
              value={formatHours(averageResolutionHours)}
              description={`${resolvedDurations.length} atendimento(s) na amostra`}
              icon={Clock3}
              tone="violet"
            />
            <MetricCard
              label="Concluídos"
              value={finished}
              description="Tickets resolvidos ou fechados"
              icon={CheckCircle2}
              tone="green"
            />
          </>
        )}
        {canContracts && (
          <MetricCard
            label="Contratos ativos"
            value={contractsQuery.data ?? 0}
            description="Clientes com cobertura vigente"
            icon={FileCheck2}
            tone="cyan"
          />
        )}
      </section>

      {!canTickets && !canContracts && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Não há indicadores disponíveis para os módulos permitidos ao seu usuário.
          </CardContent>
        </Card>
      )}

      {canTickets && ticketsQuery.isError && (
        <Card className="border-destructive/30">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-destructive">
              Não foi possível atualizar indicadores de tickets.
            </p>
            <Button variant="outline" size="sm" onClick={() => void ticketsQuery.refetch()}>
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      )}

      {canTickets && !ticketsQuery.isError && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-start justify-between gap-4 p-4 pb-2">
                <div>
                  <CardTitle className="text-sm font-semibold">Volume de tickets</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Criados e resolvidos nos últimos {periodDays} dias
                  </p>
                </div>
                <Trend trend={periodVariation} label="período anterior" />
              </CardHeader>
              <CardContent className="px-2 pb-3 pt-0 sm:px-4">
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={volumeData} margin={{ top: 16, right: 8, left: -24, bottom: 0 }}>
                    <defs>
                      <linearGradient id="created-gradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#45BDD6" stopOpacity={0.32} />
                        <stop offset="100%" stopColor="#45BDD6" stopOpacity={0.01} />
                      </linearGradient>
                      <linearGradient id="resolved-gradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10B981" stopOpacity={0.24} />
                        <stop offset="100%" stopColor="#10B981" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: 10, borderColor: "#E4E7EC", fontSize: 12 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="criados"
                      stroke="#1686A7"
                      strokeWidth={2}
                      fill="url(#created-gradient)"
                      name="Criados"
                    />
                    <Area
                      type="monotone"
                      dataKey="resolvidos"
                      stroke="#10B981"
                      strokeWidth={2}
                      fill="url(#resolved-gradient)"
                      name="Resolvidos"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm font-semibold">Distribuição por status</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Situação atual dos atendimentos
                </p>
              </CardHeader>
              <CardContent className="p-2 pt-0">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={statusBreakdown}
                      dataKey="count"
                      nameKey="status"
                      innerRadius={52}
                      outerRadius={78}
                      paddingAngle={3}
                    >
                      {statusBreakdown.map((entry) => (
                        <Cell key={entry.status} fill={entry.color} />
                      ))}
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ borderRadius: 10, borderColor: "#E4E7EC", fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between p-4 pb-3">
              <div>
                <CardTitle className="text-sm font-semibold">Últimos tickets</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">Movimentações mais recentes</p>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/tickets">
                  Ver todos <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead className="border-y bg-muted/50 text-xs text-muted-foreground">
                    <tr className="text-left">
                      <th className="px-4 py-2">#</th>
                      <th className="px-4 py-2">Assunto</th>
                      <th className="px-4 py-2">Cliente</th>
                      <th className="px-4 py-2">Técnico</th>
                      <th className="px-4 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.map((ticket) => (
                      <tr key={ticket.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-2 font-mono text-xs">#{ticket.number}</td>
                        <td className="max-w-[360px] px-4 py-2">
                          <Link
                            to="/tickets/$id"
                            params={{ id: ticket.id }}
                            className="block truncate font-medium hover:text-primary hover:underline"
                          >
                            {ticket.subject}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {ticket.company_id ? (companyMap[ticket.company_id] ?? "—") : "—"}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {ticket.assigned_to ? (profileMap[ticket.assigned_to] ?? "—") : "—"}
                        </td>
                        <td className="px-4 py-2">
                          <TicketBadge status={ticket.status as TicketStatus} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y md:hidden">
                {latest.map((ticket) => (
                  <Link
                    key={ticket.id}
                    to="/tickets/$id"
                    params={{ id: ticket.id }}
                    className="flex items-center gap-3 p-4 hover:bg-muted/40"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      #{ticket.number}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {ticket.subject}
                    </span>
                    <TicketBadge status={ticket.status as TicketStatus} />
                  </Link>
                ))}
              </div>
              {latest.length === 0 && (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  Nenhum ticket cadastrado ainda.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

const tones = {
  blue: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
  indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300",
  amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
  green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
  cyan: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
} as const;

function MetricCard({
  label,
  value,
  description,
  icon: Icon,
  tone,
  trend,
  trendLabel,
  chart,
}: {
  label: string;
  value: number | string;
  description: string;
  icon: LucideIcon;
  tone: keyof typeof tones;
  trend?: number;
  trendLabel?: string;
  chart?: Array<{ date: string; criados: number }>;
}) {
  return (
    <Card className="relative min-h-36 overflow-hidden">
      <CardContent className="flex h-full flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-3 text-2xl font-bold tracking-tight text-foreground">{value}</p>
          </div>
          <span className={cn("rounded-lg p-2.5", tones[tone])} aria-hidden="true">
            <Icon className="size-4" />
          </span>
        </div>
        <div className="mt-auto pt-2">
          {trend !== undefined && <Trend trend={trend} label={trendLabel ?? "período anterior"} />}
          <p className="mt-1 truncate text-[11px] text-muted-foreground">{description}</p>
        </div>
        {chart && (
          <div className="absolute inset-x-0 bottom-0 -z-0 h-9 opacity-40" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart}>
                <Area
                  type="monotone"
                  dataKey="criados"
                  stroke="#1686A7"
                  strokeWidth={1.5}
                  fill="#45BDD6"
                  fillOpacity={0.15}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Trend({ trend, label }: { trend: number; label: string }) {
  const positive = trend > 0;
  const negative = trend < 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium",
        positive && "text-emerald-600",
        negative && "text-rose-600",
        !positive && !negative && "text-muted-foreground",
      )}
    >
      {positive ? (
        <ArrowUpRight className="size-3" />
      ) : negative ? (
        <ArrowDownRight className="size-3" />
      ) : null}
      {positive ? "+" : ""}
      {trend}% <span className="font-normal text-muted-foreground">vs. {label}</span>
    </span>
  );
}

function DashboardSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-[1680px] space-y-5 p-4 sm:p-6"
      aria-label="Carregando dashboard"
    >
      <div className="flex justify-between gap-4">
        <div>
          <Skeleton className="h-7 w-64" />
          <Skeleton className="mt-2 h-4 w-80" />
        </div>
        <Skeleton className="h-9 w-64" />
      </div>
      <Skeleton className="h-16 w-full rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-36 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-80 lg:col-span-2" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}
