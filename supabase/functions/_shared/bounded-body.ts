/** Portable Deno boundary before multipart parsing. Preserves the existing twenty-file, 10 MiB-per-file request capacity; each file is subsequently validated/scanned by the single API policy. */
export async function boundedFormData(request: Request): Promise<FormData> {
  const max = 201 * 1024 * 1024;
  if (Number(request.headers.get("content-length")) > max) {
    throw new Error("body_too_large");
  }
  if (!request.body) throw new Error("missing_body");
  let size = 0;
  // Enforce the real length while the native parser reads. Avoid holding a
  // second complete copy of the multipart body in the Edge isolate.
  const stream = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > max) throw new Error("body_too_large");
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(stream, {
    headers: { "content-type": request.headers.get("content-type") || "" },
  }).formData();
}
