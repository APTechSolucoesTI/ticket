import { useEffect, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
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
  allocationError,
  allocationTotal,
  formatPercentage,
  type ContractAllocation,
} from "@/lib/contract-allocations";

const db = supabase as unknown as SupabaseClient;
type Option = { id: string; code: string; name: string };

export function ContractAllocationEditor({
  companyId,
  direction,
  dimension,
  value,
  onChange,
  onValidityChange,
  disabled = false,
  permissionModule = "contratos",
}: {
  companyId: string;
  direction: "inflow" | "outflow";
  dimension: "category" | "cost_center";
  value: ContractAllocation[];
  onChange(value: ContractAllocation[]): void;
  onValidityChange(valid: boolean): void;
  disabled?: boolean;
  permissionModule?: "contratos" | "contratos_fornecedores";
}) {
  const id = useId();
  const label = dimension === "category" ? "Categorias financeiras" : "Centros de custo";
  const query = useQuery({
    queryKey: ["contract-allocation-options", companyId, direction, dimension, permissionModule],
    enabled: Boolean(companyId),
    queryFn: async () => {
      if (permissionModule === "contratos_fornecedores") {
        const { data, error } = await db.rpc("get_supplier_contract_options", {
          _company_id: companyId,
        });
        if (error) throw error;
        return (data?.[dimension === "category" ? "categories" : "cost_centers"] ?? []) as Option[];
      }
      let request = db
        .from(dimension === "category" ? "financial_categories" : "financial_cost_centers")
        .select("id,code,name")
        .or(`operating_company_id.eq.${companyId},is_global.eq.true`)
        .eq("is_active", true)
        .eq("classification_type", "analytic")
        .is("deleted_at", null)
        .order("code");
      if (dimension === "category") request = request.in("direction", [direction, "both"]);
      const { data, error } = await request;
      if (error) throw error;
      return (data ?? []) as Option[];
    },
  });
  const total = allocationTotal(value);
  const error = allocationError(value, label.toLocaleLowerCase("pt-BR"));
  const hasInactive = Boolean(
    query.data &&
    value.some((item) => item.item_id && !query.data.some((option) => option.id === item.item_id)),
  );
  const valid = Boolean(companyId && query.isSuccess && !error && !hasInactive);
  useEffect(() => onValidityChange(valid), [valid, onValidityChange]);
  const blocked = disabled || !companyId || query.isPending || query.isError;
  const update = (index: number, item: Partial<ContractAllocation>) =>
    onChange(value.map((row, position) => (position === index ? { ...row, ...item } : row)));
  return (
    <fieldset
      className="min-w-0 space-y-3 rounded-lg border bg-muted/20 p-3"
      aria-describedby={`${id}-feedback`}
    >
      <legend className="px-1 text-xs font-semibold">{label} *</legend>
      {value.map((item, index) => {
        const inactive =
          item.item_id && query.data && !query.data.some((option) => option.id === item.item_id);
        return (
          <div
            key={index}
            className="grid min-w-0 grid-cols-[minmax(0,1fr)_5.5rem_2rem] items-end gap-2"
          >
            <div className="min-w-0 space-y-1">
              <Label htmlFor={`${id}-item-${index}`}>
                {dimension === "category" ? "Categoria" : "Centro de custo"} {index + 1}
              </Label>
              <Select
                value={item.item_id || "__empty__"}
                disabled={blocked}
                onValueChange={(itemId) => {
                  const option = query.data?.find((row) => row.id === itemId);
                  update(index, { item_id: itemId, code: option?.code, name: option?.name });
                }}
              >
                <SelectTrigger
                  id={`${id}-item-${index}`}
                  className="w-full min-w-0 [&>span]:truncate"
                >
                  <SelectValue placeholder="Selecione…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__empty__" disabled>
                    Selecione…
                  </SelectItem>
                  {inactive ? (
                    <SelectItem value={item.item_id} disabled>
                      {item.name ?? "Item indisponível"} · inativo
                    </SelectItem>
                  ) : null}
                  {(query.data ?? []).map((option) => (
                    <SelectItem
                      key={option.id}
                      value={option.id}
                      disabled={value.some(
                        (row, position) => position !== index && row.item_id === option.id,
                      )}
                    >
                      {option.code} · {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-percentage-${index}`}>Percentual %</Label>
              <Input
                id={`${id}-percentage-${index}`}
                aria-label={`${label} · percentual ${index + 1}`}
                inputMode="decimal"
                value={item.percentage}
                disabled={disabled}
                onChange={(event) => update(index, { percentage: event.target.value })}
              />
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label={`Remover ${label.toLocaleLowerCase("pt-BR")} ${index + 1}`}
              disabled={disabled || value.length <= 1}
              onClick={() => onChange(value.filter((_, position) => position !== index))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={blocked || !query.data?.length || value.length >= query.data.length}
          onClick={() =>
            onChange([
              ...value,
              {
                item_id: "",
                percentage: String(value.length ? Math.max(0, 10000 - total) / 100 : 100),
              },
            ])
          }
        >
          <Plus className="mr-1 size-3.5" />
          Adicionar {dimension === "category" ? "categoria" : "centro de custo"}
        </Button>
        <span
          className={`text-xs font-medium ${valid ? "text-emerald-600" : "text-destructive"}`}
          aria-live="polite"
        >
          Total: {formatPercentage(total / 100)}%
          {total < 10000
            ? ` · faltam ${formatPercentage((10000 - total) / 100)}%`
            : total > 10000
              ? ` · excede ${formatPercentage((total - 10000) / 100)}%`
              : ""}
        </span>
      </div>
      <div id={`${id}-feedback`} className="text-xs" aria-live="polite">
        {query.isFetching && companyId ? (
          <p className="flex items-center gap-1 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Carregando opções…
          </p>
        ) : query.isError ? (
          <p className="text-destructive">
            Não foi possível carregar as opções.{" "}
            <Button type="button" size="sm" variant="link" onClick={() => query.refetch()}>
              Tentar novamente
            </Button>
          </p>
        ) : !companyId ? (
          <p className="text-muted-foreground">
            Selecione a empresa operadora para preencher o rateio.
          </p>
        ) : hasInactive ? (
          <p className="text-destructive">
            Um item vinculado está inativo ou indisponível. Substitua-o antes de salvar.
          </p>
        ) : !query.data?.length ? (
          <p className="text-destructive">
            Cadastre uma classificação analítica ativa para esta empresa.
          </p>
        ) : error ? (
          <p className="text-destructive">{error}</p>
        ) : (
          <p className="text-muted-foreground">
            Rateio completo. Os valores serão distribuídos sem perda de centavos.
          </p>
        )}
      </div>
    </fieldset>
  );
}
