import { createHandler } from "./handler.ts";

Deno.serve(
  createHandler({
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    fetch,
    createClient: (certificate, key) =>
      Deno.createHttpClient({ cert: certificate, key }),
  }),
);
