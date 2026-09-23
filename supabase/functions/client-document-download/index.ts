const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ message: "Método não permitido." }, 405);

  const authorization = request.headers.get("Authorization");
  const token = authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const baseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apiKey = request.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!authorization) return json({ message: "Autenticação obrigatória." }, 401);
  if (!baseUrl || !serviceKey || !apiKey) return json({ message: "Storage não configurado." }, 500);

  let body: { document_id?: string; contact_id?: string; tenant_id?: string };
  try {
    body = await request.json();
  } catch {
    return json({ message: "JSON inválido." }, 400);
  }
  if (!body.document_id || !UUID.test(body.document_id)) {
    return json({ message: "Documento inválido." }, 422);
  }

  const isPortalProxy = token === serviceKey;
  const serviceHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    "Content-Profile": "apticket",
    "Accept-Profile": "apticket",
  };
  let document:
    | { id: string; tenant_id: string; company_id: string; file_path: string; file_name: string }
    | undefined;

  if (isPortalProxy) {
    if (
      !body.contact_id ||
      !body.tenant_id ||
      !UUID.test(body.contact_id) ||
      !UUID.test(body.tenant_id)
    ) {
      return json({ message: "Contexto do portal inválido." }, 422);
    }
    const [contactResponse, documentResponse, companyLinksResponse] = await Promise.all([
      fetch(
        `${baseUrl}/rest/v1/contacts?id=eq.${body.contact_id}&tenant_id=eq.${body.tenant_id}&is_active=eq.true&is_portal_financial=eq.true&select=id,tenant_id,company_id&limit=1`,
        { headers: serviceHeaders },
      ),
      fetch(
        `${baseUrl}/rest/v1/client_documents?id=eq.${body.document_id}&tenant_id=eq.${body.tenant_id}&deleted_at=is.null&select=id,tenant_id,company_id,file_path,file_name&limit=1`,
        { headers: serviceHeaders },
      ),
      fetch(
        `${baseUrl}/rest/v1/contact_companies?contact_id=eq.${body.contact_id}&tenant_id=eq.${body.tenant_id}&select=company_id`,
        { headers: serviceHeaders },
      ),
    ]);
    const contact = (await contactResponse.json().catch(() => []))?.[0];
    document = (await documentResponse.json().catch(() => []))?.[0];
    const linkedCompanies = (await companyLinksResponse.json().catch(() => [])) as Array<{
      company_id: string;
    }>;
    const allowedCompanyIds = new Set([
      contact?.company_id,
      ...linkedCompanies.map((link) => link.company_id),
    ]);
    if (!contact || !document || !allowedCompanyIds.has(document.company_id)) {
      return json({ message: "Documento não encontrado." }, 404);
    }
  } else {
    const staffHeaders = {
      apikey: apiKey,
      Authorization: authorization,
      "Content-Type": "application/json",
      "Accept-Profile": "apticket",
    };
    const response = await fetch(
      `${baseUrl}/rest/v1/client_documents?id=eq.${body.document_id}&deleted_at=is.null&select=id,tenant_id,company_id,file_path,file_name&limit=1`,
      { headers: staffHeaders },
    );
    document = (await response.json().catch(() => []))?.[0];
    if (!response.ok || !document)
      return json({ message: "Documento não encontrado ou sem permissão." }, 404);
  }

  const encodedPath = document.file_path.split("/").map(encodeURIComponent).join("/");
  const signResponse = await fetch(
    `${baseUrl}/storage/v1/object/sign/client-documents/${encodedPath}`,
    {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 60 }),
    },
  );
  const signed = await signResponse.json().catch(() => ({}));
  if (!signResponse.ok || !signed.signedURL) {
    return json({ message: "Não foi possível gerar o link seguro." }, 502);
  }

  if (isPortalProxy) {
    const logResponse = await fetch(`${baseUrl}/rest/v1/document_downloads`, {
      method: "POST",
      headers: serviceHeaders,
      body: JSON.stringify({
        tenant_id: document.tenant_id,
        document_id: document.id,
        contact_id: body.contact_id,
      }),
    });
    if (!logResponse.ok) return json({ message: "Não foi possível auditar o download." }, 500);
  }

  const signedUrl = signed.signedURL.startsWith("http")
    ? signed.signedURL
    : `${baseUrl}/storage/v1${signed.signedURL}`;
  return json({ url: signedUrl, file_name: document.file_name, expires_in: 60 });
});
