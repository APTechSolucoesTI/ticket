import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inviteSchema = z.object({
  email: z.string().trim().email("E-mail inválido").max(255),
  name: z.string().trim().min(1, "Informe o nome").max(120),
  role: z.enum(["admin", "agent", "requester"]),
});

export const inviteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inviteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: isAdmin, error: roleErr } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Apenas administradores podem convidar usuários.");

    const { data: me, error: meErr } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (meErr) throw new Error(meErr.message);
    if (!me?.tenant_id) throw new Error("Organização não encontrada.");
    const tenantId = me.tenant_id;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("id, tenant_id")
      .eq("email", data.email)
      .maybeSingle();
    if (existing) {
      if (existing.tenant_id !== tenantId) {
        throw new Error("Este e-mail já pertence a outra organização.");
      }
      throw new Error("Este usuário já faz parte da sua organização.");
    }

    // PUBLIC_SITE_URL fixo em vez de derivar da requisição (new URL(request.url).origin)
    // — atrás de Traefik/proxy isso depende dos headers X-Forwarded-* chegarem
    // certos no Node, e quando não chegam o redirectTo vira algo que o GoTrue
    // não reconhece e ele cai no fallback dele (o link do convite ia parar no
    // próprio Supabase em vez do APTicket). Com env var fixa não tem essa
    // dependência — mas o Supabase ainda precisa ter essa URL na allowlist de
    // "Redirect URLs" (Auth → URL Configuration), senão ignora do mesmo jeito.
    function resolveRedirectBase(): string | undefined {
      if (process.env.PUBLIC_SITE_URL) return process.env.PUBLIC_SITE_URL;
      console.warn(
        "[inviteUser] PUBLIC_SITE_URL não setada — usando origin da requisição como fallback (pode falhar atrás de proxy).",
      );
      const request = getRequest();
      return request ? new URL(request.url).origin : undefined;
    }
    const redirectBase = resolveRedirectBase();

    const { data: invited, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      data.email,
      {
        // "app: apticket" é o que o trigger apticket.handle_new_user() checa
        // antes de provisionar — esse Supabase Auth é compartilhado com outro
        // sistema, sem esse marcador qualquer signup em QUALQUER app que usa
        // esse Supabase ganhava um tenant+perfil aqui de graça.
        data: { name: data.name, invited_tenant_id: tenantId, app: "apticket" },
        ...(redirectBase ? { redirectTo: `${redirectBase}/auth` } : {}),
      },
    );
    if (inviteErr) throw new Error(inviteErr.message);
    const newUserId = invited?.user?.id;
    if (!newUserId) throw new Error("Não foi possível criar o convite.");

    // The signup trigger creates a separate workspace for every new user.
    // Move the invited user into the inviting organization instead.
    const { data: created } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", newUserId)
      .maybeSingle();
    const orphanTenantId = created?.tenant_id;

    const { error: profErr } = await supabaseAdmin
      .from("profiles")
      .update({ tenant_id: tenantId, name: data.name })
      .eq("id", newUserId);
    if (profErr) throw new Error(profErr.message);

    await supabaseAdmin.from("user_roles").delete().eq("user_id", newUserId);
    const { error: rolesErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newUserId, tenant_id: tenantId, role: data.role });
    if (rolesErr) throw new Error(rolesErr.message);

    if (orphanTenantId && orphanTenantId !== tenantId) {
      await supabaseAdmin.from("tenants").delete().eq("id", orphanTenantId);
    }

    return { ok: true as const, email: data.email };
  });
