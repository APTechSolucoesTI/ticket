import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CalendarCheck2,
  CalendarClock,
  CheckCircle2,
  History,
  Loader2,
  LockKeyhole,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { ErrorState, LoadingState } from "@/components/data-state";
import { supabase } from "@/integrations/supabase/client";
import { getUserFacingError } from "@/lib/user-facing-error";

type Company = { id: string; legal_name: string };
type PeriodClosure = {
  id: string;
  period_month: string;
  revision: number;
  status: "closed" | "reopened";
  revenue_realized: number;
  expense_realized: number;
  result_realized: number;
  result_budgeted: number;
  snapshot_line_count: number;
  close_notes: string | null;
  closed_by_name: string;
  closed_at: string;
  reopened_by_name: string | null;
  reopen_reason: string | null;
  reopened_at: string | null;
};
type PeriodRow = {
  month: number;
  period: string;
  label: string;
  active?: PeriodClosure;
  latest?: PeriodClosure;
  future: boolean;
};
type Confirmation = { action: "close" | "reopen"; row: PeriodRow };

const db = supabase as unknown as SupabaseClient;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const monthFormat = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

export function FinancialPeriodClosure({ canEdit }: { canEdit: boolean }) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentPeriod = `${currentYear}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [year, setYear] = useState(currentYear);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [notes, setNotes] = useState("");
  const companies = useQuery({
    queryKey: ["financial-closure-companies"],
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
  const closures = useQuery({
    queryKey: ["financial-period-closures", companyId, year],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const { data, error } = await db
        .from("financial_period_closures")
        .select(
          "id,period_month,revision,status,revenue_realized,expense_realized,result_realized,result_budgeted,snapshot_line_count,close_notes,closed_by_name,closed_at,reopened_by_name,reopen_reason,reopened_at",
        )
        .eq("operating_company_id", companyId)
        .gte("period_month", `${year}-01-01`)
        .lte("period_month", `${year}-12-01`)
        .order("period_month")
        .order("revision", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PeriodClosure[];
    },
  });
  const rows = useMemo<PeriodRow[]>(() => {
    const history = closures.data ?? [];
    return Array.from({ length: 12 }, (_, index) => {
      const period = `${year}-${String(index + 1).padStart(2, "0")}-01`;
      const periodHistory = history.filter((item) => item.period_month === period);
      return {
        month: index + 1,
        period,
        label: monthFormat.format(new Date(`${period}T00:00:00Z`)),
        active: periodHistory.find((item) => item.status === "closed"),
        latest: periodHistory[0],
        future: period > currentPeriod,
      };
    });
  }, [closures.data, currentPeriod, year]);
  const activeClosures = rows.flatMap((row) => (row.active ? [row.active] : []));
  const closedResult = activeClosures.reduce(
    (total, closure) => total + Number(closure.result_realized),
    0,
  );
  const reopenedCount = (closures.data ?? []).filter((item) => item.status === "reopened").length;
  const mutation = useMutation({
    mutationFn: async ({ action, row, reason }: Confirmation & { reason: string }) => {
      if (action === "close") {
        const { error } = await db.rpc("close_financial_period", {
          p_operating_company_id: companyId,
          p_period_month: row.period,
          p_notes: reason.trim() || null,
        });
        if (error) throw error;
        return "closed" as const;
      }
      if (!row.active) throw new Error("Fechamento ativo não encontrado.");
      const { error } = await db.rpc("reopen_financial_period", {
        p_closure_id: row.active.id,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      return "reopened" as const;
    },
    onSuccess: async (result) => {
      toast.success(
        result === "closed"
          ? "Competência encerrada e snapshot preservado."
          : "Competência reaberta para correções.",
      );
      setConfirmation(undefined);
      setNotes("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["financial-period-closures"] }),
        queryClient.invalidateQueries({ queryKey: ["financial-statement"] }),
        queryClient.invalidateQueries({ queryKey: ["financial-budget"] }),
      ]);
    },
    onError: (error) => toast.error(financialActionError(error)),
  });
  const openConfirmation = (action: Confirmation["action"], row: PeriodRow) => {
    setNotes("");
    setConfirmation({ action, row });
  };
  const confirm = () => {
    if (!confirmation) return;
    if (confirmation.action === "reopen" && notes.trim().length < 10) {
      toast.error("Informe uma justificativa com pelo menos 10 caracteres.");
      return;
    }
    mutation.mutate({ ...confirmation, reason: notes });
  };

  return (
    <Card id="financial-period-closure" className="overflow-hidden border-primary/20">
      <CardHeader className="gap-4 border-b bg-gradient-to-r from-amber-500/5 via-background to-sky-500/5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-amber-500/10 p-2.5 text-amber-700 dark:text-amber-300">
            <LockKeyhole className="size-5" />
          </div>
          <div>
            <CardTitle className="text-base">Fechamento mensal</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Preserve o resultado conferido e controle reaberturas por competência.
            </p>
          </div>
        </div>
        <div className="grid w-full gap-2 sm:grid-cols-2 lg:w-auto">
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger className="sm:min-w-56" aria-label="Empresa do fechamento">
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
            <SelectTrigger aria-label="Exercício do fechamento">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map((item) => (
                <SelectItem key={item} value={String(item)}>
                  Exercício {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {companies.isLoading || closures.isLoading ? (
          <LoadingState label="Consultando competências financeiras..." />
        ) : companies.isError || closures.isError ? (
          <ErrorState
            title="Fechamentos indisponíveis"
            description="Não foi possível consultar os períodos desta empresa."
            action={{ label: "Tentar novamente", onClick: () => void closures.refetch() }}
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <ClosureMetric
                icon={CalendarCheck2}
                label="Competências encerradas"
                value={String(activeClosures.length)}
                detail={`de 12 em ${year}`}
                tone="emerald"
              />
              <ClosureMetric
                icon={CheckCircle2}
                label="Resultado consolidado"
                value={money.format(closedResult)}
                detail="somente períodos encerrados"
                tone={closedResult >= 0 ? "blue" : "red"}
              />
              <ClosureMetric
                icon={History}
                label="Reaberturas registradas"
                value={String(reopenedCount)}
                detail="histórico preservado"
                tone="amber"
              />
            </div>
            <div className="overflow-x-auto rounded-xl border">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Competência</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead className="text-right">Receitas</TableHead>
                    <TableHead className="text-right">Despesas</TableHead>
                    <TableHead className="text-right">Resultado</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead>Registro</TableHead>
                    <TableHead className="w-36 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.period}
                      className={row.active ? "bg-emerald-500/[0.025]" : ""}
                    >
                      <TableCell className="font-medium capitalize">{row.label}</TableCell>
                      <TableCell>
                        {row.active ? (
                          <Badge
                            className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            variant="outline"
                          >
                            <LockKeyhole className="mr-1 size-3" /> Encerrada
                          </Badge>
                        ) : row.future ? (
                          <Badge variant="outline" className="text-muted-foreground">
                            Futura
                          </Badge>
                        ) : row.latest?.status === "reopened" ? (
                          <Badge
                            className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                            variant="outline"
                          >
                            <RotateCcw className="mr-1 size-3" /> Reaberta
                          </Badge>
                        ) : (
                          <Badge variant="outline">
                            <CalendarClock className="mr-1 size-3" /> Em aberto
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.active ? money.format(Number(row.active.revenue_realized)) : "-"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.active ? money.format(Number(row.active.expense_realized)) : "-"}
                      </TableCell>
                      <TableCell
                        className={`text-right font-semibold tabular-nums ${row.active && Number(row.active.result_realized) < 0 ? "text-red-700 dark:text-red-300" : ""}`}
                      >
                        {row.active ? money.format(Number(row.active.result_realized)) : "-"}
                      </TableCell>
                      <TableCell>
                        {row.active?.closed_by_name ?? row.latest?.reopened_by_name ?? "-"}
                        {row.active ? (
                          <p className="text-xs text-muted-foreground">
                            Revisão {row.active.revision} · {row.active.snapshot_line_count}{" "}
                            linha(s)
                          </p>
                        ) : row.latest ? (
                          <p className="text-xs text-muted-foreground">
                            Revisão {row.latest.revision} reaberta
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {row.active
                          ? dateTimeFormat.format(new Date(row.active.closed_at))
                          : row.latest?.reopened_at
                            ? dateTimeFormat.format(new Date(row.latest.reopened_at))
                            : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {canEdit && row.active ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            onClick={() => openConfirmation("reopen", row)}
                          >
                            <RotateCcw className="size-3.5" /> Reabrir
                          </Button>
                        ) : canEdit && !row.future ? (
                          <Button
                            size="sm"
                            className="gap-1.5"
                            onClick={() => openConfirmation("close", row)}
                          >
                            <LockKeyhole className="size-3.5" /> Encerrar
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              O encerramento exige que todos os movimentos da competência estejam classificados.
              Orçamentos e classificações ficam protegidos até uma reabertura justificada.
            </p>
          </>
        )}
      </CardContent>
      {confirmation ? (
        <Dialog
          open
          onOpenChange={(open) => !open && !mutation.isPending && setConfirmation(undefined)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {confirmation.action === "close" ? "Encerrar competência" : "Reabrir competência"}
              </DialogTitle>
              <DialogDescription>
                {confirmation.action === "close"
                  ? `Será criado um snapshot imutável do resultado de ${confirmation.row.label}.`
                  : `O período ${confirmation.row.label} voltará a aceitar correções. O snapshot anterior continuará no histórico.`}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="period-action-notes">
                {confirmation.action === "close" ? "Observações" : "Justificativa da reabertura"}
                {confirmation.action === "reopen" ? " *" : " (opcional)"}
              </Label>
              <Textarea
                id="period-action-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={1000}
                rows={4}
                placeholder={
                  confirmation.action === "close"
                    ? "Ex.: conciliação e classificações conferidas."
                    : "Descreva a correção que será realizada."
                }
                autoFocus
              />
              <p className="text-right text-xs text-muted-foreground">{notes.length}/1000</p>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                disabled={mutation.isPending}
                onClick={() => setConfirmation(undefined)}
              >
                Cancelar
              </Button>
              <Button
                variant={confirmation.action === "reopen" ? "destructive" : "default"}
                disabled={
                  mutation.isPending ||
                  (confirmation.action === "reopen" && notes.trim().length < 10)
                }
                onClick={confirm}
              >
                {mutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                {confirmation.action === "close" ? "Confirmar fechamento" : "Confirmar reabertura"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  );
}

function ClosureMetric({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof LockKeyhole;
  label: string;
  value: string;
  detail: string;
  tone: "emerald" | "blue" | "red" | "amber";
}) {
  const colors = {
    emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    blue: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
    red: "bg-red-500/10 text-red-700 dark:text-red-300",
    amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-background p-3">
      <div className={`rounded-lg p-2 ${colors[tone]}`}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-lg font-semibold tabular-nums">{value}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function financialActionError(error: unknown) {
  if (typeof error === "object" && error !== null) {
    const record = error as { code?: string; message?: string };
    if (["23505", "23514", "22001"].includes(record.code ?? "") && record.message) {
      return record.message;
    }
  }
  return getUserFacingError(error, "Não foi possível atualizar a competência financeira.");
}
