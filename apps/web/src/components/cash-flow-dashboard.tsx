import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowDownToLine, ArrowUpFromLine, CalendarRange, Landmark, Scale } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { supabase } from "@/integrations/supabase/client";

type Company = { id: string; legal_name: string };
type CashEntry = {
  tenant_id: string;
  operating_company_id: string;
  direction: "inflow" | "outflow";
  source_type: "measurement_receivable" | "recurring_receivable" | "supplier_payable";
  source_id: string;
  document_number: string;
  counterparty_name: string;
  description: string;
  competence: string;
  planned_date: string;
  realized_date: string | null;
  planned_amount: number;
  open_amount: number;
  realized_amount: number;
  cash_status: "pending" | "overdue" | "realized" | "cancelled";
  source_status: string;
  reconciliation_status: "pending" | "matched" | "difference" | null;
  difference_amount: number | null;
};

const db = supabase as unknown as SupabaseClient;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const compactMoney = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});
const dateFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const sourceLabels = {
  measurement_receivable: "Medição",
  recurring_receivable: "Recorrente",
  supplier_payable: "Fornecedor",
};
const statusLabels = {
  pending: "Pendente",
  overdue: "Vencido",
  realized: "Realizado",
  cancelled: "Cancelado",
};

function monthStart(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-01`;
}
function defaultPeriod() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 6, 0);
  return {
    start: monthStart(now),
    end: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`,
  };
}

export function CashFlowDashboard() {
  const initial = defaultPeriod();
  const [companyId, setCompanyId] = useState("");
  const [startDate, setStartDate] = useState(initial.start);
  const [endDate, setEndDate] = useState(initial.end);
  const [direction, setDirection] = useState<"all" | CashEntry["direction"]>("all");
  const [status, setStatus] = useState<"all" | CashEntry["cash_status"]>("all");
  const [search, setSearch] = useState("");
  const companies = useQuery({
    queryKey: ["cash-flow-companies"],
    queryFn: async () => {
      const { data, error } = await db
        .from("operating_companies")
        .select("id,legal_name")
        .is("deleted_at", null)
        .order("legal_name");
      if (error) throw error;
      return (data ?? []) as Company[];
    },
  });
  useEffect(() => {
    if (!companyId && companies.data?.[0]) setCompanyId(companies.data[0].id);
  }, [companies.data, companyId]);
  const query = useQuery({
    queryKey: ["cash-flow", companyId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const { data, error } = await db
        .from("cash_flow_entries")
        .select("*")
        .eq("operating_company_id", companyId)
        .order("planned_date")
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as CashEntry[];
    },
  });
  const periodRows = useMemo(
    () =>
      (query.data ?? []).filter(
        (item) => item.planned_date >= startDate && item.planned_date <= endDate,
      ),
    [endDate, query.data, startDate],
  );
  const activeRows = periodRows.filter((item) => item.cash_status !== "cancelled");
  const plannedIn = activeRows
    .filter((item) => item.direction === "inflow")
    .reduce((sum, item) => sum + Number(item.planned_amount), 0);
  const plannedOut = activeRows
    .filter((item) => item.direction === "outflow")
    .reduce((sum, item) => sum + Number(item.planned_amount), 0);
  const realizedIn = (query.data ?? [])
    .filter(
      (item) =>
        item.direction === "inflow" &&
        item.realized_date &&
        item.realized_date >= startDate &&
        item.realized_date <= endDate,
    )
    .reduce((sum, item) => sum + Number(item.realized_amount), 0);
  const realizedOut = (query.data ?? [])
    .filter(
      (item) =>
        item.direction === "outflow" &&
        item.realized_date &&
        item.realized_date >= startDate &&
        item.realized_date <= endDate,
    )
    .reduce((sum, item) => sum + Number(item.realized_amount), 0);
  const chart = useMemo(() => {
    const months = new Map<string, { month: string; projected: number; realized: number }>();
    const cursor = new Date(`${startDate}T12:00:00`);
    const end = new Date(`${endDate}T12:00:00`);
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      months.set(key, {
        month: cursor.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
        projected: 0,
        realized: 0,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    activeRows.forEach((item) => {
      const point = months.get(item.planned_date.slice(0, 7));
      if (point)
        point.projected += Number(item.planned_amount) * (item.direction === "inflow" ? 1 : -1);
    });
    (query.data ?? []).forEach((item) => {
      if (!item.realized_date || item.realized_date < startDate || item.realized_date > endDate)
        return;
      const point = months.get(item.realized_date.slice(0, 7));
      if (point)
        point.realized += Number(item.realized_amount) * (item.direction === "inflow" ? 1 : -1);
    });
    return [...months.values()];
  }, [activeRows, endDate, query.data, startDate]);
  const visibleRows = periodRows.filter((item) => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return (
      (direction === "all" || item.direction === direction) &&
      (status === "all" || item.cash_status === status) &&
      (!term ||
        `${item.document_number} ${item.counterparty_name} ${item.description}`
          .toLocaleLowerCase("pt-BR")
          .includes(term))
    );
  });

  return (
    <Card id="cash-flow" className="overflow-hidden border-primary/20">
      <CardHeader className="gap-4 border-b bg-gradient-to-r from-primary/5 via-background to-emerald-500/5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <Landmark className="size-5" />
          </div>
          <div>
            <CardTitle className="text-base">Fluxo de caixa consolidado</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Previsão e realização de recebimentos e pagamentos.
            </p>
          </div>
        </div>
        <div className="grid w-full gap-2 sm:grid-cols-3 lg:w-auto">
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger className="sm:min-w-52" aria-label="Empresa operadora">
              <SelectValue placeholder="Empresa operadora" />
            </SelectTrigger>
            <SelectContent>
              {companies.data?.map((company) => (
                <SelectItem key={company.id} value={company.id}>
                  {company.legal_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label="Data inicial"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
          <Input
            aria-label="Data final"
            type="date"
            min={startDate}
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-4">
        {query.isLoading || companies.isLoading ? (
          <LoadingState label="Consolidando o fluxo de caixa..." />
        ) : query.isError || companies.isError ? (
          <ErrorState
            title="Fluxo de caixa indisponível"
            description="Não foi possível consolidar os lançamentos desta empresa."
            action={{ label: "Tentar novamente", onClick: () => void query.refetch() }}
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <FlowMetric
                icon={ArrowDownToLine}
                label="Entradas previstas"
                value={plannedIn}
                tone="emerald"
              />
              <FlowMetric
                icon={ArrowUpFromLine}
                label="Saídas previstas"
                value={plannedOut}
                tone="blue"
              />
              <FlowMetric
                icon={Scale}
                label="Saldo projetado"
                value={plannedIn - plannedOut}
                tone={plannedIn - plannedOut >= 0 ? "emerald" : "red"}
              />
              <FlowMetric
                icon={CalendarRange}
                label="Saldo realizado"
                value={realizedIn - realizedOut}
                tone={realizedIn - realizedOut >= 0 ? "neutral" : "red"}
              />
            </div>
            {chart.length ? (
              <div className="rounded-xl border bg-muted/10 p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Saldo mensal</p>
                    <p className="text-xs text-muted-foreground">
                      Projetado pelo vencimento e realizado pela data efetiva.
                    </p>
                  </div>
                  <div className="flex gap-4 text-xs">
                    <span className="flex items-center gap-1.5">
                      <i className="size-2.5 rounded-sm bg-primary" />
                      Projetado
                    </span>
                    <span className="flex items-center gap-1.5">
                      <i className="size-2.5 rounded-sm bg-emerald-500" />
                      Realizado
                    </span>
                  </div>
                </div>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chart} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="month" tickLine={false} axisLine={false} />
                      <YAxis
                        tickFormatter={(value) => compactMoney.format(value)}
                        width={72}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip formatter={(value) => money.format(Number(value))} />
                      <ReferenceLine y={0} stroke="currentColor" opacity={0.35} />
                      <Bar
                        dataKey="projected"
                        name="Projetado"
                        fill="hsl(var(--primary))"
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="realized"
                        name="Realizado"
                        fill="#10b981"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : null}
            <div className="flex flex-col gap-2 lg:flex-row">
              <Input
                className="lg:flex-1"
                placeholder="Buscar documento, cliente, fornecedor ou descrição"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Select
                value={direction}
                onValueChange={(value) => setDirection(value as typeof direction)}
              >
                <SelectTrigger className="lg:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Entradas e saídas</SelectItem>
                  <SelectItem value="inflow">Entradas</SelectItem>
                  <SelectItem value="outflow">Saídas</SelectItem>
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
                <SelectTrigger className="lg:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  <SelectItem value="pending">Pendentes</SelectItem>
                  <SelectItem value="overdue">Vencidos</SelectItem>
                  <SelectItem value="realized">Realizados</SelectItem>
                  <SelectItem value="cancelled">Cancelados</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!visibleRows.length ? (
              <EmptyState
                title="Nenhum movimento no período"
                description="Ajuste o período ou os filtros para consultar outros lançamentos."
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Movimento</TableHead>
                      <TableHead>Documento</TableHead>
                      <TableHead>Cliente/fornecedor</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Previsto</TableHead>
                      <TableHead className="text-right">Realizado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRows.map((item) => (
                      <TableRow key={`${item.direction}-${item.source_id}`}>
                        <TableCell className="whitespace-nowrap">
                          {dateFormat.format(new Date(`${item.planned_date}T00:00:00Z`))}
                        </TableCell>
                        <TableCell>
                          <span
                            className={
                              item.direction === "inflow"
                                ? "font-medium text-emerald-700 dark:text-emerald-300"
                                : "font-medium text-blue-700 dark:text-blue-300"
                            }
                          >
                            {item.direction === "inflow" ? "Entrada" : "Saída"}
                          </span>
                          <p className="text-xs text-muted-foreground">
                            {sourceLabels[item.source_type]}
                          </p>
                        </TableCell>
                        <TableCell>
                          <p className="font-medium">{item.document_number}</p>
                          <p className="max-w-52 truncate text-xs text-muted-foreground">
                            {item.description}
                          </p>
                        </TableCell>
                        <TableCell>{item.counterparty_name}</TableCell>
                        <TableCell>
                          <CashStatusBadge status={item.cash_status} />
                          {item.reconciliation_status === "difference" ? (
                            <p className="mt-1 text-xs font-medium text-destructive">
                              Diferença {money.format(Number(item.difference_amount))}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {money.format(Number(item.planned_amount))}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {item.realized_amount ? money.format(Number(item.realized_amount)) : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function FlowMetric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Scale;
  label: string;
  value: number;
  tone: "emerald" | "blue" | "red" | "neutral";
}) {
  const tones = {
    emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    blue: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    red: "bg-red-500/10 text-red-700 dark:text-red-300",
    neutral: "bg-muted text-foreground",
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-background p-3">
      <div className={`rounded-lg p-2 ${tones[tone]}`}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-lg font-semibold tabular-nums">{money.format(value)}</p>
      </div>
    </div>
  );
}

function CashStatusBadge({ status }: { status: CashEntry["cash_status"] }) {
  const classes = {
    pending: "border-amber-500/40 bg-amber-500/10 text-amber-700",
    overdue: "border-red-500/40 bg-red-500/10 text-red-700",
    realized: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
    cancelled: "border-muted-foreground/30 bg-muted text-muted-foreground",
  };
  return (
    <Badge variant="outline" className={classes[status]}>
      {statusLabels[status]}
    </Badge>
  );
}
