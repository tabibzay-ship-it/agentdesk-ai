import "server-only";

export class BodyError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
  }
}

// Limit the actual streamed bytes, rather than trusting Content-Length.
export async function readJsonObject(request: Request, maxBytes = 16_384) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
    throw new BodyError("Content-Type must be application/json.", 415, "INVALID_CONTENT_TYPE");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)) {
    throw new BodyError("Request body is too large or invalid.", 413, "BODY_TOO_LARGE");
  }
  if (!request.body) throw new BodyError("Invalid JSON body.", 400, "INVALID_JSON");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new BodyError("Request body timed out.", 408, "BODY_TIMEOUT"));
      void reader.cancel().catch(() => {});
    }, 5_000);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new BodyError("Request body is too large.", 413, "BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)); }
    catch { throw new BodyError("Invalid JSON body.", 400, "INVALID_JSON"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new BodyError("A JSON object is required.", 400, "INVALID_JSON");
    }
    return body as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

// Visitor IDs act as unguessable conversation capabilities. Old Math.random
// widget IDs are intentionally rotated by the client rather than accepted.
export function isVisitorId(value: unknown): value is string {
  return typeof value === "string" && /^(?:dashboard-test-)?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
