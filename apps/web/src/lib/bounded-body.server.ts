const MAX_FORM_BYTES = 51 * 1024 * 1024;
let activeForms = 0;

/** Bound the aggregate body before the platform multipart parser allocates files.
 * Existing portal clients select at most five 10 MiB files; API uploads accept one file. */
export async function boundedFormData(request: Request): Promise<FormData> {
  if (activeForms >= 4) throw new Error("Envio de arquivos ocupado. Tente novamente.");
  activeForms++;
  try {
    if (Number(request.headers.get("content-length")) > MAX_FORM_BYTES || !request.body)
      throw new Error("O envio excede o limite permitido.");
    let length = 0;
    const stream = request.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          length += chunk.byteLength;
          if (length > MAX_FORM_BYTES) throw new Error("O envio excede o limite permitido.");
          controller.enqueue(chunk);
        },
      }),
    );
    return await new Response(stream, {
      headers: { "content-type": request.headers.get("content-type") || "" },
    }).formData();
  } finally {
    activeForms--;
  }
}

export async function boundedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit)
    throw new Error("O envio excede o limite permitido.");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error("O envio excede o limite permitido.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
