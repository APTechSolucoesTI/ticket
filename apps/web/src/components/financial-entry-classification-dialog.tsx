import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Loader2, Tags } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ContractAllocationEditor } from "@/components/contract-allocation-editor";
import { supabase } from "@/integrations/supabase/client";
import { getUserFacingError } from "@/lib/user-facing-error";
import {
  allocationError,
  allocationPayload,
  legacyAllocation,
  type ContractAllocation,
} from "@/lib/contract-allocations";

const db = supabase as unknown as SupabaseClient;

export function FinancialEntryClassificationDialog({
  entry,
  onClose,
  onSaved,
}: {
  entry: {
    source_type: string;
    source_id: string;
    direction: "inflow" | "outflow";
    document_number: string;
    counterparty_name: string;
    operating_company_id: string;
    financial_category_id: string | null;
    cost_center_id: string | null;
    category_allocations?: ContractAllocation[] | null;
    cost_center_allocations?: ContractAllocation[] | null;
  };
  onClose(): void;
  onSaved(): void;
}) {
  const queryClient = useQueryClient();
  const [categories, setCategories] = useState(() =>
    legacyAllocation(entry.category_allocations, entry.financial_category_id),
  );
  const [centers, setCenters] = useState(() =>
    legacyAllocation(entry.cost_center_allocations, entry.cost_center_id),
  );
  const [categoriesValid, setCategoriesValid] = useState(false);
  const [centersValid, setCentersValid] = useState(false);
  const [notes, setNotes] = useState("");
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["cash-flow"] }),
      queryClient.invalidateQueries({ queryKey: ["financial-budget"] }),
      queryClient.invalidateQueries({ queryKey: ["financial-statement"] }),
      queryClient.invalidateQueries({ queryKey: ["measurement-receivables"] }),
      queryClient.invalidateQueries({ queryKey: ["supplier-payables"] }),
      queryClient.invalidateQueries({ queryKey: ["bank-statement-transactions"] }),
    ]);
    onSaved();
  };
  const save = useMutation({
    mutationFn: async () => {
      const issue =
        allocationError(categories, "categorias financeiras") ??
        allocationError(centers, "centros de custo");
      if (issue || !categoriesValid || !centersValid)
        throw new Error(issue ?? "Revise as opções dos rateios financeiros.");
      const { error } = await db.rpc("classify_financial_entry_allocated", {
        p_source_type: entry.source_type,
        p_source_id: entry.source_id,
        p_category_allocations: allocationPayload(categories),
        p_cost_center_allocations: allocationPayload(centers),
        p_notes: notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Rateios do movimento salvos.");
      await refresh();
    },
    onError: (error) => toast.error(getUserFacingError(error, "classificar o movimento")),
  });
  const clear = useMutation({
    mutationFn: async () => {
      const { error } = await db.rpc("clear_financial_entry_classification", {
        p_source_type: entry.source_type,
        p_source_id: entry.source_id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Classificação removida.");
      await refresh();
    },
    onError: (error) => toast.error(getUserFacingError(error, "remover a classificação")),
  });
  const busy = save.isPending || clear.isPending;
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tags className="size-5" />
            Classificar movimento
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {entry.document_number} · {entry.counterparty_name}
          </p>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Distribua categorias financeiras e centros de custo separadamente, com 100% em cada grupo.
          A alteração afeta somente este lançamento e mantém o histórico anterior.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <ContractAllocationEditor
            companyId={entry.operating_company_id}
            direction={entry.direction}
            dimension="category"
            value={categories}
            onChange={setCategories}
            onValidityChange={setCategoriesValid}
            disabled={busy}
          />
          <ContractAllocationEditor
            companyId={entry.operating_company_id}
            direction={entry.direction}
            dimension="cost_center"
            value={centers}
            onChange={setCenters}
            onValidityChange={setCentersValid}
            disabled={busy}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="classification-notes">Observações da classificação</Label>
          <Textarea
            id="classification-notes"
            maxLength={1000}
            value={notes}
            disabled={busy}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {entry.financial_category_id || entry.category_allocations?.length ? (
              <Button variant="destructive" onClick={() => clear.mutate()} disabled={busy}>
                {clear.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Remover
                classificação
              </Button>
            ) : null}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              Cancelar
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={busy || !categoriesValid || !centersValid}
            >
              {save.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Salvar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
