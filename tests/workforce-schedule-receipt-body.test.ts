import assert from "node:assert/strict";
import test from "node:test";
import { readScheduleReceiptBody, ScheduleReceiptBodyError, SCHEDULE_RECEIPT_MAX_BODY_BYTES } from "../src/lib/workforce-schedule-receipt-body";

const encoder = new TextEncoder();
const body = JSON.stringify({ workDate: "2031-01-01", snapshotHash: "a".repeat(64), acknowledged: true });
function request(text = body, headers: Record<string, string> = {}) {
  return new Request("https://example.invalid/api/self/schedule-receipts", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: text,
  });
}
function stream(chunks: Uint8Array[], headers: Record<string, string> = {},
  options: { signal?: AbortSignal; cancel?: () => void | Promise<void> } = {}) {
  let reads = 0, cancelled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { const index = reads++; if (index < chunks.length) controller.enqueue(chunks[index]); else controller.close(); },
    cancel() { cancelled++; return options.cancel?.(); },
  }, { highWaterMark: 0 });
  const input = new Request("https://example.invalid/api/self/schedule-receipts", {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body, signal: options.signal, duplex: "half",
  } as RequestInit & { duplex: "half" });
  return { input, stats: () => ({ reads, cancelled }) };
}
const rejects = (status: number) => (error: unknown) => error instanceof ScheduleReceiptBodyError && error.status === status;

test("bounded receipt reader accepts normal and exactly 2048-byte JSON", async () => {
  assert.deepEqual(await readScheduleReceiptBody(request()), JSON.parse(body));
  const exact = body + " ".repeat(SCHEDULE_RECEIPT_MAX_BODY_BYTES - encoder.encode(body).length);
  assert.equal(encoder.encode(exact).length, 2048);
  assert.deepEqual(await readScheduleReceiptBody(request(exact, { "content-length": "2048" })), JSON.parse(body));
});
test("the media type must be JSON, not a misleading substring", async () => {
  for (const contentType of ["text/plain; hint=application/json", "application/json-extra", "application/not-application/json", "text/json"]) {
    const fixture = stream([encoder.encode(body)], { "content-type": contentType });
    await assert.rejects(() => readScheduleReceiptBody(fixture.input), rejects(400));
    assert.equal(fixture.stats().reads, 0);
    assert.equal(fixture.stats().cancelled, 1);
  }
  assert.deepEqual(await readScheduleReceiptBody(request(body, { "content-type": "APPLICATION/JSON; charset=UTF-8" })), JSON.parse(body));
});
test("an oversized declared length is rejected before any body read", async () => {
  for (const value of ["2049", "9007199254740992", "9".repeat(60)]) {
    const fixture = stream([encoder.encode(body)], { "content-length": value });
    await assert.rejects(() => readScheduleReceiptBody(fixture.input), rejects(413));
    assert.deepEqual(fixture.stats(), { reads: 0, cancelled: 1 });
  }
});
test("malformed lengths are rejected and an understated length cannot bypass the actual byte limit", async () => {
  for (const value of ["-1", "2e3", "+2", "2.0", "2,2", "invalid"]) {
    await assert.rejects(() => readScheduleReceiptBody(request(body, { "content-length": value })), rejects(400));
  }
  const fixture = stream([new Uint8Array(2048), new Uint8Array(1), new Uint8Array(100)], { "content-length": "1" });
  await assert.rejects(() => readScheduleReceiptBody(fixture.input), rejects(413));
  assert.deepEqual(fixture.stats(), { reads: 2, cancelled: 1 });
});
test("chunked upload stops at the first over-limit chunk and never reads the tail", async () => {
  const fixture = stream([new Uint8Array(1024), new Uint8Array(1024), new Uint8Array(1), new Uint8Array(100)]);
  await assert.rejects(() => readScheduleReceiptBody(fixture.input), rejects(413));
  assert.deepEqual(fixture.stats(), { reads: 3, cancelled: 1 });
  assert.equal(fixture.input.body?.locked, false);
});
test("UTF-8 bytes, not JavaScript string length, determine the limit", async () => {
  const unicode = JSON.stringify({ text: "\u00e9".repeat(1100) });
  assert.ok(unicode.length < 2048);
  assert.ok(encoder.encode(unicode).length > 2048);
  await assert.rejects(() => readScheduleReceiptBody(request(unicode)), rejects(413));
});
test("split multibyte UTF-8 survives chunk boundaries without corruption", async () => {
  const value = JSON.stringify({ text: "Fictional \u00e9\ud83d\ude00" });
  const encoded = encoder.encode(value);
  const fixture = stream([...encoded].map(byte => Uint8Array.of(byte)));
  assert.deepEqual(await readScheduleReceiptBody(fixture.input), JSON.parse(value));
});
test("invalid UTF-8, empty JSON, invalid JSON and truncated lengths fail without echoing content", async () => {
  const malformedUtf8 = stream([Uint8Array.of(123, 34, 120, 34, 58, 34, 0xff, 34, 125)]);
  await assert.rejects(() => readScheduleReceiptBody(malformedUtf8.input), rejects(400));
  for (const content of ["", " ", "PRIVATE REQUEST not json", '{"acknowledged":']) {
    await assert.rejects(() => readScheduleReceiptBody(request(content)), error => rejects(400)(error)
      && !(error as Error).message.includes("PRIVATE REQUEST"));
  }
  await assert.rejects(() => readScheduleReceiptBody(request(body, { "content-length": String(body.length + 1) })), rejects(400));
  await assert.rejects(() => readScheduleReceiptBody(request(body, { "content-length": "0" })), rejects(400));
});
test("previously consumed bodies are not reused", async () => {
  const input = request(); await input.text();
  await assert.rejects(() => readScheduleReceiptBody(input), rejects(400));
});
test("an already aborted request is not read", async () => {
  const controller = new AbortController(); controller.abort();
  const fixture = stream([encoder.encode(body)], {}, { signal: controller.signal });
  await assert.rejects(() => readScheduleReceiptBody(fixture.input), rejects(400));
  assert.deepEqual(fixture.stats(), { reads: 0, cancelled: 1 });
});
test("aborting an outstanding read cancels it and releases the reader", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  let signalRead!: () => void;
  const readStarted = new Promise<void>(resolve => { signalRead = resolve; });
  let cancelled = 0;
  const pending = new ReadableStream<Uint8Array>({ pull() { signalRead(); }, cancel() { cancelled++; } }, { highWaterMark: 0 });
  const input = new Request("https://example.invalid", { method: "POST", headers: { "content-type": "application/json" },
    body: pending, signal: controller.signal, duplex: "half" } as RequestInit & { duplex: "half" });
  const result = assert.rejects(() => readScheduleReceiptBody(input), rejects(400));
  await readStarted; controller.abort(); await result;
  assert.equal(cancelled, 1);
  assert.equal(pending.locked, false);
});
test("stream errors are classified as request errors, never raw exception messages", async () => {
  const pending = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error("PRIVATE TRANSPORT DETAIL")); } }, { highWaterMark: 0 });
  const input = new Request("https://example.invalid", { method: "POST", headers: { "content-type": "application/json" },
    body: pending, duplex: "half" } as RequestInit & { duplex: "half" });
  await assert.rejects(() => readScheduleReceiptBody(input), error => rejects(400)(error)
    && !(error as Error).message.includes("PRIVATE TRANSPORT DETAIL"));
  assert.equal(pending.locked, false);
});
test("a failing or stalled cancel hook cannot mask or delay the size error", { timeout: 2000 }, async () => {
  for (const cancel of [() => Promise.reject(new Error("PRIVATE CLEANUP")), () => new Promise<void>(() => undefined)]) {
    const fixture = stream([new Uint8Array(2049)], {}, { cancel });
    await assert.rejects(() => readScheduleReceiptBody(fixture.input), rejects(413));
    assert.deepEqual(fixture.stats(), { reads: 1, cancelled: 1 });
    assert.equal(fixture.input.body?.locked, false);
  }
});
