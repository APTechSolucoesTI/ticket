import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const channel = z.enum(["email", "whatsapp", "sms"]);
const step = z.object({
  id: z.string().uuid().optional(),
  position: z.number().int().min(1).max(10).optional(),
  days_after_due: z.number().int().min(-30).max(365),
  channel,
  subject: z.string().max(180).nullable().optional(),
  message_template: z.string().trim().min(1).max(4000),
  enabled: z.boolean().default(true),
});
const policy = z.object({
  company_id: z.string().uuid(),
  configured: z.boolean(),
  enabled: z.boolean(),
  suspend_after_days: z.number().int().nullable(),
  steps: z.array(step),
  pending_actions: z.number().int().nonnegative(),
  failed_actions: z.number().int().nonnegative(),
  pending_events: z.number().int().nonnegative(),
  updated_at: z.string().nullable(),
});
const companyInput = z.object({ company: z.string().uuid() });

export type CollectionPolicy = z.infer<typeof policy>;
export type CollectionStep = z.infer<typeof step>;

export const getCollectionPolicy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => companyInput.parse(value))
  .handler(async ({ context, data }) => {
    const db = context.supabase as unknown as SupabaseClient;
    const result = await db.rpc("get_collection_policy", { p_company: data.company });
    if (result.error) throw new Error("Não foi possível consultar a régua de cobrança.");
    return policy.parse(result.data);
  });

export const saveCollectionPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    companyInput
      .extend({
        enabled: z.boolean(),
        suspendAfterDays: z.number().int().min(1).max(365).nullable(),
        steps: z.array(step).max(10),
      })
      .parse(value),
  )
  .handler(async ({ context, data }) => {
    const db = context.supabase as unknown as SupabaseClient;
    const result = await db.rpc("save_collection_policy", {
      p_company: data.company,
      p_enabled: data.enabled,
      p_suspend_after_days: data.suspendAfterDays,
      p_steps: data.steps,
    });
    if (result.error) {
      if (result.error.code === "42501")
        throw new Error("É necessário acesso financeiro de escrita para configurar a régua.");
      throw new Error(result.error.message || "Não foi possível salvar a régua de cobrança.");
    }
    return { id: z.string().uuid().parse(result.data) };
  });

export const evaluateCollectionPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => companyInput.parse(value))
  .handler(async ({ context, data }) => {
    const db = context.supabase as unknown as SupabaseClient;
    const result = await db.rpc("evaluate_collection_policy", {
      p_company: data.company,
    });
    if (result.error)
      throw new Error(result.error.message || "Não foi possível processar a régua.");
    return z
      .object({ actions: z.number().int(), events: z.number().int(), enabled: z.boolean() })
      .parse(result.data);
  });
