type HttpClient = { close(): void };

type Dependencies = {
  supabaseUrl: string;
  serviceKey: string;
  fetch: typeof fetch;
  createClient(certificate: string, key: string): HttpClient;
};

type Prepared = {
  attempt_id: string;
  environment: "sandbox" | "production";
  account: string;
  callback_url: string;
  candidate_token: string;
  credentials: {
    client_id: string;
    client_secret: string;
    certificate: string;
    private_key: string;
  };
};

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tokenPattern = /^[0-9a-f]{64}$/;
const hosts = {
  sandbox: "https://cdpj-sandbox.partners.uatinter.co",
  production: "https://cdpj.partners.bancointer.com.br",
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

export function createHandler(deps: Dependencies) {
  const rpc = (name: string, body: unknown) =>
    deps.fetch(`${deps.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: deps.serviceKey,
        Authorization: `Bearer ${deps.serviceKey}`,
        "Content-Type": "application/json",
        "Content-Profile": "apticket",
      },
      body: JSON.stringify(body),
    });
  const finish = async (
    attempt: string,
    outcome: "registered" | "failed",
    options: {
      httpStatus?: number;
      errorCode?: string;
      errorMessage?: string;
      candidateToken?: string;
    },
  ) => {
    const response = await rpc("finish_inter_webhook_registration", {
      p_attempt: attempt,
      p_outcome: outcome,
      p_http_status: options.httpStatus ?? null,
      p_error_code: options.errorCode ?? null,
      p_error_message: options.errorMessage ?? null,
      p_candidate_token: options.candidateToken ?? null,
    });
    if (!response.ok) throw new Error("FINISH_FAILED");
    return response.json();
  };

  return async (request: Request) => {
    if (request.method !== "POST") return fail("Método não permitido.", 405);
    if (
      !deps.serviceKey ||
      request.headers.get("Authorization") !== `Bearer ${deps.serviceKey}`
    ) {
      return fail("Autenticação do serviço obrigatória.", 401);
    }
    let body: {
      actor: string;
      tenant: string;
      environment: "sandbox" | "production";
      version: number;
      callback_base_url: string;
    };
    try {
      body = await request.json();
      if (
        !body ||
        Object.keys(body).some(
          (key) =>
            !["actor", "tenant", "environment", "version", "callback_base_url"]
              .includes(key),
        ) ||
        !uuid.test(body.actor) ||
        !uuid.test(body.tenant) ||
        !["sandbox", "production"].includes(body.environment) ||
        !Number.isInteger(body.version) ||
        body.version < 1 ||
        typeof body.callback_base_url !== "string" ||
        body.callback_base_url.length > 500 ||
        !/^https:\/\/[^?#]+$/.test(body.callback_base_url)
      ) {
        return fail("Configuração de webhook inválida.", 400);
      }
    } catch {
      return fail("JSON inválido.", 400);
    }

    let attempt = "";
    let candidateToken = "";
    let client: HttpClient | undefined;
    let phase: "prepare" | "mtls" | "oauth" | "bank" = "prepare";
    try {
      const preparedResponse = await rpc("prepare_inter_webhook_registration", {
        p_actor: body.actor,
        p_tenant: body.tenant,
        p_environment: body.environment,
        p_version: body.version,
        p_callback_base_url: body.callback_base_url,
      });
      if (!preparedResponse.ok) {
        const error = await preparedResponse.json().catch(() => ({}));
        const errors: Record<string, [string, number]> = {
          "42501": [
            "É necessário perfil Admin ou Financeiro para configurar o webhook.",
            403,
          ],
          "40001": [
            "A configuração bancária mudou. Atualize a página e tente novamente.",
            409,
          ],
          "54000": ["Já existe uma configuração de webhook em andamento.", 429],
          P0002: [
            "Salve as credenciais deste ambiente antes de configurar o webhook.",
            409,
          ],
          "22023": [
            "Revise as credenciais, o certificado e a URL pública do sistema.",
            422,
          ],
        };
        const [message, status] = errors[error.code] ?? [
          "Não foi possível preparar a configuração do webhook.",
          503,
        ];
        return fail(message, status);
      }
      const prepared = (await preparedResponse.json()) as Prepared;
      attempt = prepared.attempt_id;
      candidateToken = prepared.candidate_token;
      if (
        !uuid.test(attempt) ||
        !tokenPattern.test(candidateToken) ||
        prepared.environment !== body.environment ||
        !prepared.account ||
        !prepared.callback_url.startsWith(`${body.callback_base_url}?token=`) ||
        !prepared.credentials?.client_id ||
        !prepared.credentials?.client_secret ||
        !prepared.credentials?.certificate ||
        !prepared.credentials?.private_key
      ) {
        throw new Error("INVALID_PREPARED_DATA");
      }
      phase = "mtls";
      client = deps.createClient(
        prepared.credentials.certificate,
        prepared.credentials.private_key,
      );
      phase = "oauth";
      const tokenResponse = await deps.fetch(
        `${hosts[body.environment]}/oauth/v2/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: prepared.credentials.client_id,
            client_secret: prepared.credentials.client_secret,
            grant_type: "client_credentials",
            scope: "boleto-cobranca.write",
          }),
          client,
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        } as RequestInit,
      );
      if (!tokenResponse.ok) {
        await tokenResponse.body?.cancel();
        await finish(attempt, "failed", {
          httpStatus: tokenResponse.status,
          errorCode: `OAUTH_${tokenResponse.status}`,
          errorMessage:
            "O Inter recusou a autenticação para configurar o webhook.",
        });
        return fail("O Inter recusou a autenticação do webhook.", 502);
      }
      const token = await tokenResponse.json();
      if (typeof token?.access_token !== "string" || !token.access_token) {
        throw new Error("INVALID_TOKEN");
      }
      phase = "bank";
      const bankResponse = await deps.fetch(
        `${hosts[body.environment]}/cobranca/v3/cobrancas/webhook`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token.access_token}`,
            "x-conta-corrente": prepared.account,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ webhookUrl: prepared.callback_url }),
          client,
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        } as RequestInit,
      );
      if (!bankResponse.ok) {
        await bankResponse.body?.cancel();
        await finish(attempt, "failed", {
          httpStatus: bankResponse.status,
          errorCode: `INTER_WEBHOOK_${bankResponse.status}`,
          errorMessage: "O Inter não aceitou a configuração do webhook.",
        });
        return fail("O Inter não aceitou a configuração do webhook.", 502);
      }
      await bankResponse.body?.cancel();
      await finish(attempt, "registered", {
        httpStatus: bankResponse.status,
        candidateToken,
      });
      return json({
        ok: true,
        state: "registered",
        message: `Webhook de ${
          body.environment === "sandbox" ? "homologação" : "produção"
        } configurado no Inter.`,
      });
    } catch {
      if (attempt) {
        try {
          await finish(attempt, "failed", {
            errorCode: phase === "oauth"
              ? "OAUTH_CONNECTION_FAILURE"
              : phase === "mtls"
              ? "MTLS_CONFIGURATION_FAILURE"
              : phase === "bank"
              ? "INTER_WEBHOOK_FAILURE"
              : "WEBHOOK_PREPARE_FAILURE",
            errorMessage: "A configuração do webhook não foi concluída.",
          });
        } catch {
          // A tentativa expirada será encerrada na próxima configuração.
        }
      }
      return fail(
        phase === "oauth"
          ? "O Inter não respondeu à autenticação do webhook."
          : "A configuração do webhook não pôde ser concluída.",
        503,
      );
    } finally {
      client?.close();
    }
  };
}
