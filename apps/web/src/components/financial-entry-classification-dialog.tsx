import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  };
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [categoryId, setCategoryId] = useState(entry.financial_category_id ?? "");
  const [centerId, setCenterId] = useState(entry.cost_center_id ?? "");
  const [notes, setNotes] = useState("");
  const dimensions = useQuery({
    queryKey: ["financial-dimensions", entry.operating_company_id],
    queryFn: async () => {
      const [categories, centers] = await Promise.all([
        db
          .from("financial_categories")
          .select("id,code,name,direction,description")
          .eq("operating_company_id", entry.operating_company_id)
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("code"),
        db
          .from("financial_cost_centers")
          .select("id,code,name,description")
          .eq("operating_company_id", entry.operating_company_id)
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
  useEffect(() => {
    if (!categoryId && dimensions.data?.categories.length)
      setCategoryId(
        dimensions.data.categories.find(
          (item) => item.direction === entry.direction || item.direction === "both",
        )?.id ?? "",
      );
    if (!centerId && dimensions.data?.centers[0]) setCenterId(dimensions.data.centers[0].id);
  }, [categoryId, centerId, dimensions.data, entry.direction]);
  const save = useMutation({
    mutationFn: async () => {
      if (!categoryId || !centerId) throw new Error("Selecione a categoria e o centro de custo.");
      const { error } = await db.rpc("classify_financial_entry", {
        p_source_type: entry.source_type,
        p_source_id: entry.source_id,
        p_category_id: categoryId,
        p_cost_center_id: centerId,
        p_notes: notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Movimento classificado.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cash-flow"] }),
        queryClient.invalidateQueries({ queryKey: ["financial-budget"] }),
        queryClient.invalidateQueries({ queryKey: ["financial-statement"] }),
      ]);
      onSaved();
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cash-flow"] }),
        queryClient.invalidateQueries({ queryKey: ["financial-budget"] }),
        queryClient.invalidateQueries({ queryKey: ["financial-statement"] }),
      ]);
      onSaved();
    },
    onError: (error) => toast.error(getUserFacingError(error, "remover a classificação")),
  });
  const compatible =
    dimensions.data?.categories.filter(
      (item) => item.direction === entry.direction || item.direction === "both",
    ) ?? [];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tags className="size-5" />
            Classificar movimento
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {entry.document_number} · {entry.counterparty_name}
          </p>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Categoria financeira</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
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
            {!compatible.length ? (
              <p className="mt-1 text-xs text-destructive">
                Cadastre uma categoria compatível com este movimento.
              </p>
            ) : null}
          </div>
          <div>
            <Label>Centro de custo</Label>
            <Select value={centerId} onValueChange={setCenterId}>
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
            {!dimensions.data?.centers.length ? (
              <p className="mt-1 text-xs text-destructive">
                Cadastre um centro de custo para esta empresa.
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="classification-notes">Observações da classificação</Label>
            <Textarea
              id="classification-notes"
              maxLength={1000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          <div>
            {entry.financial_category_id ? (
              <Button
                variant="destructive"
                onClick={() => clear.mutate()}
                disabled={clear.isPending}
              >
                {clear.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Remover
                classificação
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || !categoryId || !centerId}
            >
              {save.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}Salvar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
