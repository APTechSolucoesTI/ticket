// Bloco 2 - CRUD de papéis + matriz de permissões por papel. Toda mutação
// passa pelo client RLS-scoped do usuário (`context.supabase`, via
// requireSupabaseAuth) - a própria migration 20260821000000 já gate
// insert/update/delete em apticket.roles/role_permissions por
// has_permission(auth.uid(),'papeis','create'/'edit'/'delete'), então o Postgres barra quem
// não tem a permissão mesmo que este código tivesse um bug. O log de
// auditoria usa supabaseAdmin (service_role) porque permission_audit_log não
// tem policy pra authenticated (só server-side escreve lá, mesmo padrão de
// apticket.invites).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function audit(
  tenantId: string,
  actorId: string,
  action: string,
  targetType: "role" | "user",
  targetId: string,
  detail?: unknown,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("permission_audit_log").insert({
    tenant_id: tenantId,
    actor_id: actorId,
    action,
    target_type: targetType,
    target_id: targetId,
    detail: detail == null ? null : (detail as never),
  });
}

export const listRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("roles")
      .select("id, name, description, is_system, created_at")
      .order("is_system", { ascending: false })
      .order("name");
    if (error) throw new Error(error.message);
    return data;
  });

export const listPermissionsCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("permissions")
      .select("id, module, action, description")
      .order("module")
      .order("action");
    if (error) throw new Error(error.message);
    return data;
  });

export const getRolePermissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ roleId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("role_permissions")
      .select("permission_id")
      .eq("role_id", data.roleId);
    if (error) throw new Error(error.message);
    return rows.map((r) => r.permission_id);
  });

const createRoleSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(80),
  description: z.string().trim().max(300).optional(),
});

export const createRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createRoleSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: me } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (!me?.tenant_id) throw new Error("Organização não encontrada.");
    const { data: role, error } = await supabase
      .from("roles")
      .insert({ tenant_id: me.tenant_id, name: data.name, description: data.description ?? null })
      .select("id, name, description, is_system, created_at")
      .single();
    if (error) throw new Error(error.message);
    await audit(me.tenant_id, userId, "role.create", "role", role.id, { name: data.name });
    return role;
  });

const updateRoleSchema = z.object({
  roleId: z.string().uuid(),
  name: z.string().trim().min(1, "Informe o nome").max(80),
  description: z.string().trim().max(300).optional(),
});

export const updateRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateRoleSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("roles")
      .update({
        name: data.name,
        description: data.description ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.roleId);
    if (error) throw new Error(error.message);
    const { data: me } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (me?.tenant_id)
      await audit(me.tenant_id, userId, "role.update", "role", data.roleId, { name: data.name });
    return { ok: true as const };
  });

const deleteRoleSchema = z.object({ roleId: z.string().uuid() });

export const deleteRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => deleteRoleSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { count } = await supabase
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role_id", data.roleId);
    if (count && count > 0) {
      throw new Error("Este papel está em uso - reatribua os usuários antes de excluir.");
    }
    const { error } = await supabase.from("roles").delete().eq("id", data.roleId);
    if (error) throw new Error(error.message); // trigger barra papel de sistema aqui também
    const { data: me } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (me?.tenant_id) await audit(me.tenant_id, userId, "role.delete", "role", data.roleId);
    return { ok: true as const };
  });

const setRolePermissionsSchema = z.object({
  roleId: z.string().uuid(),
  permissionIds: z.array(z.string().uuid()),
});

export const setRolePermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => setRolePermissionsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error: delErr } = await supabase
      .from("role_permissions")
      .delete()
      .eq("role_id", data.roleId);
    if (delErr) throw new Error(delErr.message);
    if (data.permissionIds.length > 0) {
      const { error: insErr } = await supabase
        .from("role_permissions")
        .insert(
          data.permissionIds.map((permission_id) => ({ role_id: data.roleId, permission_id })),
        );
      if (insErr) throw new Error(insErr.message);
    }
    const { data: me } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (me?.tenant_id) {
      await audit(me.tenant_id, userId, "role_permission.set", "role", data.roleId, {
        count: data.permissionIds.length,
      });
    }
    return { ok: true as const };
  });
