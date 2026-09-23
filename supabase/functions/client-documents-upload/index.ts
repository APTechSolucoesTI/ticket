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

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])-01$/;
const documentTypes = new Set(["medicao", "fatura", "nfse", "boleto", "outro"]);
const fileTypes: Record<string, Set<string>> = {
  pdf: new Set(["application/pdf"]),
  xls: new Set(["application/vnd.ms-excel", "application/octet-stream"]),
  xlsx: new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
  ]),
  xml: new Set(["application/xml", "text/xml", "application/octet-stream", ""]),
};

function jwtSubject(token: string): string | null {
  try {
    const segment = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(segment.padEnd(Math.ceil(segment.length / 4) * 4, "=")));
    return typeof payload.sub === "string" && UUID.test(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}

function storageObjectUrl(baseUrl: string, path: string) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl}/storage/v1/object/client-documents/${encodedPath}`;
}

async function cleanup(baseUrl: string, serviceKey: string, paths: string[]) {
  await Promise.allSettled(
    paths.map((path) =>
      fetch(storageObjectUrl(baseUrl, path), {
        method: "DELETE",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      }),
    ),
  );
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ message: "Método não permitido." }, 405);

  const authorization = request.headers.get("Authorization");
  const userToken = authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const userId = jwtSubject(userToken);
  const baseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apiKey = request.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!authorization || !userId) return json({ message: "Autenticação obrigatória." }, 401);
  if (!baseUrl || !serviceKey || !apiKey) return json({ message: "Storage não configurado." }, 500);

  const restHeaders = {
    apikey: apiKey,
    Authorization: authorization,
    "Content-Type": "application/json",
    "Content-Profile": "apticket",
    "Accept-Profile": "apticket",
  };

  const permissionResponse = await fetch(`${baseUrl}/rest/v1/rpc/has_permission`, {
    method: "POST",
    headers: restHeaders,
    body: JSON.stringify({
      _user_id: userId,
      _module: "financeiro.disponibilizar_documentos",
      _action: "create",
    }),
  });
  if (!permissionResponse.ok || (await permissionResponse.json()) !== true) {
    return json({ message: "Sem permissão para disponibilizar documentos." }, 403);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ message: "Formulário de envio inválido." }, 400);
  }

  const companyId = String(form.get("company_id") ?? "");
  const competencia = String(form.get("competencia") ?? "");
  const documentType = String(form.get("document_type") ?? "");
  const historico = String(form.get("historico") ?? "").trim() || null;
  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (!UUID.test(companyId) || !COMPETENCIA.test(competencia) || !documentTypes.has(documentType)) {
    return json({ message: "Cliente, competência ou tipo de documento inválido." }, 422);
  }
  if (!files.length || files.length > MAX_FILES) {
    return json({ message: `Selecione entre 1 e ${MAX_FILES} arquivos.` }, 422);
  }

  for (const file of files) {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!fileTypes[extension]?.has(file.type) || file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return json(
        {
          message: `O arquivo ${file.name} é inválido. Use PDF, XLS, XLSX ou XML com até 10 MB.`,
        },
        422,
      );
    }
  }

  const [profileResponse, companyResponse] = await Promise.all([
    fetch(`${baseUrl}/rest/v1/profiles?id=eq.${userId}&select=tenant_id&limit=1`, {
      headers: restHeaders,
    }),
    fetch(`${baseUrl}/rest/v1/companies?id=eq.${companyId}&select=id,tenant_id&limit=1`, {
      headers: restHeaders,
    }),
  ]);
  const profile = (await profileResponse.json().catch(() => []))?.[0];
  const company = (await companyResponse.json().catch(() => []))?.[0];
  if (!profile?.tenant_id || company?.tenant_id !== profile.tenant_id) {
    return json({ message: "Cliente não encontrado nesta organização." }, 404);
  }

  const uploadedPaths: string[] = [];
  const metadata: Record<string, unknown>[] = [];
  for (const file of files) {
    const safeName = file.name
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .slice(-180);
    const path = `${profile.tenant_id}/${companyId}/${crypto.randomUUID()}-${safeName}`;
    const upload = await fetch(storageObjectUrl(baseUrl, path), {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": file.type || "application/octet-stream",
        "x-upsert": "false",
      },
      body: file,
    });
    if (!upload.ok) {
      await cleanup(baseUrl, serviceKey, uploadedPaths);
      return json({ message: `Não foi possível enviar ${file.name}.` }, 502);
    }
    uploadedPaths.push(path);
    metadata.push({
      tenant_id: profile.tenant_id,
      company_id: companyId,
      document_type: documentType,
      competencia,
      historico,
      file_name: file.name,
      file_path: path,
      file_size: file.size,
      mime_type: file.type || "application/octet-stream",
      uploaded_by: userId,
    });
  }

  const insertResponse = await fetch(`${baseUrl}/rest/v1/client_documents`, {
    method: "POST",
    headers: { ...restHeaders, Prefer: "return=representation" },
    body: JSON.stringify(metadata),
  });
  if (!insertResponse.ok) {
    await cleanup(baseUrl, serviceKey, uploadedPaths);
    const error = await insertResponse.json().catch(() => ({}));
    return json({ message: error.message ?? "Não foi possível registrar os documentos." }, 422);
  }

  return json({ documents: await insertResponse.json() }, 201);
});
