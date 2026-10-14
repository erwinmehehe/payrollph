/** Limit anonymous JSON before parsing it, including chunked requests.
 * This parser does not log submitted names, emails or the optional message.
 */
export const MAX_PUBLIC_CAREERS_BODY_BYTES = 8192;

const bad = (message: string, status: number) =>
  Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

export async function readCareersApplicationBody(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return bad("JSON application required.", 415);
  const announced = request.headers.get("content-length");
  if (announced && /^\d+$/.test(announced) && Number(announced) > MAX_PUBLIC_CAREERS_BODY_BYTES) {
    return bad("Application is too large.", 413);
  }
  if (!request.body) return bad("Application fields are required.", 422);
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PUBLIC_CAREERS_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return bad("Application is too large.", 413);
      }
      chunks.push(value);
    }
    const json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    )) as unknown;
    if (json === null || Array.isArray(json) || typeof json !== "object") {
      return bad("Application fields are required.", 422);
    }
    return json as Record<string, unknown>;
  } catch {
    return bad("Invalid application JSON.", 422);
  } finally {
    reader.releaseLock();
  }
}
