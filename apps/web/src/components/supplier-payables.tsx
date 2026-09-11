import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CalendarPlus, CircleDollarSign, Eye, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
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
import { supabase } from "@/integrations/supabase/client";
import { getUserFacingError } from "@/lib/user-facing-error";

export type PayableContractOption = {
  id: string;
  supplierName: string;
  description: string;
  billingUnit: "fixed" | "active_users" | "devices";
  intervalMonths: number;
  startsAt: string;
  endsAt: string | null;
  active: boolean;
};

type Payable = {
  id: string;
  supplier_contract_id: string;
  document_number: string;
  description: string;
  cycle_start: string;
  cycle_end: string;
  due_date: string;
  billing_unit: PayableContractOption["billingUnit"];
  measured_quantity: number;
  unit_price: number;
  total_amount: number;
  allocation_status: "pending_rule" | "complete";
  status: "scheduled" | "awaiting_approval" | "approved" | "paid" | "overdue" | "cancelled";
  terms_snapshot: { supplier_name?: string; contract_description?: string };
};

type Allocation = {
  id: string;
  customer_contract_id: string;
  customer_name: string;
  contract_number: string;
  metric: "active_users" | "devices" | null;
  quantity: number;
  unit_price: number;
  percentage: number | null;
  amount: number;
};

const db = supabase as unknown as SupabaseClient;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 6 });
const date = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const unitLabels = {
  fixed: "Fixo",
  active_users: "Usuários ativos",
  devices: "Dispositivos",
};
const intervalLabels: Record<number, string> = {
  1: "mensal",
  3: "trimestral",
  6: "semestral",
  12: "anual",
};

function defaultMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatDate(value: string) {
  return date.format(new Date(`${value}T00:00:00Z`));
}

function formatExclusiveEnd(value: string) {
  const end = new Date(`${value}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  return date.format(end);
}

function effectiveStatus(payable: Payable) {
  if (payable.status === "scheduled" && payable.due_date < new Date().toISOString().slice(0, 10))
    return "overdue";
  return payable.status;
}

const statusLabels = {
  scheduled: "Agendado",
  awaiting_approval: "Aguardando aprovação",
  approved: "Aprovado",
  paid: "Pago",
  overdue: "Atrasado",
  cancelled: "Cancelado",
};

export function SupplierPayables({
  companyId,
  contracts,
  canEdit,
}: {
  companyId: string;
  contracts: PayableContractOption[];
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [allocationFilter, setAllocationFilter] = useState<"all" | "pending_rule" | "complete">(
    "all",
  );
  const [generateOpen, setGenerateOpen] = useState(false);
  const [selected, setSelected] = useState<Payable>();
  const query = useQuery({
    queryKey: ["supplier-payables", companyId],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const { data, error } = await db
        .from("supplier_payables")
        .select(
          "id,supplier_contract_id,document_number,description,cycle_start,cycle_end,due_date,billing_unit,measured_quantity,unit_price,total_amount,allocation_status,status,terms_snapshot",
        )
        .eq("operating_company_id", companyId)
        .is("deleted_at", null)
        .order("due_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Payable[];
    },
  });
  const rows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return (query.data ?? []).filter(
      (item) =>
        (allocationFilter === "all" || item.allocation_status === allocationFilter) &&
        (!term ||
          `${item.document_number} ${item.description} ${item.terms_snapshot.supplier_name ?? ""}`
            .toLocaleLowerCase("pt-BR")
            .includes(term)),
    );
  }, [allocationFilter, query.data, search]);
  const total = (query.data ?? []).reduce((sum, item) => sum + Number(item.total_amount), 0);
  const pending = (query.data ?? []).filter((item) => item.allocation_status === "pending_rule");

  return (
    <Card>
      <CardHeader className="gap-3 border-b lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <CircleDollarSign className="size-5 text-primary" />
            <CardTitle className="text-base">Lançamentos de fornecedores</CardTitle>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Contas geradas por competência, com custo variável rateado pela apuração dos clientes.
          </p>
        </div>
        {canEdit ? (
          <Button
            className="gap-2"
            onClick={() => setGenerateOpen(true)}
            disabled={!contracts.length}
          >
            <CalendarPlus className="size-4" />
            Gerar lançamento
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Summary label="Total lançado" value={money.format(total)} />
          <Summary label="Lançamentos" value={String(query.data?.length ?? 0)} />
          <Summary
            label="Rateio pendente"
            value={String(pending.length)}
            alert={pending.length > 0}
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar documento, fornecedor ou contrato"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Select
            value={allocationFilter}
            onValueChange={(value) => setAllocationFilter(value as typeof allocationFilter)}
          >
            <SelectTrigger className="sm:w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os rateios</SelectItem>
              <SelectItem value="complete">Rateio concluído</SelectItem>
              <SelectItem value="pending_rule">Rateio pendente</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {query.isLoading ? (
          <LoadingState label="Carregando lançamentos…" />
        ) : query.isError ? (
          <ErrorState
            title="Lançamentos indisponíveis"
            description="Não foi possível consultar as contas deste ambiente financeiro."
            action={{ label: "Tentar novamente", onClick: () => void query.refetch() }}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nenhum lançamento encontrado"
            description={
              search || allocationFilter !== "all"
                ? "Ajuste os filtros para ampliar a busca."
                : "Gere o primeiro lançamento a partir de um contrato de fornecedor ativo."
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Documento</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Competência</TableHead>
                  <TableHead>Rateio</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((item) => {
                  const status = effectiveStatus(item);
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="font-medium">{item.document_number}</div>
                        <div className="max-w-56 truncate text-xs text-muted-foreground">
                          {item.description}
                        </div>
                      </TableCell>
                      <TableCell>{item.terms_snapshot.supplier_name ?? "Fornecedor"}</TableCell>
                      <TableCell>
                        {formatDate(item.cycle_start)} a {formatExclusiveEnd(item.cycle_end)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={item.allocation_status === "complete" ? "secondary" : "outline"}
                        >
                          {item.allocation_status === "complete" ? "Concluído" : "Pendente"}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDate(item.due_date)}</TableCell>
                      <TableCell>
                        <Badge variant={status === "overdue" ? "destructive" : "outline"}>
                          {statusLabels[status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {money.format(item.total_amount)}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Detalhar ${item.document_number}`}
                          onClick={() => setSelected(item)}
                        >
                          <Eye className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {generateOpen ? (
        <GenerateDialog
          companyId={companyId}
          contracts={contracts}
          onClose={() => setGenerateOpen(false)}
          onGenerated={() =>
            void queryClient.invalidateQueries({ queryKey: ["supplier-payables", companyId] })
          }
        />
      ) : null}
      {selected ? (
        <AllocationDialog
          payable={selected}
          canEdit={canEdit}
          onClose={() => setSelected(undefined)}
          onApplied={() =>
            void queryClient.invalidateQueries({ queryKey: ["supplier-payables", companyId] })
          }
        />
      ) : null}
    </Card>
  );
}

function Summary({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-muted/25 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={
          alert ? "mt-1 text-lg font-semibold text-amber-700" : "mt-1 text-lg font-semibold"
        }
      >
        {value}
      </p>
    </div>
  );
}

function GenerateDialog({
  companyId,
  contracts,
  onClose,
  onGenerated,
}: {
  companyId: string;
  contracts: PayableContractOption[];
  onClose: () => void;
  onGenerated: () => void;
}) {
  const active = contracts.filter((item) => item.active);
  const [contractId, setContractId] = useState(active[0]?.id ?? "");
  const [competence, setCompetence] = useState(defaultMonth());
  const contract = active.find((item) => item.id === contractId);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!contractId || !competence) throw new Error("Selecione o contrato e a competência.");
      const { data, error } = await db.rpc("generate_supplier_payable", {
        p_supplier_contract_id: contractId,
        p_competence: `${competence}-01`,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast.success("Lançamento gerado com sucesso.");
      onGenerated();
      onClose();
    },
    onError: (error) => toast.error(getUserFacingError(error, "gerar o lançamento")),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Gerar lançamento do fornecedor</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="payable-contract">Contrato do fornecedor</Label>
            <Select value={contractId} onValueChange={setContractId}>
              <SelectTrigger id="payable-contract">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {active.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.supplierName} · {item.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payable-competence">Competência inicial</Label>
            <Input
              id="payable-competence"
              type="month"
              value={competence}
              onChange={(event) => setCompetence(event.target.value)}
            />
          </div>
          {contract ? (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{unitLabels[contract.billingUnit]}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Cobrança {intervalLabels[contract.intervalMonths] ?? "recorrente"}, vigente desde{" "}
                {formatDate(contract.startsAt)}.
              </p>
              {contract.billingUnit === "fixed" ? (
                <p className="mt-2 text-xs text-amber-700">
                  O lançamento será criado com rateio pendente até a configuração das regras
                  percentuais.
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  A quantidade e o rateio serão copiados dos snapshots de consumo desta competência.
                </p>
              )}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!contractId || !competence || mutation.isPending}
          >
            {mutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Gerar lançamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AllocationDialog({
  payable,
  canEdit,
  onClose,
  onApplied,
}: {
  payable: Payable;
  canEdit: boolean;
  onClose: () => void;
  onApplied: () => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["supplier-payable-allocations", payable.id],
    queryFn: async () => {
      const allocationsResult = await db
        .from("supplier_payable_allocations")
        .select(
          "id,customer_contract_id,customer_name,contract_number,metric,quantity,unit_price,percentage,amount",
        )
        .eq("supplier_payable_id", payable.id)
        .is("deleted_at", null)
        .order("amount", { ascending: false });
      if (allocationsResult.error) throw allocationsResult.error;
      return (allocationsResult.data ?? []) as Allocation[];
    },
  });
  const applyMutation = useMutation({
    mutationFn: async () => {
      const { error } = await db.rpc("apply_supplier_payable_allocation", {
        p_supplier_payable_id: payable.id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Rateio aplicado ao lançamento.");
      await queryClient.invalidateQueries({
        queryKey: ["supplier-payable-allocations", payable.id],
      });
      onApplied();
      onClose();
    },
    onError: (error) => toast.error(getUserFacingError(error, "aplicar o rateio")),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Rateio do lançamento</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 rounded-lg border bg-muted/25 p-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Documento</p>
            <p className="font-medium">{payable.document_number}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Fornecedor</p>
            <p className="font-medium">{payable.terms_snapshot.supplier_name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Valor total</p>
            <p className="font-semibold">{money.format(payable.total_amount)}</p>
          </div>
        </div>
        {query.isLoading ? (
          <LoadingState label="Carregando rateio…" />
        ) : query.isError ? (
          <ErrorState
            title="Rateio indisponível"
            description="Não foi possível consultar os itens rateados."
            action={{ label: "Tentar novamente", onClick: () => void query.refetch() }}
          />
        ) : !query.data?.length ? (
          <EmptyState
            title="Rateio pendente"
            description="Este custo fixo ainda não possui regras percentuais de distribuição."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Critério</TableHead>
                  <TableHead className="text-right">Custo rateado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.customer_name}</TableCell>
                    <TableCell>{item.contract_number}</TableCell>
                    <TableCell>
                      {item.percentage !== null
                        ? `${number.format(item.percentage)}%`
                        : `${number.format(item.quantity)} ${unitLabels[item.metric!].toLocaleLowerCase("pt-BR")}`}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {money.format(item.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter>
          {canEdit && payable.allocation_status === "pending_rule" ? (
            <Button onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending}>
              {applyMutation.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 size-4" />
              )}
              Aplicar rateio
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
