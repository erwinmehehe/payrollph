import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as bodyBoundary from "../src/lib/workforce-schedule-receipt-body";

// Real Request/ReadableStream and actual route source/body reader. Authentication,
// semantic schedule validation and persistence are doubles, not an HTTP/DB pilot.
const encoder = new TextEncoder();
const payload = { workDate: "2031-01-01", snapshotHash: "a".repeat(64), acknowledged: true };
const json = JSON.stringify(payload);
const identity = { userId: 3, employeeId: 2, organizationId: 1 };
type Gate = "origin" | "disabled" | "session" | "role" | "membership" | "allowlist" | "demo" | "rate";
function fixture(gate?: Gate, created = true) {
  let writes = 0, parses = 0;
  let savedIdentity: unknown;
  let savedBody: unknown;
  class ScheduleReceiptError extends Error { status = 409; code = "SCHEDULE_CHANGED"; }
  const session = { id: identity.userId, employeeId: identity.employeeId,
    role: gate === "role" ? "manager" : "employee", email: "fictional@example.invalid" };
  const dependencies: Record<string, unknown> = {
    "drizzle-orm": { eq: () => undefined },
    "@/db": { db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [
      { id: identity.employeeId, organizationId: identity.organizationId },
    ] }) }) }) } },
    "@/db/schema": { employees: { id: "id", organizationId: "organizationId" } },
    "@/lib/auth": { getSessionUser: async () => gate === "session" ? null : session },
    "@/lib/access": { assertMembership: async () => gate === "membership" ? Response.json({ error: "Denied" }, { status: 403 }) : null },
    "@/lib/demo-security": { publicDemoMutationDenied: () => gate === "demo" ? Response.json({ error: "Demo denied" }, { status: 403 }) : null },
    "@/lib/security-request": {
      enforceSameOriginMutation: () => gate === "origin" ? Response.json({ error: "Origin denied" }, { status: 403 }) : null,
      enforceSensitiveActionRateLimit: async () => gate === "rate" ? Response.json({ error: "Limited" }, { status: 429 }) : null,
    },
    "@/lib/workforce-schedule-receipt": {
      receiptPilotAllowed: () => gate !== "allowlist",
      parseScheduleReceipt: (value: unknown) => {
        parses++;
        assert.ok(value && typeof value === "object" && !Array.isArray(value));
        const body = value as Record<string, unknown>;
        assert.equal(body.acknowledged, true);
        assert.ok(Object.keys(body).every(key => ["workDate", "snapshotHash", "acknowledged"].includes(key)));
        assert.equal(body.workDate, payload.workDate); assert.equal(body.snapshotHash, payload.snapshotHash);
      },
    },
    "@/lib/workforce-employee-upcoming-week": { manilaWorkDate: () => payload.workDate },
    "@/lib/workforce-schedule-receipt-body": bodyBoundary,
    "@/lib/workforce-schedule-receipt-server": {
      ScheduleReceiptError,
      readScheduleReceiptView: async () => { throw new Error("GET is outside this boundary test"); },
      acknowledgeScheduleReceipt: async (who: unknown, body: unknown) => {
        writes++; savedIdentity = who; savedBody = body;
        return { created, workDate: payload.workDate, snapshotHash: payload.snapshotHash, acknowledgedAt: "2031-01-01T00:00:00.000Z" };
      },
    },
  };
  const source = readFileSync("src/app/api/self/schedule-receipts/route.ts", "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }, reportDiagnostics: true });
  assert.equal(compiled.diagnostics?.length ?? 0, 0);
  const exports: Record<string, unknown> = {};
  new Script(compiled.outputText, { filename: "actual-schedule-receipt-route.js" }).runInNewContext({
    exports, Response, Request, URL,
    process: { env: { WFM_SCHEDULE_RECEIPTS_ENABLED: gate === "disabled" ? "false" : "true",
      WFM_SCHEDULE_RECEIPTS_ALLOWED_ORGANIZATION_IDS: "1" } },
    require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; },
  });
  return { post: exports.POST as (request: Request) => Promise<Response>,
    counters: () => ({ writes, parses, savedIdentity, savedBody }) };
}
function stream(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  let reads = 0, cancelled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { const index = reads++; if (index < chunks.length) controller.enqueue(chunks[index]); else controller.close(); },
    cancel() { cancelled++; },
  }, { highWaterMark: 0 });
  const input = new Request("https://example.invalid/api/self/schedule-receipts", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body, duplex: "half",
  } as RequestInit & { duplex: "half" });
  return { input, stats: () => ({ reads, cancelled }) };
}

test("actual receipt POST retains session identity, JSON payload, response status and no-store headers", async () => {
  for (const created of [true, false]) {
    const api = fixture(undefined, created), input = stream([encoder.encode(json)]);
    const response = await api.post(input.input);
    assert.equal(response.status, created ? 201 : 200);
    assert.equal(api.counters().writes, 1);
    assert.equal(JSON.stringify(api.counters().savedIdentity), JSON.stringify(identity));
    assert.equal(JSON.stringify(api.counters().savedBody), json);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("vary"), "Cookie");
  }
});
test("actual POST rejects misleading JSON media types before parsing or persistence", async () => {
  const api = fixture(), input = stream([encoder.encode(json)], { "content-type": "text/plain; hint=application/json" });
  const response = await api.post(input.input);
  assert.equal(response.status, 400);
  assert.equal(input.stats().reads, 0);
  assert.equal(api.counters().parses, 0); assert.equal(api.counters().writes, 0);
});
test("actual POST accepts case-insensitive JSON with charset parameters", async () => {
  const api = fixture(), input = stream([encoder.encode(json)], { "content-type": "APPLICATION/JSON; charset=UTF-8" });
  assert.equal((await api.post(input.input)).status, 201);
  assert.equal(api.counters().writes, 1);
});
test("declared oversized POST is rejected without consuming its body or recording a receipt", async () => {
  const api = fixture(), input = stream([encoder.encode(json)], { "content-length": "2049" });
  const response = await api.post(input.input);
  assert.equal(response.status, 413);
  assert.deepEqual(input.stats(), { reads: 0, cancelled: 1 });
  assert.equal(api.counters().parses, 0); assert.equal(api.counters().writes, 0);
});
test("chunked oversized POST stops at the byte limit instead of draining the entire request", async () => {
  const api = fixture(), input = stream([new Uint8Array(2048), new Uint8Array(1), new Uint8Array(500)]);
  assert.equal((await api.post(input.input)).status, 413);
  assert.deepEqual(input.stats(), { reads: 2, cancelled: 1 });
  assert.equal(api.counters().parses, 0); assert.equal(api.counters().writes, 0);
});
test("POST counts UTF-8 bytes before semantic parsing", async () => {
  const api = fixture(), input = stream([encoder.encode(JSON.stringify({ text: "\u00e9".repeat(1100) }))]);
  assert.equal((await api.post(input.input)).status, 413);
  assert.equal(api.counters().parses, 0); assert.equal(api.counters().writes, 0);
});
test("invalid JSON is a sanitized no-store 400 and cannot reach receipt service", async () => {
  const api = fixture(), input = stream([encoder.encode("PRIVATE REQUEST invalid json")]);
  const response = await api.post(input.input);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.ok(!(await response.text()).includes("PRIVATE REQUEST"));
  assert.equal(api.counters().writes, 0);
});
test("transport failure is a client request error and cannot reach persistence", async () => {
  const api = fixture();
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error("PRIVATE TRANSPORT")); } }, { highWaterMark: 0 });
  const input = new Request("https://example.invalid/api/self/schedule-receipts", {
    method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half",
  } as RequestInit & { duplex: "half" });
  const response = await api.post(input);
  assert.equal(response.status, 400);
  assert.ok(!(await response.text()).includes("PRIVATE TRANSPORT"));
  assert.equal(api.counters().writes, 0);
});
test("origin, feature, session, role, membership, allowlist, demo and rate gates still run before upload consumption", async () => {
  const gates: Array<[Gate, number]> = [["origin", 403], ["disabled", 404], ["session", 401], ["role", 403],
    ["membership", 403], ["allowlist", 404], ["demo", 403], ["rate", 429]];
  for (const [gate, status] of gates) {
    const api = fixture(gate), input = stream([encoder.encode(json)]);
    assert.equal((await api.post(input.input)).status, status, gate);
    assert.equal(input.stats().reads, 0, gate);
    assert.equal(api.counters().writes, 0, gate);
  }
});
test("semantic identity overrides remain rejected after transport validation", async () => {
  const api = fixture(), input = stream([encoder.encode(JSON.stringify({ ...payload, employeeId: 999 }))]);
  assert.equal((await api.post(input.input)).status, 400);
  assert.equal(api.counters().writes, 0);
});

test("actual POST returns private no-store 408 for stalled uploads without receipt persistence", { timeout: 2000 }, async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const initial of [undefined, json]) {
    const api = fixture();
    const abort = new AbortController();
    let signalRead!: () => void;
    const started = new Promise<void>(resolve => { signalRead = resolve; });
    let pulls = 0, cancelled = 0;
    const upload = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls++ === 0 && initial !== undefined) controller.enqueue(encoder.encode(initial));
        signalRead();
      },
      cancel() { cancelled++; return new Promise<void>(() => undefined); },
    }, { highWaterMark: 0 });
    const input = new Request("https://example.invalid/api/self/schedule-receipts", {
      method: "POST", headers: { "content-type": "application/json" }, body: upload,
      signal: abort.signal, duplex: "half",
    } as RequestInit & { duplex: "half" });
    const result = api.post(input);
    try {
      await started;
      t.mock.timers.tick(bodyBoundary.SCHEDULE_RECEIPT_BODY_TIMEOUT_MS);
      const response = await result;
      assert.equal(response.status, 408);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("vary"), "Cookie");
      const failure = await response.json();
      assert.equal(failure.code, "SCHEDULE_RECEIPT_BODY_TIMEOUT");
      assert.ok(!JSON.stringify(failure).includes(payload.snapshotHash));
      assert.equal(api.counters().parses, 0);
      assert.equal(api.counters().writes, 0);
      assert.equal(cancelled, 1);
      assert.equal(upload.locked, false);
    } finally { abort.abort(); await result; }
  }
});
test("a fresh valid POST succeeds after timeout but a late chunk cannot revive the cancelled request", { timeout: 2000 }, async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const api = fixture();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let signalRead!: () => void;
  const started = new Promise<void>(resolve => { signalRead = resolve; });
  const upload = new ReadableStream<Uint8Array>({
    start(value) { controller = value; }, pull() { signalRead(); },
  }, { highWaterMark: 0 });
  const input = new Request("https://example.invalid/api/self/schedule-receipts", {
    method: "POST", headers: { "content-type": "application/json" }, body: upload, duplex: "half",
  } as RequestInit & { duplex: "half" });
  const result = api.post(input);
  await started;
  t.mock.timers.tick(bodyBoundary.SCHEDULE_RECEIPT_BODY_TIMEOUT_MS);
  assert.equal((await result).status, 408);
  assert.equal(api.counters().writes, 0);
  assert.throws(() => controller.enqueue(encoder.encode(json)));
  const next = await api.post(stream([encoder.encode(json)]).input);
  assert.equal(next.status, 201);
  assert.equal(api.counters().writes, 1);
  assert.equal(api.counters().parses, 1);
  assert.equal(JSON.stringify(api.counters().savedIdentity), JSON.stringify(identity));
});
