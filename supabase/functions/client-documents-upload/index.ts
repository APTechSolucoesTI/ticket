import { createClientDocumentsUploadHandler } from "./handler.ts";
Deno.serve(
  createClientDocumentsUploadHandler({
    env: (name) => Deno.env.get(name),
    fetch: globalThis.fetch,
  }),
);
