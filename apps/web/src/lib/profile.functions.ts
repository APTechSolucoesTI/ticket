import { createServerFn } from "@tanstack/react-start";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { signSessionToken } from "@/lib/jwt.server";
import { checkRateLimit } from "@/lib/rate-limit";
import { randomUUID } from "node:crypto";
import {
  avatarImageExtension,
  MAX_AVATAR_BYTES,
  PROFILE_AVATAR_BUCKET,
} from "@/lib/profile-avatar";

const BCRYPT_ROUNDS = 12;
const PASSWORD_ATTEMPTS = 8;
const PASSWORD_WINDOW_MS = 15 * 60 * 1000;

export type MyProfile = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
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
  const result = await checkRateLimit(
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
      .select("id, tenant_id, name, email, phone, avatar_url, is_active")
      .eq("id", context.userId)
      .eq("tenant_id", context.claims.tenantId)
      .maybeSingle();

    if (error) throw new Error("Não foi possível carregar seu perfil.");
    if (!profile?.is_active) throw new Error("Perfil não encontrado ou inativo.");
    const { resolveProfileAvatar } = await import("@/lib/profile-avatar.server");
    return {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      phone: profile.phone,
      avatarUrl: await resolveProfileAvatar(profile.avatar_url, profile.tenant_id, profile.id),
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
      .select("id, tenant_id, name, email, phone, password_hash, is_active, session_version")
      .eq("id", context.userId)
      .eq("tenant_id", context.claims.tenantId)
      .maybeSingle();

    if (
      profileError ||
      !profile?.is_active ||
      profile.session_version !== context.claims.sessionVersion
    ) {
      throw new Error("Perfil não encontrado ou inativo.");
    }

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
      .eq("session_version", context.claims.sessionVersion)
      .select("id, tenant_id, name, email, phone, avatar_url, session_version")
      .single();

    if (error?.code === "23505") throw new Error("Este e-mail já está em uso.");
    if (error) throw new Error("Não foi possível atualizar seus dados de contato.");

    const token = emailChanged
      ? signSessionToken({
          id: updated.id,
          tenantId: updated.tenant_id,
          name: updated.name,
          email: updated.email,
          sessionVersion: updated.session_version,
        })
      : null;

    const { resolveProfileAvatar } = await import("@/lib/profile-avatar.server");
    return {
      profile: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        phone: updated.phone,
        avatarUrl: await resolveProfileAvatar(updated.avatar_url, updated.tenant_id, updated.id),
      } satisfies MyProfile,
      token,
      emailChanged,
    };
  });

const avatarSchema = z
  .object({
    imageBase64: z
      .string()
      .min(1)
      .max(Math.ceil(MAX_AVATAR_BYTES / 3) * 4),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  })
  .strict();

export const uploadMyAvatar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => avatarSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (data.imageBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data.imageBase64))
      throw new Error("A imagem enviada é inválida.");
    const bytes = Buffer.from(data.imageBase64, "base64");
    const extension = avatarImageExtension(bytes, data.mimeType);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveProfileAvatar, deleteOwnAvatar } = await import("@/lib/profile-avatar.server");
    const { data: profile, error: readError } = await supabaseAdmin
      .from("profiles")
      .select("id,tenant_id,avatar_url,is_active")
      .eq("id", context.userId)
      .eq("tenant_id", context.claims.tenantId)
      .maybeSingle();
    if (readError || !profile?.is_active) throw new Error("Perfil não encontrado ou inativo.");
    const path = `${profile.tenant_id}/${profile.id}/${randomUUID()}.${extension}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(PROFILE_AVATAR_BUCKET)
      .upload(path, bytes, { contentType: data.mimeType, cacheControl: "3600", upsert: false });
    if (uploadError) throw new Error("Não foi possível enviar a foto. Tente novamente.");
    const avatarUrl = await resolveProfileAvatar(path, profile.tenant_id, profile.id);
    if (!avatarUrl) {
      await deleteOwnAvatar(path, profile.tenant_id, profile.id);
      throw new Error("Não foi possível preparar a foto para exibição. Tente novamente.");
    }
    let update = supabaseAdmin
      .from("profiles")
      .update({ avatar_url: path })
      .eq("id", profile.id)
      .eq("tenant_id", profile.tenant_id)
      .eq("is_active", true);
    update =
      profile.avatar_url === null
        ? update.is("avatar_url", null)
        : update.eq("avatar_url", profile.avatar_url);
    const { data: saved, error: saveError } = await update.select("id").maybeSingle();
    if (saveError || !saved) {
      await deleteOwnAvatar(path, profile.tenant_id, profile.id);
      throw new Error(
        saveError
          ? "Não foi possível salvar sua foto. Tente novamente."
          : "Seu perfil mudou durante o envio. Tente novamente.",
      );
    }
    await deleteOwnAvatar(profile.avatar_url, profile.tenant_id, profile.id);
    return { avatarUrl };
  });

export const removeMyAvatar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { deleteOwnAvatar } = await import("@/lib/profile-avatar.server");
    const { data: profile, error: readError } = await supabaseAdmin
      .from("profiles")
      .select("id,tenant_id,avatar_url,is_active")
      .eq("id", context.userId)
      .eq("tenant_id", context.claims.tenantId)
      .maybeSingle();
    if (readError || !profile?.is_active) throw new Error("Perfil não encontrado ou inativo.");
    if (!profile.avatar_url) return { avatarUrl: null };
    const { data: removed, error } = await supabaseAdmin
      .from("profiles")
      .update({ avatar_url: null })
      .eq("id", profile.id)
      .eq("tenant_id", profile.tenant_id)
      .eq("is_active", true)
      .eq("avatar_url", profile.avatar_url)
      .select("id")
      .maybeSingle();
    if (error || !removed)
      throw new Error("Não foi possível remover sua foto. Atualize o perfil e tente novamente.");
    await deleteOwnAvatar(profile.avatar_url, profile.tenant_id, profile.id);
    return { avatarUrl: null };
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
      .select("id, tenant_id, name, email, password_hash, is_active, session_version")
      .eq("id", context.userId)
      .eq("tenant_id", context.claims.tenantId)
      .maybeSingle();

    if (
      profileError ||
      !profile?.is_active ||
      !profile.password_hash ||
      profile.session_version !== context.claims.sessionVersion
    ) {
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
    const { data: updated, error } = await supabaseAdmin
      .from("profiles")
      .update({ password_hash: passwordHash })
      .eq("id", profile.id)
      .eq("tenant_id", profile.tenant_id)
      .eq("session_version", context.claims.sessionVersion)
      .select("id, tenant_id, name, email, session_version")
      .single();
    if (error || !updated) throw new Error("Não foi possível alterar sua senha.");

    return {
      ok: true as const,
      token: signSessionToken({
        id: updated.id,
        tenantId: updated.tenant_id,
        name: updated.name,
        email: updated.email,
        sessionVersion: updated.session_version,
      }),
    };
  });
