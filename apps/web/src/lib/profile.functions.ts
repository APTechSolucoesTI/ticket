import { createServerFn } from "@tanstack/react-start";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { signSessionToken } from "@/lib/jwt.server";

const BCRYPT_ROUNDS = 12;
const PASSWORD_ATTEMPTS = 8;
const PASSWORD_WINDOW_MS = 15 * 60 * 1000;

export type MyProfile = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
};

function normalizePhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  const normalized =
    (digits.length === 10 || digits.length === 11) && !digits.startsWith("55")
      ? `55${digits}`
      : digits;
  if (!/^[1-9][0-9]{9,14}$/.test(normalized)) {
    throw new Error("Informe um telefone válido com DDD.");
  }
  return normalized;
}

async function enforcePasswordAttemptLimit(userId: string) {
  const { checkRateLimit } = await import("@/lib/rate-limit");
  const result = checkRateLimit(
    `profile-password:${userId}`,
    PASSWORD_ATTEMPTS,
    PASSWORD_WINDOW_MS,
  );
  if (!result.allowed) {
    throw new Error(
      `Muitas tentativas de confirmação. Aguarde ${result.retryAfterSeconds} segundos e tente novamente.`,
    );
  }
}

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyProfile> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select("id, tenant_id, name, email, phone, is_active")
      .eq("id", context.userId)
      .eq("tenant_id", context.claims.tenantId)
      .maybeSingle();

    if (error) throw new Error("Não foi possível carregar seu perfil.");
    if (!profile?.is_active) throw new Error("Perfil não encontrado ou inativo.");
    return {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      phone: profile.phone,
    };
  });

const contactSchema = z.object({
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido.").max(255),
  phone: z.string().trim().max(30).default(""),
  currentPassword: z.string().max(200).optional().default(""),
});

export const updateMyContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => contactSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, tenant_id, name, email, phone, password_hash, is_active")
      .eq("id", context.userId)
      .eq("tenant_id", context.claims.tenantId)
      .maybeSingle();

    if (profileError || !profile?.is_active) throw new Error("Perfil não encontrado ou inativo.");

    const emailChanged = data.email !== profile.email.toLowerCase();
    if (emailChanged) {
      await enforcePasswordAttemptLimit(context.userId);
      if (!data.currentPassword || !profile.password_hash) {
        throw new Error("Informe sua senha atual para alterar o e-mail.");
      }
      const passwordMatches = await bcrypt.compare(data.currentPassword, profile.password_hash);
      if (!passwordMatches) throw new Error("Senha atual incorreta.");

      const { data: existing } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("email", data.email)
        .neq("id", profile.id)
        .maybeSingle();
      if (existing) throw new Error("Este e-mail já está em uso.");
    }

    const phone = normalizePhone(data.phone);
    const { data: updated, error } = await supabaseAdmin
      .from("profiles")
      .update({ email: data.email, phone })
      .eq("id", profile.id)
      .eq("tenant_id", profile.tenant_id)
      .select("id, tenant_id, name, email, phone")
      .single();

    if (error?.code === "23505") throw new Error("Este e-mail já está em uso.");
    if (error) throw new Error("Não foi possível atualizar seus dados de contato.");

    const token = emailChanged
      ? signSessionToken({
          id: updated.id,
          tenantId: updated.tenant_id,
          name: updated.name,
          email: updated.email,
        })
      : null;

    return {
      profile: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        phone: updated.phone,
      } satisfies MyProfile,
      token,
      emailChanged,
    };
  });

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Informe sua senha atual.").max(200),
    newPassword: z.string().min(8, "A nova senha precisa ter pelo menos 8 caracteres.").max(200),
    confirmPassword: z.string().min(1, "Confirme a nova senha.").max(200),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "As senhas não coincidem.",
  });

export const changeMyPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => passwordSchema.parse(input))
  .handler(async ({ data, context }) => {
    await enforcePasswordAttemptLimit(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, tenant_id, password_hash, is_active")
      .eq("id", context.userId)
      .eq("tenant_id", context.claims.tenantId)
      .maybeSingle();

    if (profileError || !profile?.is_active || !profile.password_hash) {
      throw new Error("Não foi possível confirmar sua identidade.");
    }

    const passwordMatches = await bcrypt.compare(data.currentPassword, profile.password_hash);
    if (!passwordMatches) throw new Error("Senha atual incorreta.");
    if (await bcrypt.compare(data.newPassword, profile.password_hash)) {
      throw new Error("A nova senha deve ser diferente da senha atual.");
    }

    // Links de recuperação emitidos antes da troca deixam de ser válidos.
    const { error: resetError } = await supabaseAdmin
      .from("password_resets")
      .update({ accepted_at: new Date().toISOString() })
      .eq("profile_id", profile.id)
      .is("accepted_at", null);
    if (resetError) throw new Error("Não foi possível concluir a alteração da senha.");

    const passwordHash = await bcrypt.hash(data.newPassword, BCRYPT_ROUNDS);
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ password_hash: passwordHash })
      .eq("id", profile.id)
      .eq("tenant_id", profile.tenant_id);
    if (error) throw new Error("Não foi possível alterar sua senha.");

    return { ok: true as const };
  });
