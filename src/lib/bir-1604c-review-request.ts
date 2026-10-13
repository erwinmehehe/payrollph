/** Bounded streaming JSON boundary for reviewed 1604-C source. No request fragments are logged. */
export const BIR_REVIEW_MAX_BYTES = 2 * 1024 * 1024;
export const BIR_REVIEW_TIMEOUT_MS = 10_000;

export class BirReviewBodyError extends Error {
  constructor(readonly code: string, message: string, readonly status: number = 400) {
    super(message);
    this.name = "BirReviewBodyError";
  }
}

export async function readBirReviewBody(request: Request): Promise<unknown> {
  const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    void request.body?.cancel().catch(() => undefined);
    throw new BirReviewBodyError("INVALID_CONTENT_TYPE", "A JSON reviewed-source file is required.");
  }
  const declared = request.headers.get("content-length");
  if (declared != null && (!/^[0-9]+$/.test(declared) ||
      !Number.isSafeInteger(Number(declared)))) {
    void request.body?.cancel().catch(() => undefined);
    throw new BirReviewBodyError("INVALID_LENGTH", "The reviewed-source request has an invalid length.");
  }
  if (declared != null && Number(declared) > BIR_REVIEW_MAX_BYTES) {
    void request.body?.cancel().catch(() => undefined);
    throw new BirReviewBodyError("REVIEW_TOO_LARGE", "Reviewed source exceeds 2 MiB.", 413);
  }
  if (!request.body || request.body.locked || request.bodyUsed || request.signal.aborted) {
    throw new BirReviewBodyError("BODY_UNAVAILABLE", "An unread reviewed-source JSON body is required.");
  }
  const reader = request.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  let rejectStop!: (reason: BirReviewBodyError) => void;
  const stopped = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
  void stopped.catch(() => undefined);
  let stopping = false;
  const stop = (reason: BirReviewBodyError) => {
    if (stopping) return;
    stopping = true;
    rejectStop(reason);
    cancel();
  };
  const abort = () => stop(new BirReviewBodyError("REVIEW_INTERRUPTED", "Review upload interrupted."));
  const timeout = setTimeout(() =>
    stop(new BirReviewBodyError("REVIEW_TIMEOUT", "Review upload timed out.", 408)),
  BIR_REVIEW_TIMEOUT_MS);
  request.signal.addEventListener("abort", abort, { once: true });
  const start = performance.now();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    const consume = async () => {
      for (;;) {
        if (stopping || request.signal.aborted) throw new BirReviewBodyError("REVIEW_INTERRUPTED", "Review upload interrupted.");
        if (performance.now() - start > BIR_REVIEW_TIMEOUT_MS)
          throw new BirReviewBodyError("REVIEW_TIMEOUT", "Review upload timed out.", 408);
        const item = await reader.read();
        if (stopping) throw new BirReviewBodyError("REVIEW_INTERRUPTED", "Review upload interrupted.");
        if (item.done) break;
        if (!(item.value instanceof Uint8Array))
          throw new BirReviewBodyError("INVALID_BYTES", "Review body must contain bytes.");
        bytes += item.value.byteLength;
        if (bytes > BIR_REVIEW_MAX_BYTES)
          throw new BirReviewBodyError("REVIEW_TOO_LARGE", "Reviewed source exceeds 2 MiB.", 413);
        parts.push(item.value);
      }
      if (declared != null && Number(declared) !== bytes)
        throw new BirReviewBodyError("LENGTH_MISMATCH", "Review body length does not match Content-Length.");
      if (!bytes) throw new BirReviewBodyError("EMPTY_REVIEW", "Reviewed source must not be empty.");
      const merged = new Uint8Array(bytes);
      let offset = 0;
      for (const part of parts) { merged.set(part, offset); offset += part.length; }
      try {
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(merged)) as unknown;
      } catch {
        throw new BirReviewBodyError("INVALID_JSON", "Reviewed source must contain valid UTF-8 JSON.");
      }
    };
    return await Promise.race([consume(), stopped]);
  } catch (error) {
    cancel();
    throw error instanceof BirReviewBodyError
      ? error : new BirReviewBodyError("REVIEW_INTERRUPTED", "Review upload interrupted.");
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
