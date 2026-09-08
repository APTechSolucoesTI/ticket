import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { interSettingsSchema, type InterSettingsMetadata } from "./inter-settings.schema";

export const listInterSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InterSettingsMetadata[]> => {
    const { data: allowed } = await context.supabase.rpc("has_permission", {
      _user_id: context.userId,
      _module: "empresa",
      _action: "view",
    });
    const { data: settingsAllowed } = await context.supabase.rpc("has_permission", {
      _user_id: context.userId,
      _module: "configuracoes",
      _action: "view",
    });
    if (!allowed || !settingsAllowed)
      throw new Error("Sem permissão para consultar a configuração bancária.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const { data, error } = await db
      .from("tenant_inter_configurations")
      .select(
        "environment,account,is_active,certificate_expires_at,certificate_fingerprint,version,updated_at",
      )
      .eq("tenant_id", context.claims.tenantId);
    if (error) throw new Error("Não foi possível consultar as configurações do Inter.");
    return data as InterSettingsMetadata[];
  });

export const saveInterSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => interSettingsSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Certificado é analisado no servidor; o par nunca é devolvido ao navegador.
    let expiresAt: string | null = null;
    let fingerprint: string | null = null;
    if (data.certificate) {
      const { validateInterCertificate } = await import("./inter-certificate.server");
      ({ expiresAt, fingerprint } = validateInterCertificate(data.certificate, data.privateKey));
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const { error } = await db.rpc("save_tenant_inter_configuration", {
      p_actor: context.userId,
      p_tenant: context.claims.tenantId,
      p_environment: data.environment,
      p_account: data.account,
      p_credentials: {
        ...(data.clientId ? { client_id: data.clientId } : {}),
        ...(data.clientSecret ? { client_secret: data.clientSecret } : {}),
        ...(data.certificate
          ? { certificate: data.certificate, private_key: data.privateKey }
          : {}),
      },
      p_expires_at: expiresAt,
      p_fingerprint: fingerprint,
      p_activate: data.activate,
      p_production_confirmed: data.productionConfirmation,
      p_version: data.version,
    });
    if (error) {
      // Não serializar detalhes SQL: podem conter os parâmetros sensíveis.
      if (error.code === "40001")
        throw new Error(
          "A configuração foi alterada por outro usuário. Atualize a página e tente novamente.",
        );
      if (error.code === "42501")
        throw new Error("Sem permissão para alterar a configuração bancária deste tenant.");
      if (error.code === "22023")
        throw new Error(
          "Configuração incompleta ou certificado vencido. Revise as credenciais e a confirmação de produção.",
        );
      throw new Error(
        "Não foi possível salvar a configuração bancária. Nenhum segredo foi retornado.",
      );
    }
    return { saved: true };
  });
