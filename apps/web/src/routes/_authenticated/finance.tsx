import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Loader2,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/empty-stub";
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
import { useModulePermissions } from "@/lib/permission-ui";
import { getCurrentUserId } from "@/lib/session";
import { getMyTenantId } from "@/lib/tenant";
import { getUserFacingError } from "@/lib/user-facing-error";
import { MeasurementReceivables } from "@/components/measurement-receivables";

export const Route = createFileRoute("/_authenticated/finance")({
  head: () => ({ meta: [{ title: "Financeiro - APTicket" }] }),
  component: FinancePage,
});

type BillingStatus = "a_faturar" | "faturado" | "vencido" | "recebido" | "cancelado";
type Charge = {
  id: string;
  ticket_id: string;
  tenant_id: string;
  minutos_apurados: number;
  valor_base: number;
  valor_final: number;
  valor_ajustado_manualmente: boolean;
  justificativa_ajuste: string | null;
  status_cobranca: BillingStatus;
  vencimento_em: string | null;
  observacoes: string | null;
  revisado_em: string | null;
  created_at: string;
  tickets: {
    id: string;
    number: number;
    subject: string;
    status: string;
    created_at: string;
    resolved_at: string | null;
    closed_at: string | null;
    companies: { name: string } | null;
  };
};

type PriceTable = {
  id: string;
  tenant_id: string;
  nome: string;
  limite_valor_fixo_minutos: number;
  valor_fixo: number;
  valor_hora_tecnica: number;
  vigente_desde: string;
};

const STATUS: Array<{ value: BillingStatus; label: string }> = [
  { value: "a_faturar", label: "A faturar" },
  { value: "faturado", label: "Faturado" },
  { value: "vencido", label: "Vencido" },
  { value: "recebido", label: "Recebido" },
  { value: "cancelado", label: "Cancelado" },
];

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function effectiveStatus(charge: Charge): BillingStatus {
  if (
    charge.status_cobranca === "faturado" &&
    charge.vencimento_em &&
    charge.vencimento_em < new Date().toISOString().slice(0, 10)
  ) {
    return "vencido";
  }
  return charge.status_cobranca;
}

function statusLabel(status: BillingStatus) {
  return STATUS.find((item) => item.value === status)?.label ?? status;
}

function BillingStatusBadge({ status }: { status: BillingStatus }) {
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

function FinancePage() {
  const access = useModulePermissions("financeiro");
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"todos" | BillingStatus>("todos");
  const [editing, setEditing] = useState<Charge | null>(null);
  const [priceOpen, setPriceOpen] = useState(false);

  const chargesQuery = useQuery({
    queryKey: ["avulso-billing"],
    queryFn: async () => {
      const { error: overdueError } = await supabase.rpc("atualizar_cobrancas_vencidas");
      if (overdueError) throw overdueError;
      const { data, error } = await supabase
        .from("tickets_cobranca_avulsa")
        .select(
          "id, ticket_id, tenant_id, minutos_apurados, valor_base, valor_final, valor_ajustado_manualmente, justificativa_ajuste, status_cobranca, vencimento_em, observacoes, revisado_em, created_at, tickets!inner(id, number, subject, status, created_at, resolved_at, closed_at, companies(name))",
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Charge[];
    },
  });

  const priceQuery = useQuery({
    queryKey: ["avulso-price-table"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tabela_precos_avulso")
        .select(
          "id, tenant_id, nome, limite_valor_fixo_minutos, valor_fixo, valor_hora_tecnica, vigente_desde",
        )
        .eq("ativa", true)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw error;
      return data as PriceTable | null;
    },
  });

  const charges = useMemo(() => chargesQuery.data ?? [], [chargesQuery.data]);
  const filtered = charges.filter(
    (charge) => filter === "todos" || effectiveStatus(charge) === filter,
  );
  const totalByStatus = (status: BillingStatus) =>
    charges
      .filter((charge) => effectiveStatus(charge) === status)
      .reduce((sum, charge) => sum + Number(charge.valor_final), 0);

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Financeiro"
        subtitle="Controle o faturamento dos atendimentos avulsos e das medições contratuais."
        actions={
          access.edit ? (
            <Button variant="outline" className="gap-2" onClick={() => setPriceOpen(true)}>
              <Settings2 className="size-4" /> Configurar preços
            </Button>
          ) : undefined
        }
      />

      <div>
        <h2 className="mb-3 text-sm font-semibold">Atendimentos avulsos</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            icon={Clock3}
            label="A faturar"
            count={charges.filter((c) => effectiveStatus(c) === "a_faturar").length}
            value={totalByStatus("a_faturar")}
            tone="amber"
          />
          <SummaryCard
            icon={Banknote}
            label="Faturado"
            count={charges.filter((c) => effectiveStatus(c) === "faturado").length}
            value={totalByStatus("faturado")}
            tone="blue"
          />
          <SummaryCard
            icon={CalendarClock}
            label="Vencido"
            count={charges.filter((c) => effectiveStatus(c) === "vencido").length}
            value={totalByStatus("vencido")}
            tone="red"
          />
          <SummaryCard
            icon={CheckCircle2}
            label="Recebido"
            count={charges.filter((c) => effectiveStatus(c) === "recebido").length}
            value={totalByStatus("recebido")}
            tone="green"
          />
        </div>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b">
          <div>
            <CardTitle className="text-base">Tickets para faturamento</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Valores calculados pelo tempo apontado e revisados antes do faturamento manual.
            </p>
          </div>
          <Select value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              {STATUS.slice(0, 4).map((status) => (
                <SelectItem key={status.value} value={status.value}>
                  {status.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          {chargesQuery.isLoading ? (
            <LoadingState label="Carregando cobranças…" />
          ) : chargesQuery.isError ? (
            <ErrorState
              title="Não foi possível carregar o financeiro"
              description="Verifique sua conexão e tente novamente."
              action={{ label: "Tentar novamente", onClick: () => void chargesQuery.refetch() }}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="Nenhuma cobrança neste status"
              description="Os tickets avulsos aparecerão aqui automaticamente."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Tempo</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Revisão</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((charge) => (
                  <TableRow key={charge.id}>
                    <TableCell>
                      <Link
                        to="/tickets/$id"
                        params={{ id: charge.ticket_id }}
                        className="font-medium text-primary hover:underline"
                      >
                        #{charge.tickets.number} {charge.tickets.subject}
                      </Link>
                    </TableCell>
                    <TableCell>{charge.tickets.companies?.name ?? "Sem cliente"}</TableCell>
                    <TableCell>
                      {Math.floor(charge.minutos_apurados / 60)}h {charge.minutos_apurados % 60}min
                    </TableCell>
                    <TableCell>
                      <div className="font-semibold tabular-nums">
                        {money.format(charge.valor_final)}
                      </div>
                      {charge.valor_ajustado_manualmente && (
                        <div className="text-[10px] text-muted-foreground">Ajustado</div>
                      )}
                    </TableCell>
                    <TableCell>
                      {charge.vencimento_em
                        ? new Date(`${charge.vencimento_em}T12:00:00`).toLocaleDateString("pt-BR")
                        : "Não definido"}
                    </TableCell>
                    <TableCell>
                      <BillingStatusBadge status={effectiveStatus(charge)} />
                    </TableCell>
                    <TableCell>
                      {charge.revisado_em ? (
                        <span className="text-emerald-600">Revisado</span>
                      ) : (
                        <span className="text-amber-600">Pendente</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setEditing(charge)}>
                        {access.edit ? "Revisar" : "Visualizar"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <MeasurementReceivables canEdit={access.edit} />

      <ChargeDialog
        charge={editing}
        canEdit={access.edit}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void queryClient.invalidateQueries({ queryKey: ["avulso-billing"] });
        }}
      />
      <PriceDialog
        open={priceOpen}
        price={priceQuery.data ?? null}
        onClose={() => setPriceOpen(false)}
        onSaved={() => {
          setPriceOpen(false);
          void queryClient.invalidateQueries({ queryKey: ["avulso-price-table"] });
        }}
      />
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  count,
  value,
  tone,
}: {
  icon: typeof Clock3;
  label: string;
  count: number;
  value: number;
  tone: "amber" | "blue" | "red" | "green";
}) {
  const tones = {
    amber: "bg-amber-500/10 text-amber-600",
    blue: "bg-blue-500/10 text-blue-600",
    red: "bg-red-500/10 text-red-600",
    green: "bg-emerald-500/10 text-emerald-600",
  };
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`rounded-lg p-2.5 ${tones[tone]}`}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">
            {label} · {count}
          </div>
          <div className="truncate text-lg font-semibold tabular-nums">{money.format(value)}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChargeDialog({
  charge,
  canEdit,
  onClose,
  onSaved,
}: {
  charge: Charge | null;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    valor_final: 0,
    status: "a_faturar" as BillingStatus,
    vencimento_em: "",
    observacoes: "",
    justificativa: "",
  });
  useEffect(() => {
    if (charge)
      setForm({
        valor_final: Number(charge.valor_final),
        status: charge.status_cobranca,
        vencimento_em: charge.vencimento_em ?? "",
        observacoes: charge.observacoes ?? "",
        justificativa: charge.justificativa_ajuste ?? "",
      });
  }, [charge]);
  const save = useMutation({
    mutationFn: async () => {
      if (!charge || !canEdit) return;
      const changed = form.valor_final !== Number(charge.valor_final);
      if (changed && !form.justificativa.trim())
        throw new Error("Informe a justificativa do ajuste");
      const { error } = await supabase
        .from("tickets_cobranca_avulsa")
        .update({
          valor_final: form.valor_final,
          status_cobranca: form.status,
          vencimento_em: form.vencimento_em || null,
          observacoes: form.observacoes || null,
          justificativa_ajuste: form.justificativa || charge.justificativa_ajuste,
          revisado_em: new Date().toISOString(),
          revisado_por: getCurrentUserId(),
        })
        .eq("id", charge.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cobrança atualizada");
      onSaved();
    },
    onError: (error: Error) =>
      toast.error(getUserFacingError(error, "Não foi possível salvar os dados financeiros.")),
  });
  return (
    <Dialog
      open={Boolean(charge)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revisar cobrança do ticket #{charge?.tickets.number}</DialogTitle>
        </DialogHeader>
        {charge && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Valor calculado</Label>
              <Input value={money.format(charge.valor_base)} disabled />
            </div>
            <div>
              <Label htmlFor="charge-final">Valor final</Label>
              <Input
                id="charge-final"
                type="number"
                min="0"
                step="0.01"
                disabled={!canEdit}
                value={form.valor_final}
                onChange={(e) => setForm({ ...form, valor_final: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Status</Label>
              <Select
                disabled={!canEdit}
                value={form.status}
                onValueChange={(status) => setForm({ ...form, status: status as BillingStatus })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS.map((status) => (
                    <SelectItem key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="charge-due">Vencimento</Label>
              <Input
                id="charge-due"
                type="date"
                disabled={!canEdit}
                value={form.vencimento_em}
                onChange={(e) => setForm({ ...form, vencimento_em: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="charge-reason">Justificativa do ajuste</Label>
              <Textarea
                id="charge-reason"
                disabled={!canEdit}
                value={form.justificativa}
                onChange={(e) => setForm({ ...form, justificativa: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="charge-notes">Observações</Label>
              <Textarea
                id="charge-notes"
                disabled={!canEdit}
                value={form.observacoes}
                onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {canEdit ? "Cancelar" : "Fechar"}
          </Button>
          {canEdit && (
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />}Salvar revisão
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PriceDialog({
  open,
  price,
  onClose,
  onSaved,
}: {
  open: boolean;
  price: PriceTable | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({ limite: 90, fixo: 0, hora: 0 });
  useEffect(() => {
    if (open)
      setForm({
        limite: price?.limite_valor_fixo_minutos ?? 90,
        fixo: Number(price?.valor_fixo ?? 0),
        hora: Number(price?.valor_hora_tecnica ?? 0),
      });
  }, [open, price]);
  const save = useMutation({
    mutationFn: async () => {
      if (form.limite <= 0 || form.fixo < 0 || form.hora < 0)
        throw new Error("Informe valores válidos");
      if (price) {
        const { error } = await supabase
          .from("tabela_precos_avulso")
          .update({
            limite_valor_fixo_minutos: form.limite,
            valor_fixo: form.fixo,
            valor_hora_tecnica: form.hora,
          })
          .eq("id", price.id);
        if (error) throw error;
      } else {
        const tenantId = await getMyTenantId();
        if (!tenantId) throw new Error("Tenant não encontrado");
        const { error } = await supabase.from("tabela_precos_avulso").insert({
          tenant_id: tenantId,
          limite_valor_fixo_minutos: form.limite,
          valor_fixo: form.fixo,
          valor_hora_tecnica: form.hora,
          criado_por: getCurrentUserId(),
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Tabela de preços atualizada");
      onSaved();
    },
    onError: (error: Error) =>
      toast.error(getUserFacingError(error, "Não foi possível atualizar o faturamento.")),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Precificação do atendimento avulso</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            Até o limite configurado, aplica-se o valor fixo. Acima do limite, o valor usa o total
            de horas técnicas apontadas.
          </div>
          <div>
            <Label htmlFor="price-limit">Limite para valor fixo em minutos</Label>
            <Input
              id="price-limit"
              type="number"
              min="1"
              value={form.limite}
              onChange={(e) => setForm({ ...form, limite: Number(e.target.value) })}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Padrão definido: 90 minutos, equivalente a 1h30.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="price-fixed">Valor fixo</Label>
              <Input
                id="price-fixed"
                type="number"
                min="0"
                step="0.01"
                value={form.fixo}
                onChange={(e) => setForm({ ...form, fixo: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label htmlFor="price-hour">Valor da hora técnica</Label>
              <Input
                id="price-hour"
                type="number"
                min="0"
                step="0.01"
                value={form.hora}
                onChange={(e) => setForm({ ...form, hora: Number(e.target.value) })}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />}Salvar preços
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
