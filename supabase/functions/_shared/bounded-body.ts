/** Portable Deno boundary before multipart parsing. Preserves the existing twenty-file, 10 MiB-per-file request capacity; each file is subsequently validated/scanned by the single API policy. */
export async function boundedFormData(request: Request): Promise<FormData> {
  const max = 201 * 1024 * 1024;
  if (Number(request.headers.get("content-length")) > max) {
    throw new Error("body_too_large");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new Error("missing_body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new Error("body_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(bytes, {
    headers: { "content-type": request.headers.get("content-type") || "" },
  }).formData();
}
