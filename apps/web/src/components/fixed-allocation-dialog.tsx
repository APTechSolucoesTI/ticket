import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Loader2, PieChart, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { getUserFacingError } from "@/lib/user-facing-error";

type SupplierContract = { id: string; description: string };
type CustomerContract = { id: string; number: string; customer: string };
type AllocationRow = CustomerContract & { percentage: string };
type RuleSet = { id: string; effective_from: string };
type Rule = { customer_contract_id: string; percentage: number };

const db = supabase as unknown as SupabaseClient;

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value: string) {
  const [year, month] = value.slice(0, 7).split("-");
  return `${month}/${year}`;
}

export function FixedAllocationDialog({
  companyId,
  supplierName,
  contract,
  onClose,
  onSaved,
}: {
  companyId: string;
  supplierName: string;
  contract: SupplierContract;
  onClose(): void;
  onSaved(): void;
}) {
  const queryClient = useQueryClient();
  const [effectiveMonth, setEffectiveMonth] = useState(currentMonth());
  const [selectedContract, setSelectedContract] = useState("");
  const [rows, setRows] = useState<AllocationRow[]>([]);

  const customerContracts = useQuery({
    queryKey: ["fixed-allocation-customer-contracts", companyId],
    queryFn: async () => {
      const termsResult = await db
        .from("contract_financial_terms")
        .select("contract_id")
        .eq("operating_company_id", companyId)
        .is("deleted_at", null);
      if (termsResult.error) throw termsResult.error;
      const ids = [...new Set((termsResult.data ?? []).map((item) => item.contract_id as string))];
      if (!ids.length) return [] as CustomerContract[];
      const contractsResult = await db
        .from("contracts")
        .select("id,numero_contrato,company_id,status")
        .in("id", ids)
        .eq("status", "active")
        .order("numero_contrato");
      if (contractsResult.error) throw contractsResult.error;
      const companyIds = [
        ...new Set((contractsResult.data ?? []).map((item) => item.company_id as string)),
      ];
      if (!companyIds.length) return [] as CustomerContract[];
      const companiesResult = await db.from("companies").select("id,name").in("id", companyIds);
      if (companiesResult.error) throw companiesResult.error;
      const names = new Map(
        (companiesResult.data ?? []).map((item) => [item.id as string, item.name as string]),
      );
      return (contractsResult.data ?? []).map((item) => ({
        id: item.id as string,
        number: item.numero_contrato as string,
        customer: names.get(item.company_id as string) ?? "Cliente",
      })) as CustomerContract[];
    },
  });

  const ruleSets = useQuery({
    queryKey: ["supplier-allocation-rule-sets", contract.id],
    queryFn: async () => {
      const { data, error } = await db
        .from("supplier_allocation_rule_sets")
        .select("id,effective_from")
        .eq("supplier_contract_id", contract.id)
        .is("deleted_at", null)
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RuleSet[];
    },
  });

  const sourceSet = useMemo(() => {
    const date = `${effectiveMonth}-01`;
    return ruleSets.data?.find((item) => item.effective_from <= date);
  }, [effectiveMonth, ruleSets.data]);
  const isInherited = Boolean(sourceSet && sourceSet.effective_from !== `${effectiveMonth}-01`);

  const rules = useQuery({
    queryKey: ["supplier-allocation-rules", sourceSet?.id],
    enabled: Boolean(sourceSet?.id),
    queryFn: async () => {
      const { data, error } = await db
        .from("supplier_allocation_rules")
        .select("customer_contract_id,percentage")
        .eq("rule_set_id", sourceSet!.id)
        .is("deleted_at", null)
        .order("percentage", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Rule[];
    },
  });

  useEffect(() => {
    if (customerContracts.isLoading || ruleSets.isLoading || (sourceSet && rules.isLoading)) return;
    const contractsById = new Map((customerContracts.data ?? []).map((item) => [item.id, item]));
    setRows(
      (rules.data ?? []).flatMap((rule) => {
        const customerContract = contractsById.get(rule.customer_contract_id);
        return customerContract
          ? [{ ...customerContract, percentage: String(rule.percentage) }]
          : [];
      }),
    );
  }, [
    customerContracts.data,
    customerContracts.isLoading,
    ruleSets.isLoading,
    rules.data,
    rules.isLoading,
    sourceSet,
  ]);

  const total = rows.reduce((sum, item) => sum + (Number(item.percentage) || 0), 0);
  const validTotal = Math.abs(total - 100) < 0.000001;
  const availableContracts = (customerContracts.data ?? []).filter(
    (item) => !rows.some((row) => row.id === item.id),
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await db.rpc("save_supplier_allocation_rules", {
        p_supplier_contract_id: contract.id,
        p_effective_from: `${effectiveMonth}-01`,
        p_rules: rows.map((item) => ({
          customer_contract_id: item.id,
          percentage: Number(item.percentage),
        })),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Regra de rateio salva e aplicada aos lançamentos pendentes.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["supplier-allocation-rule-sets", contract.id] }),
        queryClient.invalidateQueries({ queryKey: ["supplier-payables", companyId] }),
        queryClient.invalidateQueries({ queryKey: ["supplier-payable-allocations"] }),
      ]);
      onSaved();
      onClose();
    },
    onError: (error) => toast.error(getUserFacingError(error, "salvar o rateio")),
  });

  const addContract = () => {
    const customerContract = availableContracts.find((item) => item.id === selectedContract);
    if (!customerContract) return;
    setRows((current) => [...current, { ...customerContract, percentage: "" }]);
    setSelectedContract("");
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PieChart className="size-5 text-primary" />
            Rateio do custo fixo
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="rounded-lg border bg-muted/25 p-3">
            <p className="font-medium">{supplierName}</p>
            <p className="text-sm text-muted-foreground">{contract.description}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-[180px_1fr] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="allocation-effective-month">Vigência inicial</Label>
              <Input
                id="allocation-effective-month"
                type="month"
                value={effectiveMonth}
                onChange={(event) => setEffectiveMonth(event.target.value)}
              />
            </div>
            <div className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">Total distribuído</span>
                <Badge variant={validTotal ? "secondary" : "outline"}>
                  {total.toLocaleString("pt-BR", { maximumFractionDigits: 6 })}%
                </Badge>
              </div>
              <Progress className="mt-2" value={Math.min(100, Math.max(0, total))} />
            </div>
          </div>

          {sourceSet ? (
            <p className="text-xs text-muted-foreground">
              {isInherited
                ? `Valores copiados da vigência ${monthLabel(sourceSet.effective_from)}. Ao salvar, uma nova versão será criada.`
                : `Editando a regra da vigência ${monthLabel(sourceSet.effective_from)}. Regras já usadas em lançamentos não podem ser alteradas.`}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={selectedContract} onValueChange={setSelectedContract}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Selecione um contrato de cliente" />
              </SelectTrigger>
              <SelectContent>
                {availableContracts.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.customer} · {item.number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              onClick={addContract}
              disabled={!selectedContract}
            >
              <Plus className="mr-2 size-4" />
              Adicionar
            </Button>
          </div>

          {customerContracts.isError || ruleSets.isError || rules.isError ? (
            <p className="text-sm text-destructive">
              Não foi possível carregar os contratos ou as regras de rateio.
            </p>
          ) : customerContracts.isLoading || ruleSets.isLoading || rules.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando regras
            </div>
          ) : rows.length ? (
            <div className="space-y-2">
              {rows.map((item) => (
                <div
                  key={item.id}
                  className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_140px_40px] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.customer}</p>
                    <p className="text-xs text-muted-foreground">Contrato {item.number}</p>
                  </div>
                  <div className="relative">
                    <Input
                      aria-label={`Percentual de ${item.customer}`}
                      className="pr-8 text-right tabular-nums"
                      type="number"
                      min="0.000001"
                      max="100"
                      step="0.000001"
                      value={item.percentage}
                      onChange={(event) =>
                        setRows((current) =>
                          current.map((row) =>
                            row.id === item.id ? { ...row, percentage: event.target.value } : row,
                          ),
                        )
                      }
                    />
                    <span className="pointer-events-none absolute right-3 top-2 text-sm text-muted-foreground">
                      %
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remover ${item.customer}`}
                    onClick={() =>
                      setRows((current) => current.filter((row) => row.id !== item.id))
                    }
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Adicione os contratos de clientes que receberão este custo.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!rows.length || !validTotal || mutation.isPending}
          >
            {mutation.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Salvar rateio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
