import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileCheck2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@apticket/shared-types/database";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { getUserFacingError } from "@/lib/user-facing-error";

type BillingStatus = "a_faturar" | "faturado" | "vencido" | "recebido" | "cancelado";
type Receivable = Tables<"contas_receber"> & {
  medicoes_contrato: { report_token: string } | null;
};

const STATUS: Array<{ value: BillingStatus; label: string }> = [
  { value: "a_faturar", label: "A faturar" },
  { value: "faturado", label: "Faturado" },
  { value: "vencido", label: "Vencido" },
  { value: "recebido", label: "Recebido" },
  { value: "cancelado", label: "Cancelado" },
];

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function effectiveStatus(receivable: Receivable): BillingStatus {
  if (
    receivable.status_cobranca === "faturado" &&
    receivable.vencimento_em < new Date().toISOString().slice(0, 10)
  ) {
    return "vencido";
  }
  return receivable.status_cobranca;
}

function statusLabel(status: BillingStatus) {
  return STATUS.find((item) => item.value === status)?.label ?? status;
}

function StatusBadge({ status }: { status: BillingStatus }) {
  const classes: Record<BillingStatus, string> = {
    a_faturar: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    faturado: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    vencido: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
    recebido: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    cancelado: "border-muted-foreground/30 bg-muted text-muted-foreground",
  };
  return (
    <Badge className={classes[status]} variant="outline">
      {statusLabel(status)}
    </Badge>
  );
}

export function MeasurementReceivables({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"todos" | BillingStatus>("todos");
  const [editing, setEditing] = useState<Receivable | null>(null);

  const query = useQuery({
    queryKey: ["measurement-receivables"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contas_receber")
        .select("*, medicoes_contrato(report_token)")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Receivable[];
    },
  });

  const receivables = useMemo(() => query.data ?? [], [query.data]);
  const filtered = receivables.filter(
    (receivable) => filter === "todos" || effectiveStatus(receivable) === filter,
  );
  const pendingTotal = receivables
    .filter((receivable) => !["recebido", "cancelado"].includes(effectiveStatus(receivable)))
    .reduce((sum, receivable) => sum + Number(receivable.valor_aberto), 0);

  return (
    <Card>
      <CardHeader className="flex flex-col items-start justify-between gap-3 space-y-0 border-b sm:flex-row">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-600">
            <FileCheck2 className="size-5" />
          </div>
          <div>
            <CardTitle className="text-base">Contas a receber de medições</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {receivables.length} lançamento(s) · {money.format(pendingTotal)} em aberto
            </p>
          </div>
        </div>
        <Select value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
          <SelectTrigger className="w-full shrink-0 sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            {STATUS.map((status) => (
              <SelectItem key={status.value} value={status.value}>
                {status.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="p-0">
        {query.isLoading ? (
          <LoadingState label="Carregando contas a receber…" />
        ) : query.isError ? (
          <ErrorState
            title="Não foi possível carregar as medições aprovadas"
            description="Verifique sua conexão e tente novamente."
            action={{ label: "Tentar novamente", onClick: () => void query.refetch() }}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Nenhuma conta a receber neste status"
            description="As medições aprovadas aparecerão aqui automaticamente."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[840px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Documento</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Competência</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((receivable) => (
                  <TableRow key={receivable.id}>
                    <TableCell>
                      <div className="font-medium">{receivable.documento_referencia}</div>
                      <div className="max-w-64 truncate text-[11px] text-muted-foreground">
                        {receivable.descricao}
                      </div>
                    </TableCell>
                    <TableCell>{receivable.cliente_nome}</TableCell>
                    <TableCell>
                      {new Date(`${receivable.competencia}T12:00:00`).toLocaleDateString("pt-BR", {
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </TableCell>
                    <TableCell className="font-semibold tabular-nums">
                      {money.format(Number(receivable.valor_aberto))}
                    </TableCell>
                    <TableCell>
                      {new Date(`${receivable.vencimento_em}T12:00:00`).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={effectiveStatus(receivable)} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {receivable.medicoes_contrato?.report_token && (
                          <Button asChild size="sm" variant="ghost">
                            <a
                              href={`/measurement-report/${receivable.medicoes_contrato.report_token}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <ExternalLink className="size-4" /> Boletim
                            </a>
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => setEditing(receivable)}>
                          {canEdit ? "Revisar" : "Visualizar"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <ReceivableDialog
        receivable={editing}
        canEdit={canEdit}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void queryClient.invalidateQueries({ queryKey: ["measurement-receivables"] });
        }}
      />
    </Card>
  );
}

function ReceivableDialog({
  receivable,
  canEdit,
  onClose,
  onSaved,
}: {
  receivable: Receivable | null;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<BillingStatus>("a_faturar");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!receivable) return;
    setStatus(receivable.status_cobranca);
    setDueDate(receivable.vencimento_em);
    setNotes(receivable.observacoes ?? "");
  }, [receivable]);

  const save = useMutation({
    mutationFn: async () => {
      if (!receivable || !canEdit) return;
      const { error } = await supabase
        .from("contas_receber")
        .update({
          status_cobranca: status,
          vencimento_em: dueDate,
          observacoes: notes.trim() || null,
          valor_aberto: status === "recebido" ? 0 : receivable.valor_original,
        })
        .eq("id", receivable.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Conta a receber atualizada.");
      onSaved();
    },
    onError: (error: Error) =>
      toast.error(getUserFacingError(error, "Não foi possível atualizar a conta a receber.")),
  });

  return (
    <Dialog open={Boolean(receivable)} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Conta a receber {receivable?.documento_referencia}</DialogTitle>
        </DialogHeader>
        {receivable && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Valor da medição</Label>
              <Input value={money.format(Number(receivable.valor_original))} disabled />
            </div>
            <div>
              <Label>Status</Label>
              <Select
                disabled={!canEdit}
                value={status}
                onValueChange={(value) => setStatus(value as BillingStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="measurement-receivable-due">Vencimento</Label>
              <Input
                id="measurement-receivable-due"
                type="date"
                disabled={!canEdit}
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="measurement-receivable-notes">Observações</Label>
              <Textarea
                id="measurement-receivable-notes"
                rows={4}
                disabled={!canEdit}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {canEdit ? "Cancelar" : "Fechar"}
          </Button>
          {canEdit && (
            <Button disabled={save.isPending || !dueDate} onClick={() => save.mutate()}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />} Salvar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
