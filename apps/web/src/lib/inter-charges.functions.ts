import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const idSchema = z.object({ id: z.string().uuid() });
const payerReviewSchema = z.object({
  state: z.enum([
    "missing_data",
    "binding_required",
    "confirmation_required",
    "confirmation_outdated",
    "confirmed",
  ]),
  missing_fields: z.array(
    z.enum([
      "name",
      "tax_id",
      "street",
      "number",
      "district",
      "city",
      "state",
      "zip",
      "phone",
      "amount",
      "due_date",
      "receivable",
    ]),
  ),
  request_id: z.string().uuid(),
  environment: z.enum(["sandbox", "production"]),
  binding_id: z.string().uuid().nullable(),
  snapshot_id: z.string().uuid().nullable(),
  confirmed_at: z.string().nullable(),
  source_updated_at: z.string(),
  source_fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
  seu_numero: z.string().min(1).max(15),
  amount: z.coerce.number(),
  due_date: z.string(),
  payer: z.object({
    name: z.string(),
    tax_id: z.string().nullable(),
    type: z.literal("JURIDICA"),
    email: z.string().nullable(),
    ddd: z.string().nullable(),
    phone: z.string().nullable(),
    street: z.string().nullable(),
    number: z.string().nullable(),
    complement: z.string().nullable(),
    district: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    zip: z.string().nullable(),
  }),
  dispatch_enabled: z.literal(false),
});
export type InterPayerReview = z.infer<typeof payerReviewSchema> & { canConfirm: boolean };
export type InterChargeRequest = {
  id: string;
  environment: "sandbox" | "production";
  amount: number;
  due_date: string;
  status: "blocked_homologation" | "dispatching" | "submitted" | "uncertain" | "failed";
  created_at: string;
  deleted_at: string | null;
  dispatch_attempts: number;
  dispatch_started_at: string | null;
  bank_request_id: string | null;
  bank_status: string | null;
  bank_accepted_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  updated_at: string;
};
export type InterChargeReview = {
  receivable: {
    id: string;
    cliente_nome: string;
    documento_referencia: string;
    valor_original: number;
    valor_aberto: number;
    vencimento_em: string;
    status_cobranca: string;
    origin: "measurement" | "recurring";
  };
  canPrepare: boolean;
  requests: InterChargeRequest[];
};

export const getInterChargeReview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }): Promise<InterChargeReview> => {
    const db = context.supabase as unknown as SupabaseClient;
    const { data: receivable, error } = await db
      .from("contas_receber")
      .select(
        "id,cliente_nome,documento_referencia,valor_original,valor_aberto,vencimento_em,status_cobranca,operating_company_id,billing_cycle_id,medicao_id",
      )
      .eq("id", data.id)
      .eq("tenant_id", context.claims.tenantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error("Não foi possível carregar a cobrança. Tente novamente.");
    if (!receivable || Boolean(receivable.billing_cycle_id) === Boolean(receivable.medicao_id))
      throw new Error("Conta a receber contratual indisponível.");
    if (!receivable.operating_company_id)
      throw new Error(
        "Defina a empresa operadora deste contrato antes de emitir a cobrança Inter.",
      );
    const [{ data: requests, error: requestError }, { data: canPrepare, error: scopeError }] =
      await Promise.all([
        db
          .from("inter_charge_requests")
          .select(
            "id,environment,amount,due_date,status,created_at,deleted_at,dispatch_attempts,dispatch_started_at,bank_request_id,bank_status,bank_accepted_at,last_error_code,last_error_message,updated_at",
          )
          .eq("receivable_id", data.id)
          .eq("tenant_id", context.claims.tenantId)
          .order("created_at"),
        db.rpc("has_financial_scope", {
          _tenant_id: context.claims.tenantId,
          _company_id: receivable.operating_company_id,
          _write: true,
        }),
      ]);
    if (requestError || scopeError)
      throw new Error("Não foi possível consultar as solicitações e permissões. Tente novamente.");
    return {
      receivable: {
        ...receivable,
        origin: receivable.medicao_id ? "measurement" : "recurring",
      },
      requests: requests ?? [],
      canPrepare: canPrepare === true,
    } as InterChargeReview;
  });

export const prepareInterCharge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    idSchema
      .extend({ environment: z.enum(["sandbox", "production"]), confirmed: z.literal(true) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // User-scoped client forwards the verified bearer, never a service-role key.
    const { data: result, error } = await context.supabase.functions.invoke(
      "preparar-cobranca-inter",
      {
        body: { receivable_id: data.id, environment: data.environment },
      },
    );
    if (error) {
      if (error.context instanceof Response) {
        const response = await error.context.json().catch(() => null);
        if (typeof response?.message === "string") throw new Error(response.message);
      }
      throw new Error(
        "Não foi possível confirmar a preparação. Atualize a consulta antes de tentar novamente; repetir não duplica a solicitação.",
      );
    }
    if (
      result?.status !== "blocked_homologation" ||
      typeof result?.id !== "string" ||
      typeof result?.reused !== "boolean"
    )
      throw new Error(
        "Resposta inesperada da preparação. Atualize a consulta antes de tentar novamente.",
      );
    return { id: result.id as string, reused: result.reused as boolean };
  });

export const getInterPayerReview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }): Promise<InterPayerReview> => {
    const db = context.supabase as unknown as SupabaseClient;
    const [review, request, roles] = await Promise.all([
      db.rpc("review_inter_payer", { p_request: data.id }),
      db
        .from("inter_charge_requests")
        .select("operating_company_id")
        .eq("id", data.id)
        .eq("tenant_id", context.claims.tenantId)
        .is("deleted_at", null)
        .maybeSingle(),
      db
        .from("user_roles")
        .select("roles!user_roles_role_tenant_fkey(name)")
        .eq("user_id", context.userId)
        .eq("tenant_id", context.claims.tenantId),
    ]);
    if (review.error || request.error)
      throw new Error(
        "Não foi possível revisar os dados do pagador. Verifique seu acesso financeiro e tente novamente.",
      );
    if (!request.data?.operating_company_id)
      throw new Error("Solicitação de cobrança indisponível neste ambiente.");
    if (roles.error)
      throw new Error(
        "Não foi possível consultar o perfil do usuário. Atualize a página e tente novamente.",
      );
    const { data: canWrite, error: scopeError } = await db.rpc("has_financial_scope", {
      _tenant_id: context.claims.tenantId,
      _company_id: request.data.operating_company_id,
      _write: true,
    });
    if (scopeError)
      throw new Error("Não foi possível validar a permissão financeira para esta empresa.");
    const assigned = z
      .array(z.object({ roles: z.object({ name: z.string() }).nullable() }))
      .parse(roles.data ?? []);
    return {
      ...payerReviewSchema.parse(review.data),
      canConfirm:
        canWrite === true &&
        assigned.some((role) => ["Admin", "Financeiro"].includes(role.roles?.name ?? "")),
    };
  });

export const confirmInterPayer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    idSchema
      .extend({
        sourceFingerprint: z.string().regex(/^[0-9a-f]{32}$/),
        binding: z.string().uuid(),
        previous: z.string().uuid().nullable(),
        confirmed: z.literal(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as SupabaseClient;
    const result = await db.rpc("confirm_inter_payer", {
      p_request: data.id,
      p_source_fingerprint: data.sourceFingerprint,
      p_binding: data.binding,
      p_previous_snapshot: data.previous,
      p_confirmed: data.confirmed,
    });
    if (result.error) {
      const messages: Record<string, string> = {
        "40001":
          "Os dados do pagador ou o vínculo mudaram. Atualize a consulta e confirme novamente.",
        "42501":
          "É necessário perfil Admin ou Financeiro com acesso financeiro de escrita à empresa.",
        "23514":
          "Não foi possível confirmar. Complete o cadastro do cliente e confirme o vínculo bancário deste ambiente.",
        "22023": "Revise os dados do pagador e marque a confirmação antes de continuar.",
      };
      throw new Error(
        messages[result.error.code] ??
          "Não foi possível confirmar o pagador. Atualize a consulta antes de tentar novamente.",
      );
    }
    return z
      .object({ id: z.string().uuid(), reused: z.boolean(), dispatch_enabled: z.literal(false) })
      .parse(result.data);
  });

export const emitInterSandboxCharge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.extend({ confirmed: z.literal(true) }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.functions.invoke(
      "emitir-cobranca-inter",
      { body: { request_id: data.id, confirmed: true } },
    );
    if (error) {
      if (error.context instanceof Response) {
        const response = await error.context.json().catch(() => null);
        if (typeof response?.message === "string") throw new Error(response.message);
      }
      throw new Error(
        "NÃ£o foi possÃ­vel concluir a comunicaÃ§Ã£o com o Inter. Atualize a consulta antes de qualquer nova tentativa.",
      );
    }
    return z
      .object({
        ok: z.boolean(),
        state: z.enum(["dispatching", "submitted", "uncertain", "failed"]),
        bank_request_id: z.string().uuid().nullable().optional(),
        reused: z.boolean().optional(),
        message: z.string(),
      })
      .parse(result);
  });
