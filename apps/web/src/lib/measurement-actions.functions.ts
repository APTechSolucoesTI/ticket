import { createServerFn } from "@tanstack/react-start";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { verifySessionToken } from "@/lib/jwt.server";

const cancelMeasurementSchema = z.object({
  token: z.string().min(20),
  measurementId: z.string().uuid(),
  password: z.string().min(1),
  reason: z.string().trim().min(10).max(1000),
});

export const cancelContractMeasurement = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => cancelMeasurementSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const claims = verifySessionToken(data.token);
    if (!claims) throw new Error("Sua sessão expirou. Entre novamente para continuar.");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, tenant_id, password_hash, is_active")
      .eq("id", claims.sub)
      .eq("tenant_id", claims.tenantId)
      .maybeSingle();

    if (!profile?.is_active || !profile.password_hash) {
      throw new Error("Não foi possível confirmar sua identidade.");
    }

    const passwordMatches = await bcrypt.compare(data.password, profile.password_hash);
    if (!passwordMatches) throw new Error("Senha incorreta.");

    const { data: measurement, error } = await supabaseAdmin.rpc(
      "cancelar_medicao_contrato_confirmada",
      {
        p_actor_id: profile.id,
        p_justificativa: data.reason,
        p_medicao_id: data.measurementId,
        p_tenant_id: profile.tenant_id,
      },
    );
    if (error) throw new Error(error.message);
    return measurement;
  });
