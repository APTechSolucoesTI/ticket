import { createServerFn } from "@tanstack/react-start";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { inviteEmailHtml, inviteEmailText } from "@/lib/email-templates.server";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

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
    const { sendMail } = await import("@/lib/mailer.server");

    // Checa "já existe" só em apticket.profiles — nunca mais em auth.users
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
      .insert({ user_id: profile.id, tenant_id: tenantId, role: data.role });
    if (rolesErr) throw new Error(rolesErr.message);

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
      to: data.email,
      subject: "Convite para acessar o APTicket",
      html: inviteEmailHtml(url),
      text: inviteEmailText(url),
    });

    return { ok: true as const, email: data.email };
  });
