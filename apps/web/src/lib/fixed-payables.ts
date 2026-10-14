import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { ContractAllocation } from "@/lib/contract-allocations";

export const fixedDb = supabase as unknown as SupabaseClient;
export type FixedPayableFields = {
  id: string;
  operating_company_id: string;
  supplier_id: string;
  supplier_name: string;
  document_type_id: string;
  description: string;
  total_amount: number;
  notes: string | null;
  category_allocations: ContractAllocation[];
  cost_center_allocations: ContractAllocation[];
  revision: number;
};
export type FixedPayable = FixedPayableFields & {
  start_month: string;
  end_month: string | null;
  due_day: number;
  is_active: boolean;
  deleted_at: string | null;
};
export type FixedOccurrence = FixedPayableFields & {
  fixed_payable_id: string;
  competence: string;
  due_date: string;
  status: "forecast" | "confirmed";
  confirmed_payable_id: string | null;
};
export const fixedMoney = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const fixedDate = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
export const fixedMonth = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  );
// A janela de vários modelos pode ultrapassar o limite padrão do PostgREST.
// Pagina com ordenação estável para manter listagens e totalizadores completos.
export async function loadFixedRows<T>(
  table: "fixed_payables" | "fixed_payable_occurrences",
  companyId: string,
  order: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await fixedDb
      .from(table)
      .select("*")
      .eq("operating_company_id", companyId)
      .is("deleted_at", null)
      .order(order)
      .order("id")
      .range(offset, offset + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return rows;
  }
}
export function useFixedOccurrences(companyId: string) {
  return useQuery({
    queryKey: ["fixed-payable-occurrences", companyId],
    enabled: Boolean(companyId),
    queryFn: () =>
      loadFixedRows<FixedOccurrence>("fixed_payable_occurrences", companyId, "competence"),
  });
}
export async function refreshFixedPayables(client: QueryClient) {
  await Promise.all(
    [
      "fixed-payables",
      "fixed-payable-occurrences",
      "supplier-payables",
      "cash-flow",
      "financial-budget",
      "financial-statement",
      "bank-statement-transactions",
    ].map((key) => client.invalidateQueries({ queryKey: [key] })),
  );
}
