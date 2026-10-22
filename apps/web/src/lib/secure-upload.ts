import { getToken, handleSessionResponse } from "@/lib/session";

/** All browser uploads use the authenticated API; direct Storage writes are closed. */
export async function secureUpload(bucket: string, path: string, file: File) {
  try {
    const token = getToken();
    if (!token) throw new Error("Entre novamente para enviar o arquivo.");
    const form = new FormData();
    form.set("bucket", bucket);
    form.set("path", path);
    form.set("file", file);
    const response = handleSessionResponse(
      await fetch("/backend/files/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        redirect: "error",
      }),
      token,
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        typeof result.message === "string"
          ? result.message
          : "Não foi possível enviar o arquivo com segurança.",
      );
    return { data: result as { path: string }, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error : new Error("Não foi possível enviar o arquivo."),
    };
  }
}
