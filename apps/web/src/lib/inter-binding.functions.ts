import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({
  company: z.string().uuid(),
  environment: z.enum(["sandbox", "production"]),
});
const reviewSchema = z.object({
  state: z.enum([
    "company_tax_mismatch",
    "configuration_missing",
    "certificate_expired",
    "confirmation_required",
    "bound_to_another_company",
    "confirmation_outdated",
    "confirmed",
  ]),
  configuration_version: z.number().int().nullable(),
  account_last_four: z.string().nullable(),
  certificate_expires_at: z.string().nullable(),
  binding_id: z.string().uuid().nullable(),
  confirmed_at: z.string().nullable(),
});

export const listInterOperatingCompanies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as unknown as SupabaseClient;
    const { data, error } = await db
      .from("operating_companies")
      .select("id,legal_name,tax_id")
      .eq("tenant_id", context.claims.tenantId)
      .is("deleted_at", null)
      .order("legal_name")
      .limit(101);
    if (error) throw new Error("Não foi possível consultar as empresas. Tente novamente.");
    if ((data?.length ?? 0) > 100)
      throw new Error(
        "Há mais de 100 empresas disponíveis. Solicite a revisão do escopo de acesso.",
      );
    return z
      .array(
        z.object({ id: z.string().uuid(), legal_name: z.string(), tax_id: z.string().nullable() }),
      )
      .parse(data ?? []);
  });

export const getInterBindingReview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => input.parse(value))
  .handler(async ({ context, data }) => {
    const db = context.supabase as unknown as SupabaseClient;
    const [review, scope, roles] = await Promise.all([
      db.rpc("review_inter_binding", { p_company: data.company, p_environment: data.environment }),
      db.rpc("has_financial_scope", {
        _tenant_id: context.claims.tenantId,
        _company_id: data.company,
        _write: true,
      }),
      db
        .from("user_roles")
        // Há duas FKs para roles; selecione explicitamente a que inclui a tenant.
        .select("roles!user_roles_role_tenant_fkey(name)")
        .eq("user_id", context.userId)
        .eq("tenant_id", context.claims.tenantId),
    ]);
    if (roles.error)
      throw new Error(
        "Não foi possível consultar o perfil do usuário. Atualize a página e tente novamente.",
      );
    if (review.error || scope.error)
      throw new Error(
        "Vínculo indisponível. Verifique seu acesso financeiro à empresa e tente novamente.",
      );
    const assigned = z
      .array(z.object({ roles: z.object({ name: z.string() }).nullable() }))
      .parse(roles.data ?? []);
    return {
      ...reviewSchema.parse(review.data),
      canConfirm:
        scope.data === true &&
        assigned.some((r) => ["Admin", "Financeiro"].includes(r.roles?.name ?? "")),
    };
  });

export const confirmInterBinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    input
      .extend({
        version: z.number().int().positive(),
        previous: z.string().uuid().nullable(),
        confirmed: z.literal(true),
      })
      .parse(value),
  )
  .handler(async ({ context, data }) => {
    const db = context.supabase as unknown as SupabaseClient;
    const result = await db.rpc("confirm_inter_binding", {
      p_company: data.company,
      p_environment: data.environment,
      p_configuration_version: data.version,
      p_previous_binding: data.previous,
      p_confirmed: data.confirmed,
    });
    if (result.error) {
      const messages: Record<string, string> = {
        "40001": "A configuração ou o vínculo mudou. Atualize a consulta e confirme novamente.",
        "42501":
          "É necessário perfil Admin ou Financeiro com acesso financeiro de escrita à empresa.",
        "23514":
          "Não foi possível vincular. Confira o CNPJ da empresa, o certificado e o vínculo atual deste ambiente.",
        "22023": "Revise a empresa, o ambiente e a confirmação informados.",
      };
      throw new Error(
        messages[result.error.code] ??
          "Não foi possível confirmar o vínculo. Atualize a consulta antes de tentar novamente.",
      );
    }
    return z
      .object({ id: z.string().uuid(), reused: z.boolean(), dispatch_enabled: z.literal(false) })
      .parse(result.data);
  });
