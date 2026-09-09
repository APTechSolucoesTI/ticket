import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const idSchema = z.object({ id: z.string().uuid() });
export type InterChargeReview = {
  receivable: {
    id: string;
    cliente_nome: string;
    documento_referencia: string;
    valor_original: number;
    valor_aberto: number;
    vencimento_em: string;
    status_cobranca: string;
  };
  canPrepare: boolean;
  requests: {
    id: string;
    environment: "sandbox" | "production";
    amount: number;
    due_date: string;
    status: string;
    created_at: string;
    deleted_at: string | null;
  }[];
};

export const getInterChargeReview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }): Promise<InterChargeReview> => {
    const db = context.supabase as unknown as SupabaseClient;
    const { data: receivable, error } = await db
      .from("contas_receber")
      .select(
        "id,cliente_nome,documento_referencia,valor_original,valor_aberto,vencimento_em,status_cobranca,operating_company_id,billing_cycle_id",
      )
      .eq("id", data.id)
      .eq("tenant_id", context.claims.tenantId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error("Não foi possível carregar a cobrança. Tente novamente.");
    if (!receivable?.billing_cycle_id || !receivable.operating_company_id)
      throw new Error("Recebível recorrente indisponível ou sem acesso à empresa.");
    const [{ data: requests, error: requestError }, { data: canPrepare, error: scopeError }] =
      await Promise.all([
        db
          .from("inter_charge_requests")
          .select("id,environment,amount,due_date,status,created_at,deleted_at")
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
      receivable,
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
