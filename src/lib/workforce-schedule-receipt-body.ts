/** HTTP input boundary only; schedule identity and approval checks stay in the route/service. */
export const SCHEDULE_RECEIPT_MAX_BODY_BYTES = 2048;

export class ScheduleReceiptBodyError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status = 400, code = "SCHEDULE_RECEIPT_BODY_INVALID") {
    super(message);
    this.name = "ScheduleReceiptBodyError";
    this.status = status;
    this.code = code;
  }
}
function tooLarge() {
  return new ScheduleReceiptBodyError("Acknowledgment exceeds the 2048-byte limit.",
    413, "SCHEDULE_RECEIPT_BODY_TOO_LARGE");
}
function interrupted() {
  return new ScheduleReceiptBodyError("Acknowledgment body was interrupted. Refresh before retrying.");
}

/**
 * Never buffer the full upload before checking its size. Content-Length is an
 * early rejection hint, not trusted evidence that the actual stream is small.
 * Cancellation must not await an untrusted stream's cleanup promise.
 */
export async function readScheduleReceiptBody(request: Request): Promise<unknown> {
  const cancelBody = () => { void request.body?.cancel().catch(() => undefined); };
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    cancelBody();
    throw new ScheduleReceiptBodyError("JSON acknowledgment is required.");
  }
  const lengthHeader = request.headers.get("content-length");
  let declaredBytes: number | null = null;
  if (lengthHeader !== null) {
    if (!/^[0-9]+$/.test(lengthHeader)) {
      cancelBody();
      throw new ScheduleReceiptBodyError("Acknowledgment Content-Length is invalid.");
    }
    declaredBytes = Number(lengthHeader);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > SCHEDULE_RECEIPT_MAX_BODY_BYTES) {
      cancelBody();
      throw tooLarge();
    }
  }
  if (request.signal.aborted) { cancelBody(); throw interrupted(); }
  if (!request.body || request.bodyUsed || request.body.locked) {
    throw new ScheduleReceiptBodyError("An unread JSON acknowledgment body is required.");
  }

  const reader = request.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  request.signal.addEventListener("abort", cancel, { once: true });
  const bytes = new Uint8Array(SCHEDULE_RECEIPT_MAX_BODY_BYTES);
  let used = 0;
  try {
    for (;;) {
      if (request.signal.aborted) throw interrupted();
      const chunk = await reader.read();
      if (request.signal.aborted) throw interrupted();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) {
        throw new ScheduleReceiptBodyError("Acknowledgment body must contain bytes.");
      }
      if (chunk.value.byteLength > SCHEDULE_RECEIPT_MAX_BODY_BYTES - used) throw tooLarge();
      bytes.set(chunk.value, used);
      used += chunk.value.byteLength;
    }
    if (declaredBytes !== null && declaredBytes !== used) {
      throw new ScheduleReceiptBodyError("Acknowledgment body length does not match Content-Length.");
    }
    if (used === 0) throw new ScheduleReceiptBodyError("A JSON acknowledgment body is required.");
    try {
      // Fatal decoding prevents damaged UTF-8 from being silently rewritten.
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, used))) as unknown;
    } catch {
      throw new ScheduleReceiptBodyError("Acknowledgment must contain valid UTF-8 JSON.");
    }
  } catch (error) {
    cancel();
    // Do not expose raw stream errors or fragments of an employee request.
    throw error instanceof ScheduleReceiptBodyError ? error : interrupted();
  } finally {
    request.signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
