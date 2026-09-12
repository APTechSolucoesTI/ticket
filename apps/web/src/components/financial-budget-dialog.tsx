import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Loader2, Target } from "lucide-react";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { getUserFacingError } from "@/lib/user-facing-error";
import type {
  FinancialCategory,
  FinancialCostCenter,
} from "@/components/financial-dimensions-dialog";

const db = supabase as unknown as SupabaseClient;

export type FinancialBudgetEntry = {
  budget_entry_id: string | null;
  period_month: string;
  direction: "inflow" | "outflow";
  financial_category_id: string | null;
  financial_category_code: string | null;
  financial_category_name: string | null;
  cost_center_id: string | null;
  cost_center_code: string | null;
  cost_center_name: string | null;
  budgeted_amount: number;
};

export function FinancialBudgetDialog({
  companyId,
  year,
  entry,
  onClose,
}: {
  companyId: string;
  year: number;
  entry?: FinancialBudgetEntry;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(entry?.period_month.slice(0, 7) ?? `${year}-01`);
  const [direction, setDirection] = useState<FinancialBudgetEntry["direction"]>(
    entry?.direction ?? "outflow",
  );
  const [categoryId, setCategoryId] = useState(entry?.financial_category_id ?? "");
  const [centerId, setCenterId] = useState(entry?.cost_center_id ?? "");
  const [amount, setAmount] = useState(entry?.budgeted_amount ? String(entry.budgeted_amount) : "");
  const [notes, setNotes] = useState("");
  const dimensions = useQuery({
    queryKey: ["financial-dimensions", companyId],
    queryFn: async () => {
      const [categories, centers] = await Promise.all([
        db
          .from("financial_categories")
          .select("id,code,name,direction,description")
          .eq("operating_company_id", companyId)
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("code"),
        db
          .from("financial_cost_centers")
          .select("id,code,name,description")
          .eq("operating_company_id", companyId)
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("code"),
      ]);
      if (categories.error) throw categories.error;
      if (centers.error) throw centers.error;
      return {
        categories: (categories.data ?? []) as FinancialCategory[],
        centers: (centers.data ?? []) as FinancialCostCenter[],
      };
    },
  });
  const compatible = useMemo(
    () =>
      dimensions.data?.categories.filter(
        (item) => item.direction === direction || item.direction === "both",
      ) ?? [],
    [dimensions.data?.categories, direction],
  );
  const selectedDimensionsActive =
    compatible.some((item) => item.id === categoryId) &&
    Boolean(dimensions.data?.centers.some((item) => item.id === centerId));

  useEffect(() => {
    if (!entry && !compatible.some((item) => item.id === categoryId)) {
      setCategoryId(compatible[0]?.id ?? "");
    }
    if (!entry && !centerId && dimensions.data?.centers[0]) {
      setCenterId(dimensions.data.centers[0].id);
    }
  }, [categoryId, centerId, compatible, dimensions.data?.centers, entry]);

  const save = useMutation({
    mutationFn: async () => {
      const numericAmount = Number(amount.replace(",", "."));
      if (!period || !categoryId || !centerId || !Number.isFinite(numericAmount)) {
        throw new Error("Preencha competência, categoria, centro de custo e valor.");
      }
      const { error } = await db.rpc("save_financial_budget_entry", {
        p_operating_company_id: companyId,
        p_period_month: `${period}-01`,
        p_direction: direction,
        p_category_id: categoryId,
        p_cost_center_id: centerId,
        p_budgeted_amount: numericAmount,
        p_notes: notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success(entry ? "Orçamento revisado." : "Item incluído no orçamento.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["financial-budget"] }),
        queryClient.invalidateQueries({ queryKey: ["financial-statement"] }),
      ]);
      onClose();
    },
    onError: (error) => toast.error(getUserFacingError(error, "salvar o orçamento")),
  });
  const remove = useMutation({
    mutationFn: async () => {
      if (!entry?.budget_entry_id) return;
      const { error } = await db.rpc("clear_financial_budget_entry", {
        p_id: entry.budget_entry_id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Item removido do orçamento vigente.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["financial-budget"] }),
        queryClient.invalidateQueries({ queryKey: ["financial-statement"] }),
      ]);
      onClose();
    },
    onError: (error) => toast.error(getUserFacingError(error, "remover o item do orçamento")),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="size-5" />
            {entry ? "Revisar item do orçamento" : "Novo item do orçamento"}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Planejamento mensal por categoria e centro de custo.
          </p>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="budget-period">Competência</Label>
            <Input
              id="budget-period"
              type="month"
              min="2000-01"
              max="2100-12"
              value={period}
              disabled={Boolean(entry)}
              onChange={(event) => setPeriod(event.target.value)}
            />
          </div>
          <div>
            <Label>Natureza</Label>
            <Select
              value={direction}
              disabled={Boolean(entry)}
              onValueChange={(value) => setDirection(value as typeof direction)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inflow">Entrada</SelectItem>
                <SelectItem value="outflow">Saída</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>Categoria financeira</Label>
            <Select value={categoryId} disabled={Boolean(entry)} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a categoria" />
              </SelectTrigger>
              <SelectContent>
                {compatible.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.code} · {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>Centro de custo</Label>
            <Select value={centerId} disabled={Boolean(entry)} onValueChange={setCenterId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o centro de custo" />
              </SelectTrigger>
              <SelectContent>
                {dimensions.data?.centers.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.code} · {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="budget-amount">Valor orçado</Label>
            <Input
              id="budget-amount"
              type="number"
              min="0.01"
              max="999999999999.99"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="budget-notes">Observações</Label>
            <Textarea
              id="budget-notes"
              maxLength={1000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
          {entry && dimensions.isSuccess && !selectedDimensionsActive ? (
            <p className="text-sm text-destructive sm:col-span-2">
              A categoria ou o centro de custo deste item foi arquivado. Remova o item ou cadastre
              um novo orçamento com dimensões ativas.
            </p>
          ) : null}
        </div>
        <DialogFooter className="sm:justify-between">
          <div>
            {entry?.budget_entry_id ? (
              <Button
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                {remove.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Remover
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              disabled={
                save.isPending || dimensions.isLoading || !selectedDimensionsActive || !amount
              }
              onClick={() => save.mutate()}
            >
              {save.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Salvar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
