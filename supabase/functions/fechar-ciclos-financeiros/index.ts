import { createHandler } from "./handler.ts";

const handler = createHandler({
  supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
  apiKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  fetch,
});

Deno.serve(async (request) => {
  const startedAt = Date.now();
  const response = await handler(request);
  const result = await response.clone().json().catch(() => ({}));
  console.info("[fechar-ciclos-financeiros]", {
    status: response.status,
    generated: result.generated ?? 0,
    errors: Array.isArray(result.errors) ? result.errors.length : 0,
    durationMs: Date.now() - startedAt,
  });
  return response;
});
