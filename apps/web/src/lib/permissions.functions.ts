// Bloco 2 - resolução de permissões efetivas do usuário logado, pro
// frontend decidir o que mostrar/esconder. Usa a mesma função SQL
// (apticket.get_effective_permissions) que apps/api usa no guard - única
// fonte de verdade (ver migration 20260821000000_dynamic_roles_permissions).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface EffectivePermission {
  module: string;
  action: string;
}

export const getMyPermissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EffectivePermission[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase.rpc("get_effective_permissions", {
      _user_id: userId,
    });
    if (error) throw new Error(error.message);
    return (data ?? [])
      .filter((p) => p.effective)
      .map((p) => ({ module: p.module, action: p.action }));
  });
