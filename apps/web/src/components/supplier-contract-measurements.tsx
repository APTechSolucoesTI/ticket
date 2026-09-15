import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CalendarPlus, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getUserFacingError } from "@/lib/user-facing-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";

type SupplierContract = {
  id: string;
  description: string;
  billing_unit: "fixed" | "active_users" | "devices";
  billing_interval_months: 1 | 3 | 6 | 12;
  starts_at: string;
  ends_at: string | null;
};

type Measurement = {
  id: string;
  document_number: string;
  cycle_start: string;
  cycle_end: string;
  due_date: string;
  measured_quantity: number;
  total_amount: number;
  allocation_status: "pending_rule" | "complete";
  status: "scheduled" | "awaiting_approval" | "approved" | "paid" | "overdue" | "cancelled";
};

const db = supabase as unknown as SupabaseClient;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const quantity = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const date = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const statusLabels: Record<Measurement["status"], string> = {
  scheduled: "Gerada",
  awaiting_approval: "Aguardando aprovação",
  approved: "Aprovada",
  paid: "Paga",
  overdue: "Vencida",
  cancelled: "Cancelada",
};
const unitLabels = {
  fixed: "Valor fixo",
  active_users: "Usuários ativos",
  devices: "Dispositivos",
};

function currentCompetence() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatDate(value: string) {
  return date.format(new Date(`${value}T00:00:00Z`));
}

export function SupplierContractMeasurements({
  contract,
  supplierName,
  canGenerate,
}: {
  contract: SupplierContract;
  supplierName: string;
  canGenerate: boolean;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["supplier-contract-measurements", contract.id];
  const [competence, setCompetence] = useState(currentCompetence);
  const measurements = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await db
        .from("supplier_payables")
        .select(
          "id,document_number,cycle_start,cycle_end,due_date,measured_quantity,total_amount,allocation_status,status",
        )
        .eq("supplier_contract_id", contract.id)
        .is("deleted_at", null)
        .order("cycle_start", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Measurement[];
    },
  });
  const generate = useMutation({
    mutationFn: async () => {
      const { data, error } = await db.rpc("generate_supplier_payable", {
        p_supplier_contract_id: contract.id,
        p_competence: `${competence}-01`,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      toast.success("Medição gerada e encaminhada ao Contas a Pagar.");
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ["supplier-payables"] });
    },
    onError: (error: Error) =>
      toast.error(getUserFacingError(error, "Não foi possível gerar a medição.")),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            <FileText className="size-4 text-primary" />
            Histórico de medições
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {supplierName} · {unitLabels[contract.billing_unit]}. Cada medição gera um lançamento
            rastreável no Contas a Pagar.
          </p>
        </div>
        {canGenerate ? (
          <div className="flex gap-2">
            <Input
              aria-label="Competência da medição"
              type="month"
              value={competence}
              onChange={(event) => setCompetence(event.target.value)}
              className="w-40"
            />
            <Button
              type="button"
              className="gap-2"
              disabled={!competence || generate.isPending}
              onClick={() => generate.mutate()}
            >
              {generate.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CalendarPlus className="size-4" />
              )}
              Gerar medição
            </Button>
          </div>
        ) : null}
      </div>

      {measurements.isLoading ? (
        <LoadingState label="Carregando medições…" />
      ) : measurements.isError ? (
        <ErrorState
          title="Medições indisponíveis"
          description="Não foi possível consultar o histórico deste contrato."
          action={{ label: "Tentar novamente", onClick: () => void measurements.refetch() }}
        />
      ) : !measurements.data?.length ? (
        <EmptyState
          title="Nenhuma medição gerada"
          description="Selecione uma competência para realizar a primeira medição do contrato."
        />
      ) : (
        <div className="space-y-2">
          {measurements.data.map((measurement) => (
            <div
              key={measurement.id}
              className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_auto_auto] sm:items-center"
            >
              <div>
                <p className="font-medium">{measurement.document_number}</p>
                <p className="text-xs text-muted-foreground">
                  Competência {formatDate(measurement.cycle_start)} · vencimento{" "}
                  {formatDate(measurement.due_date)}
                </p>
                {contract.billing_unit !== "fixed" ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Quantidade medida: {quantity.format(Number(measurement.measured_quantity))}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{statusLabels[measurement.status]}</Badge>
                <Badge
                  variant={measurement.allocation_status === "complete" ? "secondary" : "outline"}
                >
                  Rateio {measurement.allocation_status === "complete" ? "concluído" : "pendente"}
                </Badge>
              </div>
              <strong className="text-right tabular-nums">
                {money.format(measurement.total_amount)}
              </strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
