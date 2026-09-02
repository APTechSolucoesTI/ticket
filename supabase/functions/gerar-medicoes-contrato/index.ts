import "@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type GenerateMeasurementsPayload = {
  contrato_id?: string | null;
  competencia?: string | null;
  forcar?: boolean;
  agendado?: boolean;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ message: "Método não permitido." }, 405);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse({ message: "Autenticação obrigatória." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const apiKey = request.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !apiKey) {
    console.error("[medicoes-contrato] SUPABASE_URL ou chave da API não configurada.");
    return jsonResponse({ message: "Serviço de medições não configurado." }, 500);
  }

  let payload: GenerateMeasurementsPayload;
  try {
    payload = (await request.json()) as GenerateMeasurementsPayload;
  } catch {
    payload = {};
  }

  const startedAt = Date.now();
  const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/gerar_medicoes_contrato`, {
    method: "POST",
    headers: {
      apikey: apiKey,
      Authorization: authorization,
      "Content-Type": "application/json",
      "Content-Profile": "apticket",
    },
    body: JSON.stringify({
      p_contrato_id: payload.contrato_id ?? null,
      p_competencia: payload.competencia ?? new Date().toISOString().slice(0, 10),
      p_forcar: payload.forcar ?? false,
    }),
  });

  const result = await rpcResponse.json().catch(() => ({
    message: "Resposta inválida do banco de dados.",
  }));

  if (!rpcResponse.ok) {
    console.error("[medicoes-contrato] Falha na geração", {
      status: rpcResponse.status,
      contratoId: payload.contrato_id ?? null,
      agendado: payload.agendado ?? false,
      durationMs: Date.now() - startedAt,
      result,
    });
    return jsonResponse(result, rpcResponse.status);
  }

  console.info("[medicoes-contrato] Geração concluída", {
    contratoId: payload.contrato_id ?? null,
    agendado: payload.agendado ?? false,
    durationMs: Date.now() - startedAt,
    result,
  });

  return jsonResponse(result);
});
