type Dependencies = {
  supabaseUrl: string;
  serviceKey: string;
  fetch: typeof fetch;
  createClient: (certificate: string, key: string) => { close(): void };
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
const fail = (message: string, status: number) =>
  json({ ok: false, message }, status);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hosts = {
  sandbox: "https://cdpj-sandbox.partners.uatinter.co",
  production: "https://cdpj.partners.bancointer.com.br",
};

export function createHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return fail("Método não permitido.", 405);
    // Internal endpoint: no user bearer can upgrade itself to service role.
    if (
      !deps.serviceKey ||
      request.headers.get("Authorization") !== `Bearer ${deps.serviceKey}`
    ) {
      return fail("Autenticação do serviço obrigatória.", 401);
    }
    let body;
    try {
      body = await request.json();
      if (
        !body || Object.keys(body).some((k) =>
          !["actor", "tenant", "environment", "version"].includes(k)
        ) ||
        !uuid.test(body.actor) || !uuid.test(body.tenant) ||
        !["sandbox", "production"].includes(body.environment) ||
        !Number.isInteger(body.version) || body.version < 1
      ) {
        return fail("Configuração inválida.", 400);
      }
    } catch {
      return fail("JSON inválido.", 400);
    }
    let client: { close(): void } | undefined;
    try {
      const prepared = await deps.fetch(
        `${deps.supabaseUrl}/rest/v1/rpc/prepare_inter_connection_test`,
        {
          method: "POST",
          headers: {
            apikey: deps.serviceKey,
            Authorization: `Bearer ${deps.serviceKey}`,
            "Content-Type": "application/json",
            "Content-Profile": "apticket",
          },
          body: JSON.stringify({
            p_actor: body.actor,
            p_tenant: body.tenant,
            p_environment: body.environment,
            p_version: body.version,
          }),
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        },
      );
      if (!prepared.ok) {
        const error = await prepared.json();
        const errors: Record<string, [string, number]> = {
          "42501": [
            "Sem permissão para testar a configuração deste tenant.",
            403,
          ],
          "40001": [
            "Configuração alterada. Atualize a página antes de testar.",
            409,
          ],
          "P0002": [
            "Salve as credenciais deste ambiente antes de testar.",
            409,
          ],
          "22023": ["Revise as credenciais e a validade do certificado.", 422],
          "54000": ["Aguarde um minuto antes de testar novamente.", 429],
        };
        const [message, status] = errors[error.code] ??
          ["Não foi possível acessar a configuração bancária.", 503];
        return fail(message, status);
      }
      const credentials = await prepared.json();
      client = deps.createClient(
        credentials.certificate,
        credentials.private_key,
      );
      const response = await deps.fetch(
        `${hosts[body.environment as keyof typeof hosts]}/oauth/v2/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: credentials.client_id,
            client_secret: credentials.client_secret,
            scope: "boleto-cobranca.read",
          }),
          client,
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        } as RequestInit,
      );
      if (!response.ok) {
        await response.body?.cancel(); // Never return/log bank bodies or credentials.
        if (response.status === 429) {
          return fail(
            "O Inter limitou as tentativas. Aguarde e tente novamente.",
            429,
          );
        }
        return fail(
          response.status < 500
            ? "O Inter recusou a autenticação. Confira o ambiente, Client ID, Client Secret, certificado e a permissão boleto-cobranca.read."
            : "O Inter está indisponível. Tente novamente mais tarde.",
          502,
        );
      }
      const token = await response.json();
      if (
        typeof token.access_token !== "string" || !token.access_token ||
        String(token.token_type).toLowerCase() !== "bearer" ||
        !(Number(token.expires_in) > 0)
      ) {
        return fail(
          "O Inter retornou uma resposta de autenticação inválida.",
          502,
        );
      }
      // Diagnostic only: discard token; future billing worker must implement token reuse.
      return json({
        ok: true,
        message:
          "Autenticação com o Inter confirmada. Este teste não valida a conta corrente nem emite cobranças.",
      });
    } catch {
      return fail(
        "Não foi possível autenticar no Inter. Verifique o certificado e a chave privada; se estiverem corretos, tente novamente mais tarde.",
        503,
      );
    } finally {
      client?.close();
    }
  };
}
