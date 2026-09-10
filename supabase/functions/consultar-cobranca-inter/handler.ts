type HttpClient = { close(): void };

type Dependencies = {
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
  fetch: typeof fetch;
  createClient(certificate: string, key: string): HttpClient;
  now?: () => number;
};

type Prepared = {
  state: "syncing" | "synced";
  attempt_id?: string;
  actor_id?: string;
  request_id?: string;
  bank_status?: string | null;
  reused: boolean;
};

type Dispatch = {
  attempt_id: string;
  actor_id: string;
  environment: "sandbox" | "production";
  account: string;
  bank_request_id: string;
  token_cache_key: string;
  credentials: {
    client_id: string;
    client_secret: string;
    certificate: string;
    private_key: string;
  };
};

const bankHosts = {
  sandbox: "https://cdpj-sandbox.partners.uatinter.co",
  production: "https://cdpj.partners.bancointer.com.br",
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bankSituations = new Set([
  "RECEBIDO",
  "A_RECEBER",
  "MARCADO_RECEBIDO",
  "ATRASADO",
  "CANCELADO",
  "EXPIRADO",
  "FALHA_EMISSAO",
  "EM_PROCESSAMENTO",
  "PROTESTO",
]);
const tokens = new Map<string, { value: string; expiresAt: number }>();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const fail = (message: string, status: number) =>
  json({ ok: false, state: "failed", message }, status);

export function createHandler(deps: Dependencies) {
  const now = deps.now ?? Date.now;
  const rpc = (name: string, body: unknown, authorization: string) =>
    deps.fetch(`${deps.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: authorization === deps.serviceKey
          ? deps.serviceKey
          : deps.anonKey,
        Authorization: `Bearer ${authorization}`,
        "Content-Type": "application/json",
        "Content-Profile": "apticket",
      },
      body: JSON.stringify(body),
    });
  const finish = async (
    attempt: string,
    outcome: "synced" | "failed",
    options: {
      httpStatus?: number;
      errorCode?: string;
      errorMessage?: string;
      bankResult?: unknown;
    },
  ) => {
    const response = await rpc(
      "finish_inter_charge_sync",
      {
        p_attempt: attempt,
        p_outcome: outcome,
        p_http_status: options.httpStatus ?? null,
        p_error_code: options.errorCode ?? null,
        p_error_message: options.errorMessage ?? null,
        p_bank_result: options.bankResult ?? null,
      },
      deps.serviceKey,
    );
    if (!response.ok) throw new Error("FINISH_FAILED");
    return response.json();
  };

  return async (request: Request) => {
    if (request.method !== "POST") return fail("Método não permitido.", 405);
    const bearer =
      request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!bearer) return fail("Sessão obrigatória.", 401);
    let requestId = "";
    let webhookEventId = "";
    const internalWebhook = bearer === deps.serviceKey;
    try {
      const body = await request.json();
      const allowedKeys = internalWebhook
        ? ["request_id", "source", "event_id"]
        : ["request_id"];
      if (
        !body ||
        Object.keys(body).some((key) => !allowedKeys.includes(key)) ||
        !uuid.test(body.request_id) ||
        (internalWebhook &&
          (body.source !== "webhook" || !uuid.test(body.event_id)))
      ) {
        return fail("Informe uma cobrança válida para consulta.", 400);
      }
      requestId = body.request_id;
      webhookEventId = internalWebhook ? body.event_id : "";
    } catch {
      return fail("Informe uma cobrança válida para consulta.", 400);
    }

    let prepared: Prepared;
    try {
      const response = await rpc(
        internalWebhook
          ? "prepare_inter_charge_sync_from_webhook"
          : "prepare_inter_charge_sync",
        internalWebhook
          ? { p_request: requestId, p_event: webhookEventId }
          : { p_request: requestId },
        bearer,
      );
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const message = error.code === "42501"
          ? internalWebhook
            ? "Evento de webhook não autorizado."
            : "É necessário perfil Admin ou Financeiro com acesso de escrita à empresa."
          : error.code === "22023"
          ? "Somente uma cobrança aceita pelo Inter pode ser consultada."
          : "Não foi possível iniciar a consulta bancária.";
        return fail(message, error.code === "42501" ? 403 : 409);
      }
      prepared = await response.json();
    } catch {
      return fail("Serviço financeiro indisponível antes da consulta.", 503);
    }
    if (prepared.state === "synced") {
      return json({
        ok: true,
        state: "synced",
        bank_status: prepared.bank_status,
        reused: true,
      });
    }
    if (prepared.reused) {
      return json(
        {
          ok: true,
          state: "syncing",
          message: "A consulta já está em andamento.",
          reused: true,
        },
        202,
      );
    }
    if (
      !prepared.attempt_id ||
      !prepared.actor_id ||
      !uuid.test(prepared.attempt_id) ||
      !uuid.test(prepared.actor_id)
    ) {
      return fail("Tentativa de consulta inválida.", 502);
    }

    const attempt = prepared.attempt_id;
    let client: HttpClient | undefined;
    let phase: "load" | "mtls" | "oauth" | "bank" = "load";
    try {
      const loaded = await rpc(
        "load_inter_charge_sync",
        { p_attempt: attempt, p_actor: prepared.actor_id },
        deps.serviceKey,
      );
      if (!loaded.ok) throw new Error("LOAD_FAILED");
      const dispatch = (await loaded.json()) as Dispatch;
      if (
        !uuid.test(dispatch.bank_request_id) ||
        !["sandbox", "production"].includes(dispatch.environment) ||
        !dispatch.account ||
        !dispatch.credentials?.client_id ||
        !dispatch.credentials?.client_secret ||
        !dispatch.credentials?.certificate ||
        !dispatch.credentials?.private_key
      ) {
        throw new Error("INVALID_DISPATCH");
      }
      phase = "mtls";
      client = deps.createClient(
        dispatch.credentials.certificate,
        dispatch.credentials.private_key,
      );
      let accessToken = tokens.get(dispatch.token_cache_key);
      if (!accessToken || accessToken.expiresAt <= now() + 60_000) {
        phase = "oauth";
        const tokenResponse = await deps.fetch(
          `${bankHosts[dispatch.environment]}/oauth/v2/token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: dispatch.credentials.client_id,
              client_secret: dispatch.credentials.client_secret,
              grant_type: "client_credentials",
              scope: "boleto-cobranca.read",
            }),
            client,
            redirect: "error",
            signal: AbortSignal.timeout(12_000),
          } as RequestInit,
        );
        if (!tokenResponse.ok) {
          await tokenResponse.body?.cancel();
          await finish(attempt, "failed", {
            httpStatus: tokenResponse.status,
            errorCode: `OAUTH_${tokenResponse.status}`,
            errorMessage:
              "O Inter recusou a autenticação para consulta de cobrança.",
          });
          return fail("O Inter recusou a autenticação da consulta.", 502);
        }
        const token = await tokenResponse.json();
        if (typeof token?.access_token !== "string" || !token.access_token) {
          throw new Error("INVALID_TOKEN");
        }
        accessToken = {
          value: token.access_token,
          expiresAt: now() +
            Math.max(60, Number(token.expires_in) || 3600) * 1000,
        };
        tokens.set(dispatch.token_cache_key, accessToken);
      }

      phase = "bank";
      const response = await deps.fetch(
        `${bankHosts[dispatch.environment]}/cobranca/v3/cobrancas/${
          encodeURIComponent(
            dispatch.bank_request_id,
          )
        }`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken.value}`,
            "x-conta-corrente": dispatch.account,
            Accept: "application/json",
          },
          client,
          redirect: "error",
          signal: AbortSignal.timeout(12_000),
        } as RequestInit,
      );
      if (!response.ok) {
        await response.body?.cancel();
        await finish(attempt, "failed", {
          httpStatus: response.status,
          errorCode: `INTER_QUERY_${response.status}`,
          errorMessage: response.status === 404
            ? "Cobrança ainda não localizada pelo Inter."
            : "Consulta recusada pelo Inter.",
        });
        return fail(
          response.status === 404
            ? "A cobrança ainda não foi localizada pelo Inter. Aguarde e consulte novamente."
            : "O Inter não concluiu a consulta da cobrança.",
          response.status === 404 ? 404 : 502,
        );
      }
      const result = await response.json();
      const situation = result?.cobranca?.situacao;
      const bankRequest = result?.cobranca?.codigoSolicitacao;
      if (
        !bankSituations.has(situation) ||
        bankRequest !== dispatch.bank_request_id
      ) {
        throw new Error("INVALID_BANK_RESPONSE");
      }
      const bankResult = {
        codigo_solicitacao: bankRequest,
        situacao: situation,
        data_situacao: result.cobranca.dataSituacao ?? null,
        valor_total_recebido: result.cobranca.valorTotalRecebido ?? null,
        origem_recebimento: result.cobranca.origemRecebimento ?? null,
        nosso_numero: result.boleto?.nossoNumero ?? null,
        codigo_barras: result.boleto?.codigoBarras ?? null,
        linha_digitavel: result.boleto?.linhaDigitavel ?? null,
        txid: result.pix?.txid ?? null,
        pix_copia_cola: result.pix?.pixCopiaECola ?? null,
      };
      await finish(attempt, "synced", {
        httpStatus: response.status,
        bankResult,
      });
      return json({
        ok: true,
        state: "synced",
        bank_status: situation,
        message: "Situação da cobrança atualizada pelo Inter.",
        reused: false,
      });
    } catch {
      const errorCode = phase === "oauth"
        ? "OAUTH_CONNECTION_FAILURE"
        : phase === "mtls"
        ? "MTLS_CONFIGURATION_FAILURE"
        : phase === "bank"
        ? "INTER_QUERY_FAILURE"
        : "SYNC_PREPARE_FAILURE";
      try {
        await finish(attempt, "failed", {
          errorCode,
          errorMessage:
            "A consulta terminou sem alterar a cobrança financeira.",
        });
      } catch {
        // A lease expirada será encerrada pela próxima consulta.
      }
      return fail(
        phase === "oauth"
          ? "O Inter não respondeu à autenticação de homologação."
          : "A consulta bancária não pôde ser concluída. Nenhum dado financeiro foi alterado.",
        503,
      );
    } finally {
      client?.close();
    }
  };
}
