type HttpClient = { close(): void };
type Dependencies = {
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
  fetch: typeof fetch;
  createClient: (certificate: string, key: string) => HttpClient;
  now?: () => number;
};

type Prepared = {
  state: "dispatching" | "submitted" | "uncertain";
  request_id: string;
  attempt_id?: string;
  actor_id?: string;
  bank_request_id?: string | null;
  reused: boolean;
};

type Dispatch = {
  attempt_id: string;
  actor_id: string;
  environment: "sandbox" | "production";
  account: string;
  token_cache_key: string;
  credentials: {
    client_id: string;
    client_secret: string;
    certificate: string;
    private_key: string;
  };
  charge: Record<string, unknown>;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bankHosts = {
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
const fail = (message: string, status: number, state?: string) =>
  json({ ok: false, state, message }, status);

export function createHandler(deps: Dependencies) {
  const tokens = new Map<string, { value: string; expiresAt: number }>();
  const now = deps.now ?? Date.now;

  function rpc(
    name: string,
    body: Record<string, unknown>,
    authorization: string,
    apiKey: string,
    timeout = 15_000,
  ) {
    return deps.fetch(`${deps.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: apiKey,
        Authorization: authorization,
        "Content-Type": "application/json",
        "Content-Profile": "apticket",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
      redirect: "error",
    });
  }

  async function finish(
    attempt: string,
    outcome: "submitted" | "uncertain" | "failed",
    options: {
      bankRequest?: string | null;
      httpStatus?: number | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    } = {},
  ) {
    const response = await rpc(
      "finish_inter_charge_dispatch",
      {
        p_attempt: attempt,
        p_outcome: outcome,
        p_bank_request: options.bankRequest ?? null,
        p_http_status: options.httpStatus ?? null,
        p_error_code: options.errorCode ?? null,
        p_error_message: options.errorMessage ?? null,
      },
      `Bearer ${deps.serviceKey}`,
      deps.serviceKey,
    );
    if (!response.ok) throw new Error("FINALIZE_FAILED");
    return response.json();
  }

  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return fail("Método não permitido.", 405);
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ") || authorization.length <= 7) {
      return fail("Sessão obrigatória.", 401);
    }
    if (!deps.supabaseUrl || !deps.anonKey || !deps.serviceKey) {
      return fail("Serviço de emissão não configurado.", 503);
    }

    let input: {
      request_id: string;
      confirmed: true;
      production_confirmed: boolean;
    };
    try {
      const body = await request.json();
      if (
        !body ||
        Object.keys(body).some(
          (key) =>
            !["request_id", "confirmed", "production_confirmed"].includes(key),
        ) ||
        !uuid.test(body.request_id) ||
        body.confirmed !== true ||
        typeof body.production_confirmed !== "boolean"
      ) {
        throw new Error("INVALID_INPUT");
      }
      input = body;
    } catch {
      return fail("Confirme uma solicitação válida antes da emissão.", 400);
    }

    let prepared: Prepared;
    try {
      const response = await rpc(
        "prepare_inter_charge_dispatch",
        {
          p_request: input.request_id,
          p_confirmed: true,
          p_production_confirmed: input.production_confirmed,
        },
        authorization,
        deps.anonKey,
      );
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const mapped: Record<string, [string, number]> = {
          "42501": ["Sem permissão para emitir esta cobrança.", 403],
          "23514": [
            "Revise e confirme novamente o pagador e o vínculo bancário.",
            409,
          ],
          P0001: [
            "Ative a configuração oficial e registre o webhook antes da primeira emissão.",
            409,
          ],
          "54000": [
            "Aguarde antes de tentar novamente ou revise o histórico de tentativas.",
            429,
          ],
          "22023": ["Confirmação explícita obrigatória.", 422],
        };
        const [message, status] = mapped[error.code] ?? [
          "Não foi possível iniciar a emissão.",
          502,
        ];
        return fail(message, status);
      }
      prepared = await response.json();
    } catch {
      return fail(
        "Serviço financeiro indisponível antes do envio ao banco. Tente novamente.",
        503,
      );
    }

    if (
      !prepared ||
      !uuid.test(prepared.request_id) ||
      !["dispatching", "submitted", "uncertain"].includes(prepared.state) ||
      typeof prepared.reused !== "boolean"
    ) {
      return fail("Resposta inválida da preparação da emissão.", 502);
    }
    if (prepared.reused) {
      const messages = {
        dispatching:
          "A emissão já está em processamento. Atualize a consulta em instantes.",
        submitted: "A solicitação já foi aceita pelo Inter.",
        uncertain:
          "O resultado do envio anterior é incerto. O sistema não repetirá a emissão automaticamente.",
      };
      return json(
        {
          ok: prepared.state === "submitted",
          state: prepared.state,
          bank_request_id: prepared.bank_request_id ?? null,
          reused: true,
          message: messages[prepared.state],
        },
        prepared.state === "submitted" ? 200 : 202,
      );
    }
    if (
      !prepared.attempt_id ||
      !prepared.actor_id ||
      !uuid.test(prepared.attempt_id) ||
      !uuid.test(prepared.actor_id)
    ) {
      return fail("Tentativa de emissão inválida.", 502);
    }

    const attempt = prepared.attempt_id;
    let client: HttpClient | undefined;
    let postStarted = false;
    let phase: "load" | "mtls" | "oauth" | "bank" | "finish" = "load";
    try {
      const loaded = await rpc(
        "load_inter_charge_dispatch",
        { p_attempt: attempt, p_actor: prepared.actor_id },
        `Bearer ${deps.serviceKey}`,
        deps.serviceKey,
      );
      if (!loaded.ok) {
        await finish(attempt, "failed", {
          httpStatus: loaded.status,
          errorCode: "DISPATCH_INVALID",
          errorMessage:
            "A configuração ou o snapshot deixou de ser válido antes do envio.",
        });
        return fail(
          "Configuração bancária ou pagador inválido. Revise os dados antes de tentar novamente.",
          409,
          "failed",
        );
      }
      const dispatch = (await loaded.json()) as Dispatch;
      if (
        !dispatch ||
        !["sandbox", "production"].includes(dispatch.environment) ||
        dispatch.attempt_id !== attempt ||
        !/^\d{1,20}$/.test(dispatch.account) ||
        typeof dispatch.token_cache_key !== "string" ||
        !dispatch.charge ||
        !dispatch.credentials
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
              grant_type: "client_credentials",
              client_id: dispatch.credentials.client_id,
              client_secret: dispatch.credentials.client_secret,
              scope: "boleto-cobranca.write boleto-cobranca.read",
            }),
            client,
            redirect: "error",
            // Finaliza antes do limite do runtime para registrar um erro preciso
            // e manter a próxima tentativa segura.
            signal: AbortSignal.timeout(12_000),
          } as RequestInit,
        );
        if (!tokenResponse.ok) {
          await tokenResponse.body?.cancel();
          await finish(attempt, "failed", {
            httpStatus: tokenResponse.status,
            errorCode: `OAUTH_${tokenResponse.status}`,
            errorMessage: tokenResponse.status === 429
              ? "O Inter limitou a autenticação. Aguarde antes de tentar novamente."
              : "O Inter recusou a autenticação ou os escopos de cobrança.",
          });
          return fail(
            tokenResponse.status === 429
              ? "O Inter limitou as tentativas. Aguarde antes de tentar novamente."
              : "O Inter recusou a autenticação. Confira credenciais, certificado e permissões de cobrança.",
            tokenResponse.status === 429 ? 429 : 502,
            "failed",
          );
        }
        const token = await tokenResponse.json();
        if (
          typeof token.access_token !== "string" ||
          !token.access_token ||
          String(token.token_type).toLowerCase() !== "bearer" ||
          !(Number(token.expires_in) > 0)
        ) {
          throw new Error("INVALID_TOKEN");
        }
        accessToken = {
          value: token.access_token,
          expiresAt: now() + Number(token.expires_in) * 1000,
        };
        tokens.set(dispatch.token_cache_key, accessToken);
      }

      phase = "bank";
      postStarted = true;
      const bank = await deps.fetch(
        `${bankHosts[dispatch.environment]}/cobranca/v3/cobrancas`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken.value}`,
            "Content-Type": "application/json",
            "x-conta-corrente": dispatch.account,
          },
          body: JSON.stringify(dispatch.charge),
          client,
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        } as RequestInit,
      );
      if (!bank.ok) {
        await bank.body?.cancel();
        const uncertain = bank.status >= 500;
        await finish(attempt, uncertain ? "uncertain" : "failed", {
          httpStatus: bank.status,
          errorCode: `INTER_${bank.status}`,
          errorMessage: uncertain
            ? "O Inter respondeu com indisponibilidade após o início do envio; não repetir automaticamente."
            : "O Inter recusou os dados ou a autorização da cobrança.",
        });
        return fail(
          uncertain
            ? "O Inter ficou indisponível e o resultado é incerto. A emissão não será repetida automaticamente."
            : "O Inter recusou a cobrança. Revise a configuração e os dados do pagador.",
          uncertain ? 202 : bank.status === 429 ? 429 : 422,
          uncertain ? "uncertain" : "failed",
        );
      }
      const bankResult = await bank.json().catch(() => null);
      if (
        !bankResult ||
        typeof bankResult.codigoSolicitacao !== "string" ||
        !uuid.test(bankResult.codigoSolicitacao)
      ) {
        await finish(attempt, "uncertain", {
          httpStatus: bank.status,
          errorCode: "INTER_INVALID_RESPONSE",
          errorMessage:
            "O Inter aceitou a chamada, mas não retornou um identificador válido.",
        });
        return fail(
          "Resposta bancária incompleta. O resultado será tratado como incerto e não será reenviado.",
          202,
          "uncertain",
        );
      }
      phase = "finish";
      const result = await finish(attempt, "submitted", {
        bankRequest: bankResult.codigoSolicitacao,
        httpStatus: bank.status,
      });
      return json({
        ok: true,
        state: "submitted",
        bank_request_id: bankResult.codigoSolicitacao,
        reused: result.reused === true,
        message:
          "Solicitação aceita pelo Inter e aguardando processamento assíncrono.",
      });
    } catch {
      const oauthFailure = !postStarted && phase === "oauth";
      const mtlsFailure = !postStarted && phase === "mtls";
      try {
        await finish(attempt, postStarted ? "uncertain" : "failed", {
          errorCode: postStarted
            ? "NETWORK_UNCERTAIN"
            : oauthFailure
            ? "OAUTH_CONNECTION_FAILURE"
            : mtlsFailure
            ? "MTLS_CONFIGURATION_FAILURE"
            : "PRE_SEND_FAILURE",
          errorMessage: postStarted
            ? "A conexão terminou sem confirmação após o início do envio; não repetir automaticamente."
            : oauthFailure
            ? "O OAuth do Inter não respondeu antes do limite seguro."
            : mtlsFailure
            ? "Não foi possível iniciar a conexão mTLS com o certificado configurado."
            : "Falha segura antes de iniciar o envio bancário.",
        });
      } catch {
        // A tentativa permanece em dispatching; a lease expirada será convertida
        // em uncertain pelo banco antes de qualquer nova tentativa.
      }
      return fail(
        postStarted
          ? "A conexão terminou sem confirmação. O resultado é incerto e a emissão não será repetida automaticamente."
          : oauthFailure
          ? "O Inter não respondeu à autenticação. Confira se Client ID, Client Secret e certificado pertencem à mesma integração e se a API de Cobrança está habilitada."
          : mtlsFailure
          ? "Não foi possível usar o certificado deste ambiente. Revise o certificado e a chave privada configurados."
          : "Falha antes do envio ao banco. Atualize a consulta e tente novamente.",
        postStarted ? 202 : 503,
        postStarted ? "uncertain" : "failed",
      );
    } finally {
      client?.close();
    }
  };
}
