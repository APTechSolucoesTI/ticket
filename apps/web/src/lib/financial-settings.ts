import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

const schema = z.object({
  use_payable_approvals: z.boolean(),
  use_collection_rules: z.boolean(),
});

export type FinancialSettings = z.infer<typeof schema>;
const db = supabase as unknown as SupabaseClient;

export function useFinancialSettings() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["financial-settings", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await db.rpc("get_financial_settings");
      if (error) throw error;
      return schema.parse(data);
    },
    refetchOnWindowFocus: true,
  });
}

export async function saveFinancialSettings(settings: FinancialSettings) {
  const value = schema.parse(settings);
  const { error } = await db.rpc("save_financial_settings", {
    p_use_payable_approvals: value.use_payable_approvals,
    p_use_collection_rules: value.use_collection_rules,
  });
  if (error) throw error;
}
