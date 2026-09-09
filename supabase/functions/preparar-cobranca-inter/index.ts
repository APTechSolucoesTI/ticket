import { createHandler } from "./handler.ts";
Deno.serve(createHandler({
  supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
  apiKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  fetch,
}));
