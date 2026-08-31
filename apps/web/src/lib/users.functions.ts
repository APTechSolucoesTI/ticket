import { createServerFn } from "@tanstack/react-start";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { inviteEmailHtml, inviteEmailText } from "@/lib/email-templates.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

async function assertRoleDelegable(
  supabase: SupabaseClient<Database>,
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
      supabase.rpc("get_effective_permissions", { _user_id: actorId }),
      supabaseAdmin.from("role_permissions").select("permission_id").eq("role_id", roleId),
    ]);
  if (actorError) throw new Error(actorError.message);
  if (roleError) throw new Error(roleError.message);
  const ids = (roleRows ?? []).map((row) => row.permission_id);
  if (ids.length === 0) return;
  const { data: permissions, error: permissionsError } = await supabaseAdmin
    .from("permissions")
    .select("id, module, action")
    .in("id", ids);
  if (permissionsError) throw new Error(permissionsError.message);
  const actorPermissions = new Set(
    (actorRows ?? []).filter((row) => row.effective).map((row) => `${row.module}:${row.action}`),
  );
  if ((permissions ?? []).some((p) => !actorPermissions.has(`${p.module}:${p.action}`))) {
    throw new Error("Não é permitido delegar acesso superior ao seu.");
  }
}

/** Gera um novo token de convite pro profile e manda o e-mail - usado tanto
 * no convite inicial quanto no reenvio. Convites antigos não aceitos do
 * mesmo profile são invalidados antes (accepted_at = agora, mesmo truque que
 * acceptInvite usa pra marcar "consumido" - service_role só tem grant de
 * INSERT/SELECT/UPDATE em invites, sem DELETE, então é update, não delete):
 * sem isso, um link velho continuaria funcionando em paralelo ao novo (2
 * tokens válidos pro mesmo convite). */
async function issueAndSendInvite(
  supabaseAdmin: SupabaseClient<Database>,
  profile: { id: string; email: string },
) {
  const { sendMail } = await import("@/lib/mailer.server");

  const { error: invalidateErr } = await supabaseAdmin
    .from("invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("profile_id", profile.id)
    .is("accepted_at", null);
  if (invalidateErr) throw new Error(invalidateErr.message);

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { error: inviteErr } = await supabaseAdmin.from("invites").insert({
    profile_id: profile.id,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
  });
  if (inviteErr) throw new Error(inviteErr.message);

  const siteUrl = process.env.PUBLIC_SITE_URL ?? "http://localhost:8080";
  const url = `${siteUrl}/auth?invite=${token}`;
  await sendMail({
    to: profile.email,
    subject: "Convite para acessar o APTicket",
    html: inviteEmailHtml(url),
    text: inviteEmailText(url),
  });
}

const inviteSchema = z.object({
  email: z.string().trim().email("E-mail inválido").max(255),
  name: z.string().trim().min(1, "Informe o nome").max(120),
  roleId: z.string().uuid(),
});

export const inviteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inviteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: canInvite, error: permErr } = await supabase.rpc("has_permission", {
      _user_id: userId,
      _module: "usuarios",
      _action: "create",
    });
    if (permErr) throw new Error(permErr.message);
    if (!canInvite) throw new Error("Você não tem permissão para convidar usuários.");

    const { data: me, error: meErr } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (meErr) throw new Error(meErr.message);
    if (!me?.tenant_id) throw new Error("Organização não encontrada.");
    const tenantId = me.tenant_id;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertRoleDelegable(supabase, supabaseAdmin, userId, tenantId, data.roleId);

    // Checa "já existe" só em apticket.profiles - nunca mais em auth.users
    // (Supabase Auth global, compartilhado com outro sistema no mesmo host).
    // Era essa dependência que fazia convidar um e-mail que já existia em
    // auth.users de OUTRO sistema falhar com "usuário já cadastrado".
    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("id, tenant_id")
      .eq("email", data.email.toLowerCase())
      .maybeSingle();
    if (existing) {
      if (existing.tenant_id !== tenantId) {
        throw new Error("Este e-mail já pertence a outra organização.");
      }
      throw new Error("Este usuário já faz parte da sua organização.");
    }

    const { data: profile, error: profErr } = await supabaseAdmin
      .from("profiles")
      .insert({
        id: randomUUID(),
        tenant_id: tenantId,
        name: data.name,
        email: data.email.toLowerCase(),
        password_hash: null,
        is_active: false, // vira true só quando aceitar o convite (define senha)
      })
      .select("id")
      .single();
    if (profErr) throw new Error(profErr.message);

    const { error: rolesErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: profile.id, tenant_id: tenantId, role_id: data.roleId });
    if (rolesErr) throw new Error(rolesErr.message);

    await issueAndSendInvite(supabaseAdmin, { id: profile.id, email: data.email.toLowerCase() });

    return { ok: true as const, email: data.email };
  });

const resendInviteSchema = z.object({ userId: z.string().uuid() });

export const resendInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => resendInviteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: canInvite, error: permErr } = await supabase.rpc("has_permission", {
      _user_id: userId,
      _module: "usuarios",
      _action: "create",
    });
    if (permErr) throw new Error(permErr.message);
    if (!canInvite) throw new Error("Você não tem permissão para reenviar convites.");

    const { data: me, error: meErr } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (meErr) throw new Error(meErr.message);
    if (!me?.tenant_id) throw new Error("Organização não encontrada.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: target, error: targetErr } = await supabaseAdmin
      .from("profiles")
      .select("id, tenant_id, email, is_active")
      .eq("id", data.userId)
      .maybeSingle();
    if (targetErr) throw new Error(targetErr.message);
    if (!target || target.tenant_id !== me.tenant_id) {
      throw new Error("Usuário não encontrado.");
    }
    if (target.is_active) {
      throw new Error("Este usuário já aceitou o convite.");
    }

    await issueAndSendInvite(supabaseAdmin, { id: target.id, email: target.email });

    return { ok: true as const, email: target.email };
  });
