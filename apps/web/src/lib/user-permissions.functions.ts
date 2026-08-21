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

async function requireCallerTenant(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("tenant_id, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data?.is_active) throw new Error("Sessão sem perfil ativo.");
  return data.tenant_id;
}

async function requireDelegableRole(
  supabaseAdmin: SupabaseClient<Database>,
  actorId: string,
  tenantId: string,
  roleId: string,
) {
  const { data: role } = await supabaseAdmin
    .from("roles")
    .select("id")
    .eq("id", roleId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!role) throw new Error("Papel não encontrado nesta organização.");

  const [{ data: actorRows, error: actorError }, { data: roleRows, error: roleError }] =
    await Promise.all([
      supabaseAdmin.rpc("get_effective_permissions", { _user_id: actorId }),
      supabaseAdmin.from("role_permissions").select("permission_id").eq("role_id", roleId),
    ]);
  if (actorError) throw new Error(actorError.message);
  if (roleError) throw new Error(roleError.message);

  const permissionIds = (roleRows ?? []).map((row) => row.permission_id);
  if (permissionIds.length === 0) return;
  const { data: permissions, error: permissionsError } = await supabaseAdmin
    .from("permissions")
    .select("id, module, action")
    .in("id", permissionIds);
  if (permissionsError) throw new Error(permissionsError.message);

  const actorPermissions = new Set(
    (actorRows ?? []).filter((row) => row.effective).map((row) => `${row.module}:${row.action}`),
  );
  if ((permissions ?? []).some((p) => !actorPermissions.has(`${p.module}:${p.action}`))) {
    throw new Error("Não é permitido delegar acesso superior ao seu.");
  }
}

async function requireTargetPermission(
  supabase: SupabaseClient<Database>,
  supabaseAdmin: SupabaseClient<Database>,
  actorId: string,
  permissionId: string,
) {
  const { data: permission } = await supabaseAdmin
    .from("permissions")
    .select("module, action")
    .eq("id", permissionId)
    .maybeSingle();
  if (!permission) throw new Error("Permissão não encontrada.");
  await requirePermission(supabase, actorId, permission.module, permission.action);
}

async function audit(
  tenantId: string,
  actorId: string,
  action: string,
  targetId: string,
  detail?: unknown,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("permission_audit_log").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    target_type: "user",
    target_id: targetId,
    detail: detail == null ? null : (detail as never),
  });
  if (error) throw new Error(error.message);
}

export const listTenantUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("id, name, email, is_active, user_roles!user_roles_user_id_fkey(role_id)")
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
    const tenantId = await requireCallerTenant(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", data.userId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!target) throw new Error("Usuário não encontrado nesta organização.");
    const { data: rows, error } = await supabaseAdmin.rpc("get_effective_permissions", {
      _user_id: data.userId,
    });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const assignRoleSchema = z.object({ userId: z.string().uuid(), roleId: z.string().uuid() });

export const assignUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => assignRoleSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requirePermission(context.supabase, context.userId, "usuarios", "edit");
    if (data.userId === context.userId) throw new Error("Você não pode alterar o próprio papel.");
    const tenantId = await requireCallerTenant(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", data.userId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!target) throw new Error("Usuário não encontrado nesta organização.");
    await requireDelegableRole(supabaseAdmin, context.userId, tenantId, data.roleId);
    const { error } = await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: data.userId, tenant_id: tenantId, role_id: data.roleId },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    await audit(tenantId, context.userId, "user_role.assign", data.userId, {
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
    if (data.userId === context.userId)
      throw new Error("Você não pode alterar as próprias permissões.");
    const tenantId = await requireCallerTenant(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", data.userId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!target) throw new Error("Usuário não encontrado nesta organização.");
    await requireTargetPermission(
      context.supabase,
      supabaseAdmin,
      context.userId,
      data.permissionId,
    );
    const { error } = await supabaseAdmin.from("user_permissions").upsert(
      {
        user_id: data.userId,
        tenant_id: tenantId,
        permission_id: data.permissionId,
        granted: data.granted,
        created_by: context.userId,
      },
      { onConflict: "user_id,permission_id" },
    );
    if (error) throw new Error(error.message);
    await audit(tenantId, context.userId, "user_permission.override", data.userId, {
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
    if (data.userId === context.userId)
      throw new Error("Você não pode alterar as próprias permissões.");
    const tenantId = await requireCallerTenant(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", data.userId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!target) throw new Error("Usuário não encontrado nesta organização.");
    await requireTargetPermission(
      context.supabase,
      supabaseAdmin,
      context.userId,
      data.permissionId,
    );
    const { error } = await supabaseAdmin
      .from("user_permissions")
      .delete()
      .eq("user_id", data.userId)
      .eq("tenant_id", tenantId)
      .eq("permission_id", data.permissionId);
    if (error) throw new Error(error.message);
    await audit(tenantId, context.userId, "user_permission.restore", data.userId, {
      permission_id: data.permissionId,
    });
    return { ok: true as const };
  });

const setUserActiveSchema = z.object({ userId: z.string().uuid(), isActive: z.boolean() });

export const setUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => setUserActiveSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requirePermission(context.supabase, context.userId, "usuarios", "edit");
    if (data.userId === context.userId)
      throw new Error("Você não pode alterar o status da própria conta.");
    const tenantId = await requireCallerTenant(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", data.userId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!target) throw new Error("Usuário não encontrado nesta organização.");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ is_active: data.isActive })
      .eq("id", data.userId)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    await audit(tenantId, context.userId, "user.active.set", data.userId, {
      is_active: data.isActive,
    });
    return { ok: true as const };
  });
