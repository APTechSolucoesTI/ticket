const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ message: "Método não permitido." }, 405);
  const authorization = request.headers.get("Authorization");
  const apiKey = request.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  if (!authorization?.startsWith("Bearer ")) return json({ message: "Autenticação obrigatória." }, 401);
  if (!apiKey || !url) return json({ message: "Integração financeira não configurada." }, 500);
  let eventId = "";
  try { eventId = String((await request.json())?.event_id ?? ""); } catch { return json({ message: "JSON inválido." }, 400); }
  if (!uuid.test(eventId)) return json({ message: "Evento financeiro inválido." }, 422);
  const response = await fetch(`${url}/rest/v1/rpc/integrate_employee_financial_event`, {
    method: "POST",
    headers: { apikey: apiKey, Authorization: authorization, "Content-Type": "application/json", "Content-Profile": "apticket" },
    body: JSON.stringify({ p_event_id: eventId }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    return json({ message: error.message ?? "Não foi possível integrar o lançamento.", code: error.code }, response.status === 403 ? 403 : 422);
  }
  const payableId = await response.json();
  if (!payableId) return json({ message: "O lançamento não foi criado. Revise os dados bancários, a categoria e o centro de custo." }, 422);
  return json({ payable_id: payableId }, 201);
});
