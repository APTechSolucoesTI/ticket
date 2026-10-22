/** Domain handlers authorize the tenant/resource before reaching this trusted
 * transport. The API validates bytes and scans before any Storage write. */
export async function secureServerUpload(
  bucket: string,
  path: string,
  bytes: Uint8Array,
  mime: string,
) {
  try {
    const base = process.env.INTERNAL_BACKEND_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !key) throw new Error("Envio seguro de arquivos indisponível.");
    const form = new FormData();
    form.set("bucket", bucket);
    form.set("path", path);
    form.set(
      "file",
      new Blob([Uint8Array.from(bytes)], { type: mime || "application/octet-stream" }),
      path.split("/").at(-1) || "anexo",
    );
    const response = await fetch(`${base.replace(/\/$/, "")}/files/internal-upload`, {
      method: "POST",
      headers: { "X-APTicket-Internal-Key": key },
      body: form,
      redirect: "error",
      signal: AbortSignal.timeout(45000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        typeof result.message === "string"
          ? result.message
          : "Não foi possível verificar o arquivo.",
      );
    return { data: result as { path: string }, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error : new Error("Envio seguro de arquivos indisponível."),
    };
  }
}
