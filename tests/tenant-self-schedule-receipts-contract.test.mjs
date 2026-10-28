import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  METHODS, ENDPOINT, requireDisposableScheduleReceipt, assertOwnSchedule,
  assertPrivateDenial, assertUnchanged,
} from "../scripts/qa/tenant-self-schedule-receipts-contract.mjs";

const safe = {
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production", DEMO_MODE: "false",
  TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  TENANT_RECEIPT_MODE: "fictional-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  WFM_SCHEDULE_RECEIPTS_ENABLED: "true",
  WFM_SCHEDULE_RECEIPTS_ALLOWED_ORGANIZATION_IDS: "1,2,3",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", HCM_OVERPAYMENT_PREVIEW_ENABLED: "false",
  PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "false",
  WORKER_TOKEN: "ci-worker-token-fictional-receipt",
};
const actor = {
  label: "ATTA", date: "2026-10-28", shift: { id: 25 },
  shiftName: "TTBL-ATTA-1234 OWN private fictional roster",
};
function read() {
  const day = {
    date: actor.date, state: "pending",
    snapshotHash: "a".repeat(64),
    snapshot: { source: "override", segments: [{
      shiftDefinitionId: actor.shift.id, shiftName: actor.shiftName,
    }] },
  };
  const json = { boundary: "This is not consent or attendance.", days: [
    day, ...Array.from({ length: 6 }, () => ({ date: actor.date, state: "unavailable" })),
  ] };
  return { status: 200, json, text: JSON.stringify(json),
    headers: new Headers({ "Cache-Control": "private, no-store", "Vary": "Cookie" }) };
}
test("CI gate rejects production, non-local, payment and disabled-pilot modes BEFORE database imports", () => {
  assert.doesNotThrow(() => requireDisposableScheduleReceipt(safe));
  for (const patch of [
    { CI: "false" }, { GITHUB_ACTIONS: "" }, { NODE_ENV: "development" },
    { DEMO_MODE: "true" }, { TENANT_SECOND_PASS_MODE: "" },
    { TENANT_RECEIPT_MODE: "" },
    { DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/app_db" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/neondb" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db?sslmode=require" },
    { SECURITY_SMOKE_URL: "https://prod.example.invalid" },
    { SECURITY_SMOKE_URL: "http://localhost:3000" },
    { WFM_SCHEDULE_RECEIPTS_ENABLED: "false" },
    { WFM_SCHEDULE_RECEIPTS_ALLOWED_ORGANIZATION_IDS: "1,2,4" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" }, { XENDIT_PAYOUTS_ENABLED: "true" },
    { XENDIT_BILLING_ENABLED: "true" }, { PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "true" },
    { WORKER_TOKEN: "live-work-token" },
    { PAYMONGO_SECRET_KEY: "secret" }, { XENDIT_SECRET_KEY: "secret" },
    { RESEND_API_KEY: "secret" }, { SMTP_URL: "smtp://provider" },
  ]) {
    assert.throws(() => requireDisposableScheduleReceipt({ ...safe, ...patch }),
      /SCHEDULE_RECEIPT_TENANT_REFUSED/, JSON.stringify(patch));
  }
});
test("both documented schedule receipt methods remain GAP, with zero premature credits", () => {
  assert.deepEqual(METHODS, ["GET self/schedule-receipts", "POST self/schedule-receipts"]);
  assert.equal(ENDPOINT, "/api/self/schedule-receipts");
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const route = manifest.allApiRouteFiles["src/app/api/self/schedule-receipts/route.ts"];
  assert.equal(route.route, "self/schedule-receipts");
  for (const method of ["GET", "POST"]) {
    const item = route.methods.find(m => m.name === method);
    assert.equal(item.status, "GAP");
    assert.equal(item.testedBy, null);
  }
});
test("own read must contain exact private, bound current schedule, not an empty or victim response", () => {
  assertOwnSchedule(read(), actor, "pending", ["TTBL-VICTIM-private"]);
  for (const change of [
    x => { x.status = 204; },
    x => { x.json.days = []; },
    x => { x.json.days[0].snapshot = null; },
    x => { x.json.days[0].date = "2026-10-29"; },
    x => { x.json.days[0].state = "acknowledged"; },
    x => { x.json.days[0].snapshotHash = "invalid"; },
    x => { x.json.days[0].snapshot.segments[0].shiftDefinitionId = 999; },
    x => { x.json.days[0].snapshot.segments[0].shiftName = "victim"; },
    x => { x.json.payroll = true; },
    x => { x.headers.delete("Cache-Control"); },
    x => { x.text += "TTBL-VICTIM-private"; },
  ]) {
    const variant = read();
    change(variant);
    assert.throws(() => assertOwnSchedule(variant, actor, "pending", ["TTBL-VICTIM-private"]));
  }
});
test("denied HTTP cannot return receipt data or another tenant marker", () => {
  const r = { status: 403, text: '{"error":"Access denied."}', json: { error: "Access denied." } };
  assertPrivateDenial(r, 403, ["TTBL-VICTIM-private"]);
  assert.throws(() => assertPrivateDenial(r, 200));
  assert.throws(() => assertPrivateDenial({ ...r, json: { ...r.json, days: [] } }, 403));
  assert.throws(() => assertPrivateDenial({ ...r, text: r.text + "TTBL-VICTIM-private" }, 403,
    ["TTBL-VICTIM-private"]));
  assertUnchanged({ receipts: [], audit: [] }, { receipts: [], audit: [] }, "victim");
  assert.throws(() => assertUnchanged({ receipts: [], audit: [] },
    { receipts: [1], audit: [] }, "victim"));
});
test("runner and focused PG16 workflow execute both routes with genuine fixture and source snapshots", () => {
  const script = readFileSync("scripts/qa/tenant-self-schedule-receipts-http.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/tenant-self-schedule-receipts-http.yml", "utf8");
  const api = readFileSync("src/app/api/self/schedule-receipts/route.ts", "utf8");
  const service = readFileSync("src/lib/workforce-schedule-receipt-server.ts", "utf8");
  const guard = script.indexOf("requireDisposableScheduleReceipt();");
  const dbImport = script.indexOf('import("../../src/db/index.ts")');
  assert.ok(guard >= 0 && dbImport > guard, "environment gate before any database import");
  for (const marker of [
    'seed("ATTA")', 'seed("ATTB")', 'seed("VICTIM")',
    "standaloneMakeSession", "standaloneRequest",
    "scheduleOverrides", "shiftDefinitions", "assertOwnSchedule", "assertPrivateDenial",
    "assertUnchanged", "snapshot(victim.org.id)", "receiptRows", "auditBusinessSnapshot",
    "original.get(actor.org.id)", "victimDay.snapshotHash",
    "active: false", "get(a)", "post(a",
  ]) assert.ok(script.includes(marker), "missing executable proof anchor: " + marker);
  for (const marker of [
    "node --test tests/tenant-self-schedule-receipts-contract.test.mjs",
    "node --import tsx scripts/qa/tenant-self-schedule-receipts-http.mjs",
    "postgres:16", "apply-isolated-baseline.mjs",
    "WFM_SCHEDULE_RECEIPTS_ALLOWED_ORGANIZATION_IDS",
  ]) assert.ok(workflow.includes(marker), "focused job must execute " + marker);
  for (const marker of [
    "assertMembership(", "getSessionUser()", "receiptPilotAllowed(",
    "enforceSameOriginMutation(", "publicDemoMutationDenied(",
    "enforceSensitiveActionRateLimit(", "private, no-store",
  ]) assert.ok(api.includes(marker), marker);
  for (const marker of [
    "assertBoundIdentity(tx, who)", "tx.insert(receipts)", "tx.insert(auditEvents)",
    "eq(userOrganizations.active, true)", "eq(users.employeeId, employees.id)",
    "eq(receipts.organizationId, who.organizationId)",
    "eq(receipts.employeeId, who.employeeId)",
  ]) assert.ok(service.includes(marker), marker);
});
