import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ChartNoAxesCombined, Search, ShieldAlert, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
type Profitability = {
  operating_company_id: string;
  operating_company_name: string;
  contract_id: string;
  customer_name: string;
  contract_number: string;
  period_month: string;
  gross_revenue: number;
  realized_revenue: number;
  allocated_cost: number;
  gross_profit: number;
  gross_margin_percent: number | null;
};
type Projection = {
  operating_company_id: string;
  operating_company_name: string;
  contract_id: string;
  customer_name: string;
  contract_number: string;
  period_month: string;
  baseline_mrr: number | null;
  missing_value_version: boolean;
};

const db = supabase as unknown as SupabaseClient;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const compactMoney = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
});
const monthFormat = new Intl.DateTimeFormat("pt-BR", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});

function firstMonthOfYear() {
  return `${new Date().getFullYear()}-01-01`;
}

export function FinancialContractAnalytics() {
  const [companyId, setCompanyId] = useState("");
  const [startMonth, setStartMonth] = useState(firstMonthOfYear());
  const [search, setSearch] = useState("");
  const [delinquency, setDelinquency] = useState(5);
  const [churn, setChurn] = useState(2);
  const companies = useQuery({
    queryKey: ["contract-analytics-companies"],
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
    if (!companyId && companies.data?.length) setCompanyId("all");
  }, [companies.data, companyId]);

  const profitability = useQuery({
    queryKey: ["contract-profitability", companyId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      let request = db
        .from("contract_profitability")
        .select("*")
        .order("period_month", { ascending: false })
        .limit(5000);
      if (companyId !== "all") request = request.eq("operating_company_id", companyId);
      const { data, error } = await request;
      if (error) throw error;
      return (data ?? []) as Profitability[];
    },
  });
  const projection = useQuery({
    queryKey: ["contract-mrr-projection", companyId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      let request = db
        .from("contract_mrr_projection")
        .select("*")
        .order("period_month")
        .limit(10000);
      if (companyId !== "all") request = request.eq("operating_company_id", companyId);
      const { data, error } = await request;
      if (error) throw error;
      return (data ?? []) as Projection[];
    },
  });

  const term = search.trim().toLocaleLowerCase("pt-BR");
  const rows = (profitability.data ?? []).filter(
    (item) =>
      item.period_month >= startMonth &&
      (!term ||
        `${item.customer_name} ${item.contract_number}`.toLocaleLowerCase("pt-BR").includes(term)),
  );
  const grouped = useMemo(() => {
    const map = new Map<string, Profitability>();
    for (const item of rows) {
      const current = map.get(item.contract_id);
      if (!current) map.set(item.contract_id, { ...item });
      else {
        current.gross_revenue += Number(item.gross_revenue);
        current.realized_revenue += Number(item.realized_revenue);
        current.allocated_cost += Number(item.allocated_cost);
        current.gross_profit += Number(item.gross_profit);
        current.gross_margin_percent = current.gross_revenue
          ? (current.gross_profit / current.gross_revenue) * 100
          : null;
      }
    }
    return [...map.values()].sort((a, b) => b.gross_profit - a.gross_profit);
  }, [rows]);
  const revenue = grouped.reduce((sum, item) => sum + Number(item.gross_revenue), 0);
  const costs = grouped.reduce((sum, item) => sum + Number(item.allocated_cost), 0);
  const projectionChart = useMemo(() => {
    const map = new Map<string, { month: string; baseline: number; stressed: number }>();
    for (const item of projection.data ?? []) {
      const row = map.get(item.period_month) ?? {
        month: item.period_month,
        baseline: 0,
        stressed: 0,
      };
      const baseline = Number(item.baseline_mrr ?? 0);
      row.baseline += baseline;
      row.stressed += baseline * (1 - delinquency / 100) * (1 - churn / 100);
      map.set(item.period_month, row);
    }
    return [...map.values()].map((item) => ({
      ...item,
      label: monthFormat.format(new Date(`${item.month}T00:00:00Z`)),
    }));
  }, [churn, delinquency, projection.data]);
  const missingValues = new Set(
    (projection.data ?? [])
      .filter((item) => item.missing_value_version)
      .map((item) => item.contract_id),
  ).size;

  return (
    <Card id="contract-analytics" className="overflow-hidden border-primary/20">
      <CardHeader className="gap-4 border-b bg-gradient-to-r from-primary/5 via-background to-emerald-500/5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ChartNoAxesCombined className="size-5" /> Rentabilidade e MRR
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Margem por contrato e projeção consolidada dos próximos doze meses.
          </p>
        </div>
        <Select value={companyId} onValueChange={setCompanyId}>
          <SelectTrigger className="w-full lg:w-72">
            <SelectValue placeholder="Empresa operadora" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as empresas permitidas</SelectItem>
            {companies.data?.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.legal_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="space-y-6 p-4">
        {profitability.isLoading || projection.isLoading ? (
          <LoadingState label="Calculando rentabilidade e projeções..." />
        ) : profitability.isError || projection.isError ? (
          <ErrorState
            title="Análises indisponíveis"
            description="Não foi possível calcular os indicadores contratuais."
            action={{
              label: "Atualizar",
              onClick: () => {
                void profitability.refetch();
                void projection.refetch();
              },
            }}
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Receita no período" value={money.format(revenue)} />
              <Metric label="Custos alocados" value={money.format(costs)} />
              <Metric label="Lucro bruto" value={money.format(revenue - costs)} />
              <Metric
                label="Margem bruta"
                value={revenue ? `${(((revenue - costs) / revenue) * 100).toFixed(2)}%` : "0,00%"}
              />
            </div>
            <section className="space-y-3">
              <div className="flex flex-col gap-3 md:flex-row">
                <div className="space-y-1">
                  <Label>Desde a competência</Label>
                  <Input
                    type="month"
                    value={startMonth.slice(0, 7)}
                    onChange={(event) => setStartMonth(`${event.target.value}-01`)}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label>Cliente ou contrato</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Pesquisar rentabilidade"
                    />
                  </div>
                </div>
              </div>
              {!grouped.length ? (
                <EmptyState
                  title="Sem dados de rentabilidade"
                  description="Gere recebíveis e rateie os custos para visualizar a margem."
                />
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cliente e contrato</TableHead>
                        <TableHead>Empresa operadora</TableHead>
                        <TableHead className="text-right">Receita</TableHead>
                        <TableHead className="text-right">Custo</TableHead>
                        <TableHead className="text-right">Lucro bruto</TableHead>
                        <TableHead className="text-right">Margem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {grouped.map((item) => (
                        <TableRow key={item.contract_id}>
                          <TableCell>
                            <p className="font-medium">{item.customer_name}</p>
                            <p className="text-xs text-muted-foreground">{item.contract_number}</p>
                          </TableCell>
                          <TableCell>{item.operating_company_name}</TableCell>
                          <TableCell className="text-right">
                            {money.format(item.gross_revenue)}
                          </TableCell>
                          <TableCell className="text-right">
                            {money.format(item.allocated_cost)}
                          </TableCell>
                          <TableCell
                            className={`text-right font-semibold ${item.gross_profit < 0 ? "text-red-600" : "text-emerald-600"}`}
                          >
                            {money.format(item.gross_profit)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant={
                                Number(item.gross_margin_percent) < 0 ? "destructive" : "secondary"
                              }
                            >
                              {item.gross_margin_percent === null
                                ? "N/D"
                                : `${Number(item.gross_margin_percent).toFixed(2)}%`}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
            <section className="space-y-3 border-t pt-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                <div className="mr-auto">
                  <h3 className="flex items-center gap-2 font-semibold">
                    <TrendingUp className="size-4" /> Projeção de MRR
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Cenário simulado, sem alterar os contratos.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label>Inadimplência (%)</Label>
                  <Input
                    className="w-40"
                    type="number"
                    min="0"
                    max="100"
                    value={delinquency}
                    onChange={(event) =>
                      setDelinquency(Math.min(100, Math.max(0, Number(event.target.value))))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Cancelamento (%)</Label>
                  <Input
                    className="w-40"
                    type="number"
                    min="0"
                    max="100"
                    value={churn}
                    onChange={(event) =>
                      setChurn(Math.min(100, Math.max(0, Number(event.target.value))))
                    }
                  />
                </div>
              </div>
              {missingValues > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800">
                  <ShieldAlert className="size-4" /> {missingValues} contrato(s) sem versão de valor
                  válida não entram no total.
                </div>
              )}
              {!projectionChart.length ? (
                <EmptyState
                  title="Sem contratos para projetar"
                  description="Habilite o faturamento e cadastre a versão de valor dos contratos ativos."
                />
              ) : (
                <div className="h-72 rounded-lg border p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={projectionChart}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="label" />
                      <YAxis
                        tickFormatter={(value) => compactMoney.format(Number(value))}
                        width={72}
                      />
                      <Tooltip formatter={(value) => money.format(Number(value))} />
                      <Bar
                        dataKey="baseline"
                        name="MRR base"
                        fill="hsl(var(--primary))"
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="stressed"
                        name="Cenário de estresse"
                        fill="#f59e0b"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
