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

// Endpoint interno. O JWT recebido é validado pelo PostgREST e o RPC só tem
// EXECUTE para service_role. Nunca elevar uma chamada usando a chave de serviço.
export function createHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return json({ message: "Método não permitido." }, 405);
    }
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ") || authorization.length <= 7) {
      return json({ message: "Autenticação obrigatória." }, 401);
    }
    if (!deps.supabaseUrl || !deps.apiKey) {
      return json({ message: "Serviço não configurado." }, 503);
    }
    let payload: Record<string, unknown>;
    try {
      const body: unknown = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new Error("Invalid object");
      }
      payload = body as Record<string, unknown>;
    } catch {
      return json({ message: "Envie um objeto JSON válido." }, 400);
    }
    if (
      Object.keys(payload).some((key) =>
        !["contract_id", "as_of", "limit"].includes(key)
      )
    ) {
      return json({ message: "Parâmetro desconhecido." }, 400);
    }
    if (
      payload.contract_id !== undefined &&
      (typeof payload.contract_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          payload.contract_id,
        ))
    ) {
      return json({ message: "Contrato inválido." }, 400);
    }
    if (
      payload.as_of !== undefined && (typeof payload.as_of !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(payload.as_of) ||
        !Number.isFinite(Date.parse(payload.as_of)) ||
        new Date(payload.as_of).toISOString().slice(0, 10) !== payload.as_of)
    ) {
      return json({ message: "Data inválida. Use AAAA-MM-DD." }, 400);
    }
    if (
      payload.limit !== undefined &&
      (!Number.isInteger(payload.limit) || Number(payload.limit) < 1 ||
        Number(payload.limit) > 100)
    ) {
      return json({ message: "O limite deve estar entre 1 e 100." }, 400);
    }
    try {
      const response = await deps.fetch(
        `${deps.supabaseUrl}/rest/v1/rpc/close_billing_cycles`,
        {
          method: "POST",
          headers: {
            apikey: deps.apiKey,
            Authorization: authorization,
            "Content-Type": "application/json",
            "Content-Profile": "apticket",
          },
          body: JSON.stringify({
            p_contract_id: payload.contract_id ?? null,
            p_as_of: payload.as_of ?? null,
            p_limit: payload.limit ?? 50,
          }),
          signal: AbortSignal.timeout(45_000),
        },
      );
      if (!response.ok) {
        const status = response.status === 401 || response.status === 403
          ? response.status
          : 502;
        return json({
          message: status < 500
            ? "Sem autorização para fechar ciclos."
            : "Falha no fechamento. Consulte os logs do serviço.",
        }, status);
      }
      const result = await response.json();
      if (
        !result || !Number.isInteger(result.generated) ||
        !Array.isArray(result.errors)
      ) {
        return json(
          { message: "Resposta inválida do serviço financeiro." },
          502,
        );
      }
      // Falha parcial retorna 409 e os ciclos anteriores permanecem íntegros.
      // Retry é seguro: o banco identifica os ciclos já fechados.
      return json(result, result.errors.length ? 409 : 200);
    } catch {
      return json({
        message:
          "Serviço financeiro indisponível. A execução pode ser repetida com segurança.",
      }, 503);
    }
  };
}
