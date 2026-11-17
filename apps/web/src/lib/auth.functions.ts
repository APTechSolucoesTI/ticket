// Autenticação própria do APTicket - substitui supabase.auth.signInWithPassword/
// signUp/admin.inviteUserByEmail pra não depender mais de auth.users (Supabase
// Auth), que é global ao projeto Supabase e compartilhado com outro sistema no
// mesmo host. Ver plano em C:\Users\luiz.esposito\.claude\plans\vectorized-painting-puppy.md
//
// RLS continua funcionando: o JWT emitido aqui (jwt.server.ts) é compatível
// com o PostgREST (mesmo JWT_SECRET que o GoTrue já usa) - nenhuma das
// chamadas supabase.from(...) existentes no app precisa mudar.
import { createServerFn } from "@tanstack/react-start";
import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { signSessionToken } from "@/lib/jwt.server";
import { resetEmailHtml, resetEmailText } from "@/lib/email-templates.server";
import { enforceAuthRateLimit } from "@/lib/auth-rate-limit.server";

const BCRYPT_ROUNDS = 12;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hora

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("hex");
}

function siteUrl(): string {
  return process.env.PUBLIC_SITE_URL ?? "http://localhost:8080";
}

const GENERIC_LOGIN_ERROR = "E-mail ou senha inválidos.";

const loginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1),
});

export const login = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => loginSchema.parse(input))
  .handler(async ({ data }) => {
    await enforceAuthRateLimit("login", data.email.toLowerCase());
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, tenant_id, name, email, password_hash, is_active, session_version")
      .eq("email", data.email.toLowerCase())
      .maybeSingle();

    // Mensagem sempre genérica - não vaza se o e-mail existe ou não.
    if (!profile || !profile.is_active || !profile.password_hash) {
      throw new Error(GENERIC_LOGIN_ERROR);
    }
    const ok = await bcrypt.compare(data.password, profile.password_hash);
    if (!ok) throw new Error(GENERIC_LOGIN_ERROR);

    const token = signSessionToken({
      id: profile.id,
      email: profile.email,
      name: profile.name,
      tenantId: profile.tenant_id,
      sessionVersion: profile.session_version,
    });
    return { token };
  });

const inviteAcceptSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres"),
});

export const acceptInvite = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => inviteAcceptSchema.parse(input))
  .handler(async ({ data }) => {
    await enforceAuthRateLimit("invite", hashToken(data.token));
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const tokenHash = hashToken(data.token);

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const { data: profile, error: profErr } = await supabaseAdmin
      .rpc("complete_invite", { _token_hash: tokenHash, _password_hash: passwordHash })
      .single();
    if (profErr || !profile) throw new Error("Convite inválido ou expirado.");

    const token = signSessionToken({
      id: profile.id,
      email: profile.email,
      name: profile.name,
      tenantId: profile.tenant_id,
      sessionVersion: profile.session_version,
    });
    return { token };
  });

const requestResetSchema = z.object({
  email: z.string().trim().email().max(255),
});

export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => requestResetSchema.parse(input))
  .handler(async ({ data }) => {
    await enforceAuthRateLimit("recovery", data.email.toLowerCase());
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendMail } = await import("@/lib/mailer.server");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, name, email, is_active")
      .eq("email", data.email.toLowerCase())
      .maybeSingle();

    // Sempre responde sucesso - não vaza se o e-mail existe. Só manda de
    // verdade se achar um profile ativo.
    if (profile?.is_active) {
      const token = newToken();
      const { error } = await supabaseAdmin.from("password_resets").insert({
        profile_id: profile.id,
        token_hash: hashToken(token),
        expires_at: new Date(Date.now() + RESET_TTL_MS).toISOString(),
      });
      if (!error) {
        const url = `${siteUrl()}/auth?reset=${token}`;
        await sendMail({
          to: profile.email,
          subject: "Redefinição de senha - APTicket",
          html: resetEmailHtml(url),
          text: resetEmailText(url),
        }).catch((e: unknown) => {
          console.error("[requestPasswordReset] falha ao enviar e-mail:", e);
        });
      }
    }
    return { ok: true as const };
  });

const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres"),
});

export const resetPassword = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => resetPasswordSchema.parse(input))
  .handler(async ({ data }) => {
    await enforceAuthRateLimit("reset", hashToken(data.token));
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const tokenHash = hashToken(data.token);

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const { data: profile, error: profErr } = await supabaseAdmin
      .rpc("complete_password_reset", { _token_hash: tokenHash, _password_hash: passwordHash })
      .single();
    if (profErr || !profile) throw new Error("Link de redefinição inválido ou expirado.");

    const token = signSessionToken({
      id: profile.id,
      email: profile.email,
      name: profile.name,
      tenantId: profile.tenant_id,
      sessionVersion: profile.session_version,
    });
    return { token };
  });

const signUpSchema = z.object({
  name: z.string().trim().min(1).max(120),
  company: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(255),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres"),
});

/**
 * Cadastro público de empresa nova (aba "Criar conta"). Antes disso vivia
 * inteiro no trigger apticket.handle_new_user(), disparado por INSERT em
 * auth.users - sem auth.users pra cadastro novo, a lógica de "cria tenant +
 * profile admin" passa a ser uma transação RPC restrita ao servidor. O trigger continua
 * existindo (não precisa remover), só fica sem uso pra contas novas.
 */
export const signUpTenant = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => signUpSchema.parse(input))
  .handler(async ({ data }) => {
    await enforceAuthRateLimit("signup");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const { data: profile, error } = await supabaseAdmin
      .rpc("provision_tenant", {
        _company_name: data.company,
        _name: data.name,
        _email: data.email.toLowerCase(),
        _password_hash: passwordHash,
      })
      .single();
    if (error || !profile) {
      if (error?.code === "23505") throw new Error("Este e-mail já está cadastrado.");
      console.error("[signUpTenant] provisioning failed", { code: error?.code });
      throw new Error("Não foi possível criar sua conta. Tente novamente.");
    }

    const token = signSessionToken({
      id: profile.id,
      email: profile.email,
      name: profile.name,
      tenantId: profile.tenant_id,
      sessionVersion: profile.session_version,
    });
    return { token };
  });
