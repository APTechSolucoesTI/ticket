import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CycleItem = {
  id: string;
  kind: "fixed" | "variable";
  description: string;
  period_start: string;
  period_end: string;
  quantity: number;
  unit_price: number;
  divisor: number;
  amount: number;
  value_version_id: string;
  consumption_snapshot_id: string | null;
};
export type CycleDetails = {
  id: string;
  contract_id: string;
  operating_company_id: string;
  cycle_start: string;
  cycle_end: string;
  service_start: string;
  service_end: string;
  total_amount: number;
  due_date: string;
  created_at: string;
  items: CycleItem[];
};

export const getBillingCycle = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<CycleDetails> => {
    // User-scoped client: company-level RLS applies even to an administrator.
    const db = context.supabase as unknown as SupabaseClient;
    const { data: cycle, error } = await db
      .from("billing_cycles")
      .select(
        "id,contract_id,operating_company_id,cycle_start,cycle_end,service_start,service_end,total_amount,due_date,created_at",
      )
      .eq("id", data.id)
      .eq("tenant_id", context.claims.tenantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error("Não foi possível consultar a fatura recorrente. Tente novamente.");
    if (!cycle) throw new Error("Fatura não disponível ou sem permissão para esta empresa.");
    const items: CycleItem[] = [];
    // Explicit pagination prevents silently truncating financial details at the API row limit.
    for (let offset = 0; ; offset += 500) {
      const { data: page, error: itemError } = await db
        .from("billing_cycle_items")
        .select(
          "id,kind,description,period_start,period_end,quantity,unit_price,divisor,amount,value_version_id,consumption_snapshot_id",
        )
        .eq("billing_cycle_id", data.id)
        .eq("tenant_id", context.claims.tenantId)
        .is("deleted_at", null)
        .order("period_start")
        .order("kind")
        .order("id")
        .range(offset, offset + 499);
      if (itemError)
        throw new Error("Não foi possível carregar os itens. Nenhum total foi recalculado.");
      items.push(...(page as CycleItem[]));
      if (page.length < 500) break;
      if (items.length >= 10000)
        throw new Error(
          "Fatura muito extensa para esta consulta. Solicite suporte para obter o detalhamento completo.",
        );
    }
    return { ...cycle, items } as CycleDetails;
  });
