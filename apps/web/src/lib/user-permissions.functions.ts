// Bloco 2 — atribuição de papel + overrides individuais (grant/revoke) por
// usuário. Gate explícito em código antes de qualquer leitura cross-user via
// supabaseAdmin — diferente de roles.functions.ts, aqui não dá pra confiar só
// na RLS pro READ cross-user (ver nota em get_effective_permissions: rows de
// um usuário-alvo só são visíveis pra quem já tem usuarios:view, então usar
// o client RLS-scoped do chamador podia devolver "tudo falso" mesmo quando o
// alvo tem a permissão de verdade — supabaseAdmin evita esse falso-negativo).
//
// Catálogo v2: cada mutação usa a permissão que espelha a RLS real da
// tabela que ela mexe (assignUserRole -> usuarios:edit, igual a RLS de
// user_roles; override/restore -> permissoes:edit, igual a RLS de
// user_permissions; leitura cross-user -> permissoes:view).
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

async function requirePermission(
  supabase: SupabaseClient<Database>,
  userId: string,
  module: string,
  action: string,
) {
  const { data: allowed, error } = await supabase.rpc("has_permission", {
    _user_id: userId,
    _module: module,
    _action: action,
  });
  if (error) throw new Error(error.message);
  if (!allowed) throw new Error("Sem permissão para esta ação.");
}

async function audit(
  tenantId: string,
  actorId: string,
  action: string,
  targetId: string,
  detail?: unknown,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("permission_audit_log").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    target_type: "user",
    target_id: targetId,
    detail: detail == null ? null : (detail as never),
  });
}

export const listTenantUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select("id, name, email, is_active, user_roles(role_id)")
      .order("name");
    if (error) throw new Error(error.message);
    return data;
  });

const targetSchema = z.object({ userId: z.string().uuid() });

export const getUserEffectivePermissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => targetSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requirePermission(context.supabase, context.userId, "permissoes", "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("get_effective_permissions", {
      _user_id: data.userId,
    });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const assignRoleSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
});

export const assignUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => assignRoleSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requirePermission(context.supabase, context.userId, "usuarios", "edit");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", data.userId)
      .maybeSingle();
    if (!target) throw new Error("Usuário não encontrado.");
    const { error } = await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: data.userId, tenant_id: target.tenant_id, role_id: data.roleId },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    await audit(target.tenant_id, context.userId, "user_role.assign", data.userId, {
      role_id: data.roleId,
    });
    return { ok: true as const };
  });

const overrideSchema = z.object({
  userId: z.string().uuid(),
  permissionId: z.string().uuid(),
  granted: z.boolean(),
});

export const setUserOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => overrideSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requirePermission(context.supabase, context.userId, "permissoes", "edit");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", data.userId)
      .maybeSingle();
    if (!target) throw new Error("Usuário não encontrado.");
    const { error } = await supabaseAdmin.from("user_permissions").upsert(
      {
        user_id: data.userId,
        tenant_id: target.tenant_id,
        permission_id: data.permissionId,
        granted: data.granted,
        created_by: context.userId,
      },
      { onConflict: "user_id,permission_id" },
    );
    if (error) throw new Error(error.message);
    await audit(target.tenant_id, context.userId, "user_permission.override", data.userId, {
      permission_id: data.permissionId,
      granted: data.granted,
    });
    return { ok: true as const };
  });

const restoreSchema = z.object({ userId: z.string().uuid(), permissionId: z.string().uuid() });

export const restoreUserDefault = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => restoreSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requirePermission(context.supabase, context.userId, "permissoes", "edit");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", data.userId)
      .maybeSingle();
    if (!target) throw new Error("Usuário não encontrado.");
    const { error } = await supabaseAdmin
      .from("user_permissions")
      .delete()
      .eq("user_id", data.userId)
      .eq("permission_id", data.permissionId);
    if (error) throw new Error(error.message);
    await audit(target.tenant_id, context.userId, "user_permission.restore", data.userId, {
      permission_id: data.permissionId,
    });
    return { ok: true as const };
  });
