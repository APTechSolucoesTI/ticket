type Dependencies = {
  supabaseUrl: string;
  apiKey: string;
  fetch: typeof fetch;
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
export function createHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return json({ message: "Método não permitido." }, 405);
    }
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ") || authorization.length <= 7) {
      return json({ message: "Sessão obrigatória." }, 401);
    }
    let body;
    try {
      body = await request.json();
      if (
        !body || Object.keys(body).some((k) =>
          !["receivable_id", "environment"].includes(k)
        ) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          body.receivable_id,
        ) ||
        !["sandbox", "production"].includes(body.environment)
      ) {
        return json({ message: "Informe recebível e ambiente válidos." }, 400);
      }
    } catch {
      return json({ message: "JSON inválido." }, 400);
    }
    try {
      const response = await deps.fetch(
        `${deps.supabaseUrl}/rest/v1/rpc/prepare_inter_charge`,
        {
          method: "POST",
          headers: {
            apikey: deps.apiKey,
            Authorization: authorization,
            "Content-Type": "application/json",
            "Content-Profile": "apticket",
          },
          body: JSON.stringify({
            p_receivable: body.receivable_id,
            p_environment: body.environment,
          }),
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        },
      );
      if (!response.ok) {
        const error = await response.json();
        if (response.status === 401 || error.code === "42501") {
          return json({
            message: "Sessão inválida ou sem permissão para este recebível.",
          }, 403);
        }
        if (error.code === "40001") {
          return json({
            message:
              "O recebível mudou após a preparação. Solicite revisão antes da emissão.",
          }, 409);
        }
        if (error.code === "23514") {
          return json({
            message:
              "Prepare apenas contas de medições aprovadas ou ciclos recorrentes a faturar, sem baixa parcial e com saldo positivo.",
          }, 422);
        }
        return json({ message: "Não foi possível preparar a cobrança." }, 502);
      }
      const result = await response.json();
      if (
        !result?.id || result.status !== "blocked_homologation" ||
        typeof result.reused !== "boolean"
      ) {
        return json({ message: "Resposta inválida da preparação." }, 502);
      }
      return json({
        id: result.id,
        status: result.status,
        reused: result.reused,
        message:
          "Solicitação registrada e bloqueada até a homologação. Nenhuma cobrança foi enviada ao Inter.",
      });
    } catch {
      return json({
        message:
          "Serviço indisponível. Repetir a preparação não duplica a solicitação.",
      }, 503);
    }
  };
}
