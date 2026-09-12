import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AlertTriangle, ChartNoAxesCombined, CircleDollarSign, Percent, Scale } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
type StatementEntry = {
  tenant_id: string;
  operating_company_id: string;
  fiscal_year: number;
  fiscal_month: number;
  period_month: string;
  result_group: "revenue" | "expense";
  direction: "inflow" | "outflow";
  financial_category_id: string | null;
  financial_category_code: string | null;
  financial_category_name: string | null;
  cost_center_id: string | null;
  cost_center_code: string | null;
  cost_center_name: string | null;
  budgeted_result_amount: number;
  planned_result_amount: number;
  realized_result_amount: number;
};
type DetailRow = {
  key: string;
  direction: StatementEntry["direction"];
  code: string;
  name: string;
  months: number[];
  accumulated: number;
  budget: number;
};

const db = supabase as unknown as SupabaseClient;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const compactMoney = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});
const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export function FinancialManagementStatement() {
  const currentYear = new Date().getFullYear();
  const [companyId, setCompanyId] = useState("");
  const [year, setYear] = useState(currentYear);
  const [costCenterId, setCostCenterId] = useState("all");
  const [groupBy, setGroupBy] = useState<"category" | "cost_center">("category");
  const companies = useQuery({
    queryKey: ["financial-statement-companies"],
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
    queryKey: ["financial-statement", companyId, year],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const { data, error } = await db
        .from("financial_management_statement")
        .select("*")
        .eq("operating_company_id", companyId)
        .eq("fiscal_year", year)
        .order("period_month")
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as StatementEntry[];
    },
  });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const centerOptions = useMemo(
    () =>
      Array.from(
        new Map(
          rows
            .filter((item) => item.cost_center_id)
            .map((item) => [
              item.cost_center_id!,
              `${item.cost_center_code} · ${item.cost_center_name}`,
            ]),
        ),
      ),
    [rows],
  );
  const filteredRows = useMemo(
    () =>
      costCenterId === "all"
        ? rows
        : rows.filter((item) =>
            costCenterId === "unclassified"
              ? !item.cost_center_id
              : item.cost_center_id === costCenterId,
          ),
    [costCenterId, rows],
  );
  const detailRows = useMemo(() => buildDetailRows(filteredRows, groupBy), [filteredRows, groupBy]);
  const revenue = sumDirection(filteredRows, "realized_result_amount", "inflow");
  const expense = -sumDirection(filteredRows, "realized_result_amount", "outflow");
  const result = revenue - expense;
  const budgetResult = sumField(filteredRows, "budgeted_result_amount");
  const margin = revenue ? (result / revenue) * 100 : 0;
  const unclassifiedCount = rows.filter(
    (item) =>
      (!item.financial_category_id || !item.cost_center_id) &&
      (Number(item.realized_result_amount) !== 0 || Number(item.planned_result_amount) !== 0),
  ).length;
  const chart = useMemo(
    () =>
      months.map((month, index) => {
        const monthRows = filteredRows.filter((item) => item.fiscal_month === index + 1);
        const monthRevenue = sumDirection(monthRows, "realized_result_amount", "inflow");
        const monthExpense = sumDirection(monthRows, "realized_result_amount", "outflow");
        return {
          month,
          revenue: monthRevenue,
          expense: monthExpense,
          result: monthRevenue + monthExpense,
        };
      }),
    [filteredRows],
  );

  return (
    <Card id="financial-statement" className="overflow-hidden border-primary/20">
      <CardHeader className="gap-4 border-b bg-gradient-to-r from-sky-500/5 via-background to-emerald-500/5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-sky-500/10 p-2.5 text-sky-700 dark:text-sky-300">
            <ChartNoAxesCombined className="size-5" />
          </div>
          <div>
            <CardTitle className="text-base">Demonstrativo gerencial de resultado</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Receitas, despesas e resultado operacional mensal e acumulado.
            </p>
          </div>
        </div>
        <div className="grid w-full gap-2 sm:grid-cols-2 xl:w-auto xl:grid-cols-4">
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger className="sm:min-w-52" aria-label="Empresa do demonstrativo">
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
          <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
            <SelectTrigger aria-label="Exercício do demonstrativo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[currentYear - 1, currentYear, currentYear + 1, currentYear + 2].map((item) => (
                <SelectItem key={item} value={String(item)}>
                  Exercício {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={costCenterId} onValueChange={setCostCenterId}>
            <SelectTrigger aria-label="Centro de custo do demonstrativo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os centros</SelectItem>
              <SelectItem value="unclassified">Não classificados</SelectItem>
              {centerOptions.map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={groupBy} onValueChange={(value) => setGroupBy(value as typeof groupBy)}>
            <SelectTrigger aria-label="Agrupamento do demonstrativo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="category">Agrupar por categoria</SelectItem>
              <SelectItem value="cost_center">Agrupar por centro</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-4">
        {query.isLoading || companies.isLoading ? (
          <LoadingState label="Preparando o demonstrativo gerencial..." />
        ) : query.isError || companies.isError ? (
          <ErrorState
            title="Demonstrativo indisponível"
            description="Não foi possível consolidar o resultado desta empresa."
            action={{ label: "Tentar novamente", onClick: () => void query.refetch() }}
          />
        ) : !rows.length ? (
          <EmptyState
            title="Nenhum dado para o demonstrativo"
            description="Classifique os movimentos financeiros ou inclua o orçamento deste exercício."
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <ResultMetric
                icon={CircleDollarSign}
                label="Receita realizada"
                value={revenue}
                tone="emerald"
              />
              <ResultMetric
                icon={CircleDollarSign}
                label="Despesa realizada"
                value={expense}
                tone="red"
              />
              <ResultMetric
                icon={Scale}
                label="Resultado operacional"
                value={result}
                note={`Orçado ${money.format(budgetResult)}`}
                tone={result >= 0 ? "blue" : "red"}
              />
              <ResultMetric
                icon={Percent}
                label="Margem operacional"
                value={margin}
                percent
                note={`Desvio ${money.format(result - budgetResult)}`}
                tone={margin >= 0 ? "violet" : "red"}
              />
            </div>
            {unclassifiedCount ? (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                <AlertTriangle className="size-4 shrink-0" />
                <span>
                  {unclassifiedCount} linha(s) com movimento ainda sem classificação completa.
                </span>
                <Badge variant="outline" className="ml-auto border-amber-500/40">
                  Revisar fluxo
                </Badge>
              </div>
            ) : null}
            <div className="rounded-xl border bg-muted/10 p-3">
              <div className="mb-3">
                <p className="text-sm font-medium">Composição mensal do resultado</p>
                <p className="text-xs text-muted-foreground">
                  Receitas positivas, despesas negativas e resultado operacional.
                </p>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chart} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="month" tickLine={false} axisLine={false} />
                    <YAxis
                      width={72}
                      tickFormatter={(value) => compactMoney.format(Number(value))}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip formatter={(value) => money.format(Number(value))} />
                    <ReferenceLine y={0} stroke="currentColor" opacity={0.35} />
                    <Bar dataKey="revenue" name="Receitas" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expense" name="Despesas" fill="#ef4444" radius={[0, 0, 4, 4]} />
                    <Line
                      type="monotone"
                      dataKey="result"
                      name="Resultado"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2.5}
                      dot={{ r: 3 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
            <StatementTable rows={filteredRows} details={detailRows} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatementTable({ rows, details }: { rows: StatementEntry[]; details: DetailRow[] }) {
  const revenueRows = details.filter((item) => item.direction === "inflow");
  const expenseRows = details.filter((item) => item.direction === "outflow");
  const revenueMonths = monthlyTotals(rows, "inflow");
  const expenseMonths = monthlyTotals(rows, "outflow");
  const resultMonths = revenueMonths.map((value, index) => value + expenseMonths[index]);
  const revenueBudget = sumDirection(rows, "budgeted_result_amount", "inflow");
  const expenseBudget = sumDirection(rows, "budgeted_result_amount", "outflow");
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table className="min-w-[1280px]">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 min-w-64 bg-background">
              Linha gerencial
            </TableHead>
            {months.map((month) => (
              <TableHead key={month} className="text-right">
                {month}
              </TableHead>
            ))}
            <TableHead className="text-right">Acumulado</TableHead>
            <TableHead className="text-right">Orçado</TableHead>
            <TableHead className="text-right">Desvio</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <StatementRow
            label="Receita operacional"
            months={revenueMonths}
            accumulated={sumValues(revenueMonths)}
            budget={revenueBudget}
            kind="revenue"
          />
          {revenueRows.map((row) => (
            <DetailStatementRow key={row.key} row={row} />
          ))}
          <StatementRow
            label="Despesas operacionais"
            months={expenseMonths}
            accumulated={sumValues(expenseMonths)}
            budget={expenseBudget}
            kind="expense"
          />
          {expenseRows.map((row) => (
            <DetailStatementRow key={row.key} row={row} />
          ))}
          <StatementRow
            label="Resultado operacional"
            months={resultMonths}
            accumulated={sumValues(resultMonths)}
            budget={revenueBudget + expenseBudget}
            kind="result"
          />
        </TableBody>
      </Table>
    </div>
  );
}

function StatementRow({
  label,
  months: values,
  accumulated,
  budget,
  kind,
}: {
  label: string;
  months: number[];
  accumulated: number;
  budget: number;
  kind: "revenue" | "expense" | "result";
}) {
  const styles =
    kind === "result"
      ? "bg-primary/10 font-bold"
      : kind === "revenue"
        ? "bg-emerald-500/8 font-semibold"
        : "bg-red-500/8 font-semibold";
  const deviation = accumulated - budget;
  return (
    <TableRow className={styles}>
      <TableCell className={`sticky left-0 z-10 ${styles}`}>{label}</TableCell>
      {values.map((value, index) => (
        <TableCell key={index} className="text-right tabular-nums">
          {money.format(value)}
        </TableCell>
      ))}
      <TableCell className="text-right tabular-nums">{money.format(accumulated)}</TableCell>
      <TableCell className="text-right tabular-nums">{money.format(budget)}</TableCell>
      <TableCell
        className={`text-right tabular-nums ${deviation >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}
      >
        {money.format(deviation)}
      </TableCell>
    </TableRow>
  );
}

function DetailStatementRow({ row }: { row: DetailRow }) {
  const deviation = row.accumulated - row.budget;
  return (
    <TableRow>
      <TableCell className="sticky left-0 z-10 bg-background pl-8">
        <span className="text-xs font-medium text-muted-foreground">{row.code}</span>
        <p>{row.name}</p>
      </TableCell>
      {row.months.map((value, index) => (
        <TableCell key={index} className="text-right text-xs tabular-nums">
          {money.format(value)}
        </TableCell>
      ))}
      <TableCell className="text-right font-medium tabular-nums">
        {money.format(row.accumulated)}
      </TableCell>
      <TableCell className="text-right tabular-nums">{money.format(row.budget)}</TableCell>
      <TableCell
        className={`text-right font-medium tabular-nums ${deviation >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}
      >
        {money.format(deviation)}
      </TableCell>
    </TableRow>
  );
}

function buildDetailRows(rows: StatementEntry[], groupBy: "category" | "cost_center") {
  const grouped = new Map<string, DetailRow>();
  rows.forEach((item) => {
    const id = groupBy === "category" ? item.financial_category_id : item.cost_center_id;
    const code = groupBy === "category" ? item.financial_category_code : item.cost_center_code;
    const name = groupBy === "category" ? item.financial_category_name : item.cost_center_name;
    const key = `${item.direction}-${id ?? "unclassified"}`;
    const current = grouped.get(key) ?? {
      key,
      direction: item.direction,
      code: code ?? "SEM CLASS.",
      name: name ?? "Não classificado",
      months: Array(12).fill(0) as number[],
      accumulated: 0,
      budget: 0,
    };
    current.months[item.fiscal_month - 1] += Number(item.realized_result_amount);
    current.accumulated += Number(item.realized_result_amount);
    current.budget += Number(item.budgeted_result_amount);
    grouped.set(key, current);
  });
  return [...grouped.values()].sort(
    (a, b) => a.direction.localeCompare(b.direction) || a.code.localeCompare(b.code),
  );
}

function monthlyTotals(rows: StatementEntry[], direction: StatementEntry["direction"]) {
  return Array.from({ length: 12 }, (_, index) =>
    rows
      .filter((item) => item.direction === direction && item.fiscal_month === index + 1)
      .reduce((total, item) => total + Number(item.realized_result_amount), 0),
  );
}
function sumDirection(
  rows: StatementEntry[],
  field: "budgeted_result_amount" | "realized_result_amount",
  direction: StatementEntry["direction"],
) {
  return rows
    .filter((item) => item.direction === direction)
    .reduce((total, item) => total + Number(item[field]), 0);
}
function sumField(rows: StatementEntry[], field: "budgeted_result_amount") {
  return rows.reduce((total, item) => total + Number(item[field]), 0);
}
function sumValues(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function ResultMetric({
  icon: Icon,
  label,
  value,
  note,
  tone,
  percent,
}: {
  icon: typeof Scale;
  label: string;
  value: number;
  note?: string;
  tone: "emerald" | "red" | "blue" | "violet";
  percent?: boolean;
}) {
  const tones = {
    emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    red: "bg-red-500/10 text-red-700 dark:text-red-300",
    blue: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-background p-3">
      <div className={`rounded-lg p-2 ${tones[tone]}`}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-lg font-semibold tabular-nums">
          {percent
            ? `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
            : money.format(value)}
        </p>
        {note ? <p className="truncate text-xs text-muted-foreground">{note}</p> : null}
      </div>
    </div>
  );
}
