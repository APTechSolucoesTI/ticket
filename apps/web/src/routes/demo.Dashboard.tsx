import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Inbox, AlertTriangle, Clock, FileCheck2, TrendingUp } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, PieChart, Pie, Cell, Legend } from "recharts";
import { demoKPIs, demoVolume14d, demoStatusBreakdown, demoTickets } from "@/lib/demo-seed";

export const Route = createFileRoute("/demo/Dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Demo APTicket" }, { name: "robots", content: "noindex" }] }),
  component: DemoDashboard,
});

function DemoDashboard() {
  const criadosSem1 = demoVolume14d.slice(0, 7).reduce((s, d) => s + d.criados, 0);
  const criadosSem2 = demoVolume14d.slice(7).reduce((s, d) => s + d.criados, 0);
  const variacao = criadosSem1 === 0 ? 0 : Math.round(((criadosSem2 - criadosSem1) / criadosSem1) * 100);
  const positivo = variacao >= 0;

  const kpis = [
    { label: "Tickets abertos",   value: demoKPIs.ticketsAbertos, icon: Inbox,        color: "text-sky-600 bg-sky-50" },
    { label: "SLA em risco",       value: demoKPIs.slaEmRisco,     icon: AlertTriangle, color: "text-amber-600 bg-amber-50" },
    { label: "MTTR (horas)",       value: demoKPIs.mttrHoras,      icon: Clock,        color: "text-violet-600 bg-violet-50" },
    { label: "Contratos ativos",   value: demoKPIs.contratosAtivos, icon: FileCheck2,  color: "text-emerald-600 bg-emerald-50" },
  ];

  return (
    <div className="space-y-6">
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
                <div className={`size-10 rounded-lg grid place-items-center ${k.color}`}><Icon className="size-5" /></div>
                <div>
                  <div className="text-xs text-muted-foreground">{k.label}</div>
                  <div className="text-2xl font-bold">{k.value}</div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between pb-2">
            <div>
              <CardTitle className="text-base font-bold">Volume de tickets</CardTitle>
              <p className="text-xs text-muted-foreground">Últimos 14 dias · criados vs. resolvidos</p>
            </div>
            <Badge variant={positivo ? "default" : "destructive"} className="gap-1">
              <TrendingUp className={`size-3 ${positivo ? "" : "rotate-180"}`} />
              {positivo ? "+" : ""}{variacao}%
            </Badge>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={demoVolume14d}>
                <defs>
                  <linearGradient id="grad-criados" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"  stopColor="#0EA5E9" stopOpacity={0.4}/>
                    <stop offset="100%" stopColor="#0EA5E9" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="grad-resolvidos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"  stopColor="#10B981" stopOpacity={0.4}/>
                    <stop offset="100%" stopColor="#10B981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Area type="monotone" dataKey="criados"    stroke="#0EA5E9" strokeWidth={2.5} fill="url(#grad-criados)"    name="Criados" />
                <Area type="monotone" dataKey="resolvidos" stroke="#10B981" strokeWidth={2.5} fill="url(#grad-resolvidos)" name="Resolvidos" />
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
                <Pie data={demoStatusBreakdown} dataKey="count" nameKey="status" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {demoStatusBreakdown.map((entry) => <Cell key={entry.status} fill={entry.color} />)}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-bold">Últimos tickets</CardTitle>
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
              {demoTickets.slice(0, 6).map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="py-2 px-4 font-mono text-xs">#{t.number}</td>
                  <td className="py-2 px-4">{t.subject}</td>
                  <td className="py-2 px-4 text-muted-foreground">{t.companyName}</td>
                  <td className="py-2 px-4">{t.assigneeName}</td>
                  <td className="py-2 px-4"><Badge variant="outline" className="text-[10px]">{t.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
