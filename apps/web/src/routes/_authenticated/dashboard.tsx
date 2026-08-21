import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Inbox, AlertTriangle, Clock, FileCheck2, TrendingUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { TicketBadge, type TicketStatus } from "@/components/ticket/TicketBadge";
import { usePermissions } from "@/lib/use-permissions";

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

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function DashboardPage() {
  const permissions = usePermissions();
  const canTickets = permissions.has("tickets", "view");
  const canCompanies = permissions.has("clientes", "view");
  const canUsers = permissions.has("usuarios", "view");
  const canContracts = permissions.has("contratos", "view");
  const ticketsQ = useQuery({
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

  const companiesQ = useQuery({
    queryKey: ["dashboard", "companies"],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("id, name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !permissions.loading && canTickets && canCompanies,
  });

  const profilesQ = useQuery({
    queryKey: ["dashboard", "profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !permissions.loading && canTickets && canUsers,
  });

  const contractsQ = useQuery({
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

  const tickets = useMemo(() => ticketsQ.data ?? [], [ticketsQ.data]);
  const companyMap = useMemo(
    () => Object.fromEntries((companiesQ.data ?? []).map((c) => [c.id, c.name])),
    [companiesQ.data],
  );
  const profileMap = useMemo(
    () => Object.fromEntries((profilesQ.data ?? []).map((p) => [p.id, p.name])),
    [profilesQ.data],
  );

  const now = Date.now();
  const open = tickets.filter((t) => t.status !== "resolved" && t.status !== "closed");
  const slaAtRisk = open.filter(
    (t) => t.sla_resolution_due_at && new Date(t.sla_resolution_due_at).getTime() < now,
  ).length;

  const resolvedDurations = tickets
    .filter((t) => t.resolved_at)
    .map((t) => (new Date(t.resolved_at!).getTime() - new Date(t.created_at).getTime()) / 3600000);
  const mttrHoras = resolvedDurations.length
    ? Math.round((resolvedDurations.reduce((a, b) => a + b, 0) / resolvedDurations.length) * 10) /
      10
    : 0;

  // Volume últimos 14 dias
  const volumeData = useMemo(() => {
    const buckets: { date: string; criados: number; resolvidos: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = startOfDay(new Date());
      d.setDate(d.getDate() - i);
      buckets.push({
        date: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
        criados: 0,
        resolvidos: 0,
      });
    }
    const idxByISO: Record<string, number> = {};
    for (let i = 13; i >= 0; i--) {
      const d = startOfDay(new Date());
      d.setDate(d.getDate() - i);
      idxByISO[d.toISOString().slice(0, 10)] = 13 - i;
    }
    for (const t of tickets) {
      const c = t.created_at?.slice(0, 10);
      if (c && idxByISO[c] !== undefined) buckets[idxByISO[c]].criados++;
      const r = t.resolved_at?.slice(0, 10);
      if (r && idxByISO[r] !== undefined) buckets[idxByISO[r]].resolvidos++;
    }
    return buckets;
  }, [tickets]);

  const criadosSem1 = volumeData.slice(0, 7).reduce((s, d) => s + d.criados, 0);
  const criadosSem2 = volumeData.slice(7).reduce((s, d) => s + d.criados, 0);
  const variacao =
    criadosSem1 === 0
      ? criadosSem2 > 0
        ? 100
        : 0
      : Math.round(((criadosSem2 - criadosSem1) / criadosSem1) * 100);
  const positivo = variacao >= 0;

  const statusBreakdown = useMemo(
    () => [
      {
        status: "Abertos",
        count: tickets.filter((t) => t.status === "open").length,
        color: "#0EA5E9",
      },
      {
        status: "Em atendimento",
        count: tickets.filter((t) => t.status === "in_progress").length,
        color: "#8B5CF6",
      },
      {
        status: "Pendentes",
        count: tickets.filter((t) => t.status === "pending").length,
        color: "#F59E0B",
      },
      {
        status: "Resolvidos",
        count: tickets.filter((t) => t.status === "resolved").length,
        color: "#10B981",
      },
    ],
    [tickets],
  );

  const kpis = [
    ...(canTickets
      ? [
          {
            label: "Tickets abertos",
            value: open.length,
            icon: Inbox,
            color: "text-sky-600 bg-sky-50",
          },
          {
            label: "SLA em risco",
            value: slaAtRisk,
            icon: AlertTriangle,
            color: "text-amber-600 bg-amber-50",
          },
          {
            label: "MTTR (horas)",
            value: mttrHoras,
            icon: Clock,
            color: "text-violet-600 bg-violet-50",
          },
        ]
      : []),
    ...(canContracts
      ? [
          {
            label: "Contratos ativos",
            value: contractsQ.data ?? 0,
            icon: FileCheck2,
            color: "text-emerald-600 bg-emerald-50",
          },
        ]
      : []),
  ];

  const latest = tickets.slice(0, 6);

  if (permissions.loading || (canTickets && ticketsQ.isLoading)) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando dashboard…</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Visão consolidada da operação de suporte.</p>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Card key={k.label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`size-10 rounded-lg grid place-items-center ${k.color}`}>
                  <Icon className="size-5" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{k.label}</div>
                  <div className="text-2xl font-bold">{k.value}</div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!canTickets && !canContracts && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Não há indicadores disponíveis para os módulos permitidos ao seu usuário.
          </CardContent>
        </Card>
      )}

      {canTickets && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div>
                  <CardTitle className="text-base font-bold">Volume de tickets</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Últimos 14 dias · criados vs. resolvidos
                  </p>
                </div>
                <Badge variant={positivo ? "default" : "destructive"} className="gap-1">
                  <TrendingUp className={`size-3 ${positivo ? "" : "rotate-180"}`} />
                  {positivo ? "+" : ""}
                  {variacao}%
                </Badge>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={volumeData}>
                    <defs>
                      <linearGradient id="grad-criados" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0EA5E9" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#0EA5E9" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="grad-resolvidos" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10B981" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="criados"
                      stroke="#0EA5E9"
                      strokeWidth={2.5}
                      fill="url(#grad-criados)"
                      name="Criados"
                    />
                    <Area
                      type="monotone"
                      dataKey="resolvidos"
                      stroke="#10B981"
                      strokeWidth={2.5}
                      fill="url(#grad-resolvidos)"
                      name="Resolvidos"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-bold">Por status</CardTitle>
                <p className="text-xs text-muted-foreground">Distribuição atual</p>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={statusBreakdown}
                      dataKey="count"
                      nameKey="status"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {statusBreakdown.map((entry) => (
                        <Cell key={entry.status} fill={entry.color} />
                      ))}
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base font-bold">Últimos tickets</CardTitle>
              <Link to="/tickets" className="text-xs text-primary hover:underline">
                Ver todos
              </Link>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground bg-muted/40">
                  <tr className="text-left">
                    <th className="py-2 px-4">#</th>
                    <th className="py-2 px-4">Assunto</th>
                    <th className="py-2 px-4">Cliente</th>
                    <th className="py-2 px-4">Técnico</th>
                    <th className="py-2 px-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {latest.map((t) => (
                    <tr key={t.id} className="border-t">
                      <td className="py-2 px-4 font-mono text-xs">#{t.number}</td>
                      <td className="py-2 px-4">
                        <Link
                          to="/tickets/$id"
                          params={{ id: String(t.id) }}
                          className="hover:underline"
                        >
                          {t.subject}
                        </Link>
                      </td>
                      <td className="py-2 px-4 text-muted-foreground">
                        {t.company_id ? (companyMap[t.company_id] ?? "—") : "—"}
                      </td>
                      <td className="py-2 px-4">
                        {t.assigned_to ? (profileMap[t.assigned_to] ?? "—") : "—"}
                      </td>
                      <td className="py-2 px-4">
                        <TicketBadge status={t.status as TicketStatus} />
                      </td>
                    </tr>
                  ))}
                  {latest.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                        Nenhum ticket cadastrado ainda.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
