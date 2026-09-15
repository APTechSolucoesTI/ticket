import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as unknown as SupabaseClient;

export type FinancialDocumentType = {
  id: string;
  code: string;
  name: string;
  availability: "receivable" | "payable" | "both";
  is_active: boolean;
};

export function useFinancialDocumentTypes(enabled = true) {
  return useQuery({
    queryKey: ["financial-document-types"],
    enabled,
    queryFn: async () => {
      const { data, error } = await db
        .from("financial_document_types")
        .select("id,code,name,availability,is_active")
        .is("deleted_at", null)
        .order("code");
      if (error) throw error;
      return (data ?? []) as FinancialDocumentType[];
    },
  });
}
