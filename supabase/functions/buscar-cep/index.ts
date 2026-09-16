const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ message: "Método não permitido." }, 405);
  if (!request.headers.get("Authorization")?.startsWith("Bearer ")) return json({ message: "Autenticação obrigatória." }, 401);
  let cep = "";
  try { cep = String((await request.json())?.cep ?? "").replace(/\D/g, ""); } catch { return json({ message: "JSON inválido." }, 400); }
  if (!/^\d{8}$/.test(cep)) return json({ message: "Informe um CEP com 8 dígitos." }, 422);
  try {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(7000) });
    if (!response.ok) return json({ message: "Serviço de CEP indisponível." }, 503);
    const result = await response.json();
    if (result.erro) return json({ message: "CEP não encontrado." }, 404);
    return json({ cep, logradouro: result.logradouro ?? "", complemento: result.complemento ?? "", bairro: result.bairro ?? "", cidade: result.localidade ?? "", uf: result.uf ?? "" });
  } catch {
    return json({ message: "Não foi possível consultar o CEP agora." }, 503);
  }
});
