import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as unknown as SupabaseClient;
const NONE = "__none__";

type Direction = "inflow" | "outflow";
type Dimension = { id: string; code: string; name: string };
type Category = Dimension & { direction: Direction | "both" };

export function FinancialDimensionFields({
  companyId,
  direction,
  categoryId,
  costCenterId,
  onCategoryChange,
  onCostCenterChange,
  disabled = false,
  optional = true,
  className = "grid gap-3 sm:grid-cols-2",
}: {
  companyId: string;
  direction: Direction;
  categoryId: string;
  costCenterId: string;
  onCategoryChange(value: string): void;
  onCostCenterChange(value: string): void;
  disabled?: boolean;
  optional?: boolean;
  className?: string;
}) {
  const query = useQuery({
    queryKey: ["financial-dimension-options", companyId, direction],
    enabled: Boolean(companyId),
    queryFn: async () => {
      const [categories, centers] = await Promise.all([
        db
          .from("financial_categories")
          .select("id,code,name,direction")
          .eq("operating_company_id", companyId)
          .eq("is_active", true)
          .is("deleted_at", null)
          .in("direction", [direction, "both"])
          .order("code"),
        db
          .from("financial_cost_centers")
          .select("id,code,name")
          .eq("operating_company_id", companyId)
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("code"),
      ]);
      if (categories.error) throw categories.error;
      if (centers.error) throw centers.error;
      return {
        categories: (categories.data ?? []) as Category[],
        centers: (centers.data ?? []) as Dimension[],
      };
    },
  });

  const unavailable = disabled || !companyId || query.isLoading || query.isError;
  return (
    <div className={className}>
      <div className="space-y-1">
        <Label>Categoria financeira{optional ? "" : " *"}</Label>
        <Select
          value={categoryId || NONE}
          disabled={unavailable}
          onValueChange={(value) => onCategoryChange(value === NONE ? "" : value)}
        >
          <SelectTrigger aria-label="Categoria financeira">
            <SelectValue placeholder="Selecione a categoria" />
          </SelectTrigger>
          <SelectContent>
            {optional ? <SelectItem value={NONE}>Não informada</SelectItem> : null}
            {(query.data?.categories ?? []).map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.code} · {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Centro de custo{optional ? "" : " *"}</Label>
        <Select
          value={costCenterId || NONE}
          disabled={unavailable}
          onValueChange={(value) => onCostCenterChange(value === NONE ? "" : value)}
        >
          <SelectTrigger aria-label="Centro de custo">
            <SelectValue placeholder="Selecione o centro de custo" />
          </SelectTrigger>
          <SelectContent>
            {optional ? <SelectItem value={NONE}>Não informado</SelectItem> : null}
            {(query.data?.centers ?? []).map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.code} · {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {query.isLoading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
          <Loader2 className="size-3 animate-spin" /> Carregando classificação financeira…
        </p>
      ) : query.isError ? (
        <p className="text-xs text-destructive sm:col-span-2">
          Não foi possível carregar as categorias e centros de custo desta empresa.
        </p>
      ) : null}
    </div>
  );
}
