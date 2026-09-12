import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowDownToLine, ArrowUpFromLine, Pencil, Plus, Scale, Target } from "lucide-react";
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
import { Button } from "@/components/ui/button";
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
import {
  FinancialBudgetDialog,
  type FinancialBudgetEntry,
} from "@/components/financial-budget-dialog";

type Company = { id: string; legal_name: string };
type BudgetRow = FinancialBudgetEntry & {
  tenant_id: string;
  operating_company_id: string;
  planned_amount: number;
  realized_amount: number;
  variance_amount: number;
  variance_percent: number | null;
  revision: number | null;
  created_by_name: string | null;
  created_at: string | null;
};

const db = supabase as unknown as SupabaseClient;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const compactMoney = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});
const monthFormat = new Intl.DateTimeFormat("pt-BR", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function FinancialBudgetDashboard({ canEdit }: { canEdit: boolean }) {
  const currentYear = new Date().getFullYear();
  const [companyId, setCompanyId] = useState("");
  const [year, setYear] = useState(currentYear);
  const [direction, setDirection] = useState<"all" | BudgetRow["direction"]>("all");
  const [month, setMonth] = useState("all");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<FinancialBudgetEntry | null>();
  const companies = useQuery({
    queryKey: ["financial-budget-companies"],
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
    queryKey: ["financial-budget", companyId, year],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const { data, error } = await db
        .from("financial_budget_variance")
        .select("*")
        .eq("operating_company_id", companyId)
        .gte("period_month", `${year}-01-01`)
        .lte("period_month", `${year}-12-01`)
        .order("period_month")
        .order("direction")
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as BudgetRow[];
    },
  });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const budgetIn = sum(rows, "budgeted_amount", "inflow");
  const budgetOut = sum(rows, "budgeted_amount", "outflow");
  const realizedIn = sum(rows, "realized_amount", "inflow");
  const realizedOut = sum(rows, "realized_amount", "outflow");
  const chart = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => {
        const key = `${year}-${String(index + 1).padStart(2, "0")}`;
        const periodRows = rows.filter((item) => item.period_month.startsWith(key));
        return {
          month: new Date(`${key}-01T00:00:00Z`).toLocaleDateString("pt-BR", {
            month: "short",
          }),
          budget:
            sum(periodRows, "budgeted_amount", "inflow") -
            sum(periodRows, "budgeted_amount", "outflow"),
          realized:
            sum(periodRows, "realized_amount", "inflow") -
            sum(periodRows, "realized_amount", "outflow"),
        };
      }),
    [rows, year],
  );
  const visibleRows = sortedBudgetRows(rows).filter((item) => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return (
      (direction === "all" || item.direction === direction) &&
      (month === "all" || item.period_month.startsWith(month)) &&
      (!term ||
        `${item.financial_category_code ?? ""} ${item.financial_category_name ?? ""} ${item.cost_center_code ?? ""} ${item.cost_center_name ?? ""}`
          .toLocaleLowerCase("pt-BR")
          .includes(term))
    );
  });

  return (
    <Card id="financial-budget" className="overflow-hidden border-primary/20">
      <CardHeader className="gap-4 border-b bg-gradient-to-r from-violet-500/5 via-background to-primary/5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-violet-500/10 p-2.5 text-violet-700 dark:text-violet-300">
            <Target className="size-5" />
          </div>
          <div>
            <CardTitle className="text-base">Orçamento e desempenho</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Compare o planejamento anual com o previsto e o realizado.
            </p>
          </div>
        </div>
        <div className="grid w-full gap-2 sm:grid-cols-3 lg:w-auto">
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger className="sm:min-w-52" aria-label="Empresa do orçamento">
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
            <SelectTrigger aria-label="Exercício do orçamento">
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
          {canEdit ? (
            <Button className="gap-2" onClick={() => setEditor(null)}>
              <Plus className="size-4" />
              Novo orçamento
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-4">
        {query.isLoading || companies.isLoading ? (
          <LoadingState label="Consolidando orçamento e realização..." />
        ) : query.isError || companies.isError ? (
          <ErrorState
            title="Orçamento indisponível"
            description="Não foi possível consultar o orçamento desta empresa."
            action={{ label: "Tentar novamente", onClick: () => void query.refetch() }}
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <BudgetMetric
                icon={ArrowDownToLine}
                label="Entradas orçadas"
                primary={budgetIn}
                secondary={`Realizado ${money.format(realizedIn)}`}
                tone="emerald"
              />
              <BudgetMetric
                icon={ArrowUpFromLine}
                label="Saídas orçadas"
                primary={budgetOut}
                secondary={`Realizado ${money.format(realizedOut)}`}
                tone="blue"
              />
              <BudgetMetric
                icon={Target}
                label="Resultado orçado"
                primary={budgetIn - budgetOut}
                secondary="Entradas menos saídas"
                tone={budgetIn - budgetOut >= 0 ? "violet" : "red"}
              />
              <BudgetMetric
                icon={Scale}
                label="Resultado realizado"
                primary={realizedIn - realizedOut}
                secondary={`Desvio ${money.format(realizedIn - realizedOut - (budgetIn - budgetOut))}`}
                tone={realizedIn - realizedOut >= 0 ? "neutral" : "red"}
              />
            </div>
            <div className="rounded-xl border bg-muted/10 p-3">
              <div className="mb-3">
                <p className="text-sm font-medium">Resultado mensal</p>
                <p className="text-xs text-muted-foreground">
                  Saldo orçado e realizado por competência no exercício.
                </p>
              </div>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
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
                    <Bar dataKey="budget" name="Orçado" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                    <Bar
                      dataKey="realized"
                      name="Realizado"
                      fill="hsl(var(--primary))"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(16rem,1fr)_12rem_12rem]">
              <Input
                placeholder="Buscar categoria ou centro de custo"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Select
                value={direction}
                onValueChange={(value) => setDirection(value as typeof direction)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Entradas e saídas</SelectItem>
                  <SelectItem value="inflow">Entradas</SelectItem>
                  <SelectItem value="outflow">Saídas</SelectItem>
                </SelectContent>
              </Select>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os meses</SelectItem>
                  {Array.from({ length: 12 }, (_, index) => {
                    const value = `${year}-${String(index + 1).padStart(2, "0")}`;
                    return (
                      <SelectItem key={value} value={value}>
                        {monthFormat.format(new Date(`${value}-01T00:00:00Z`))}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            {!visibleRows.length ? (
              <EmptyState
                title="Nenhum orçamento ou movimento no exercício"
                description={
                  canEdit
                    ? "Inclua o primeiro item ou ajuste os filtros da consulta."
                    : "Ajuste os filtros ou selecione outro exercício."
                }
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Competência</TableHead>
                      <TableHead>Natureza</TableHead>
                      <TableHead>Categoria</TableHead>
                      <TableHead>Centro de custo</TableHead>
                      <TableHead className="text-right">Orçado</TableHead>
                      <TableHead className="text-right">Previsto</TableHead>
                      <TableHead className="text-right">Realizado</TableHead>
                      <TableHead className="text-right">Desvio</TableHead>
                      {canEdit ? (
                        <TableHead className="w-12">
                          <span className="sr-only">Ações</span>
                        </TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRows.map((item, index) => (
                      <TableRow
                        key={`${item.period_month}-${item.direction}-${item.financial_category_id}-${item.cost_center_id}-${index}`}
                      >
                        <TableCell className="whitespace-nowrap font-medium">
                          {monthFormat.format(new Date(`${item.period_month}T00:00:00Z`))}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {item.direction === "inflow" ? "Entrada" : "Saída"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {item.financial_category_id ? (
                            <>
                              <span className="font-medium">{item.financial_category_code}</span>
                              <p className="text-xs text-muted-foreground">
                                {item.financial_category_name}
                              </p>
                            </>
                          ) : (
                            <Badge variant="outline">Não classificado</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.cost_center_id ? (
                            <>
                              <span className="font-medium">{item.cost_center_code}</span>
                              <p className="text-xs text-muted-foreground">
                                {item.cost_center_name}
                              </p>
                            </>
                          ) : (
                            <Badge variant="outline">Não classificado</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {item.budget_entry_id ? (
                            money.format(Number(item.budgeted_amount))
                          ) : (
                            <span className="text-xs text-muted-foreground">Sem orçamento</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {money.format(Number(item.planned_amount))}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {money.format(Number(item.realized_amount))}
                        </TableCell>
                        <TableCell className={`text-right font-semibold ${varianceTone(item)}`}>
                          {money.format(Number(item.variance_amount))}
                          {item.variance_percent === null ? null : (
                            <p className="text-xs">
                              {Number(item.variance_percent).toLocaleString("pt-BR", {
                                maximumFractionDigits: 2,
                              })}
                              %
                            </p>
                          )}
                        </TableCell>
                        {canEdit ? (
                          <TableCell>
                            {item.budget_entry_id ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={`Revisar orçamento de ${item.financial_category_name}`}
                                onClick={() => setEditor(item)}
                              >
                                <Pencil className="size-4" />
                              </Button>
                            ) : null}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
      {editor !== undefined ? (
        <FinancialBudgetDialog
          companyId={companyId}
          year={year}
          entry={editor ?? undefined}
          onClose={() => setEditor(undefined)}
        />
      ) : null}
    </Card>
  );
}

function sum(
  rows: BudgetRow[],
  field: "budgeted_amount" | "realized_amount",
  direction: BudgetRow["direction"],
) {
  return rows
    .filter((item) => item.direction === direction)
    .reduce((total, item) => total + Number(item[field]), 0);
}

function sortedBudgetRows(rows: BudgetRow[]) {
  return [...rows].sort(
    (a, b) =>
      a.period_month.localeCompare(b.period_month) ||
      a.direction.localeCompare(b.direction) ||
      (a.financial_category_code ?? "ZZZ").localeCompare(b.financial_category_code ?? "ZZZ"),
  );
}

function varianceTone(item: BudgetRow) {
  const variance = Number(item.variance_amount);
  if (!variance) return "text-muted-foreground";
  const favorable = item.direction === "inflow" ? variance > 0 : variance < 0;
  return favorable ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300";
}

function BudgetMetric({
  icon: Icon,
  label,
  primary,
  secondary,
  tone,
}: {
  icon: typeof Target;
  label: string;
  primary: number;
  secondary: string;
  tone: "emerald" | "blue" | "violet" | "red" | "neutral";
}) {
  const tones = {
    emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    blue: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
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
        <p className="truncate text-lg font-semibold tabular-nums">{money.format(primary)}</p>
        <p className="truncate text-xs text-muted-foreground">{secondary}</p>
      </div>
    </div>
  );
}
