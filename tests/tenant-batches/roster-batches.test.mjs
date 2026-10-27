import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { requireDisposableRosterBatch } from "../../scripts/qa/tenant-batches/roster-batches-guard.mjs";
import {
  assertOwnedRosterRead, assertRejectedRosterMutation, assertUnchangedState,
} from "../../scripts/qa/tenant-batches/roster-batches-proof.mjs";

const good = {
  CI: "true", NODE_ENV: "production", TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  WFM_BULK_ROSTER_PUBLISH_ENABLED: "true",
  WFM_BULK_ROSTER_ALLOWED_ORGANIZATION_IDS: "11,12,13",
};
test("preflight fails closed before loading the DB or HTTP modules", () => {
  assert.deepEqual(requireDisposableRosterBatch(good, "prove"), [11, 12, 13]);
  assert.equal(requireDisposableRosterBatch({
    ...good, WFM_BULK_ROSTER_ALLOWED_ORGANIZATION_IDS: undefined,
  }, "seed"), null);
  for (const bad of [
    { CI: "false" }, { NODE_ENV: "development" },
    { SECURITY_SMOKE_URL: "http://example.com:3000" },
    { SECURITY_SMOKE_URL: "http://127.0.0.1:3000?external=true" },
    { DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/app_db" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/prod" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" }, { XENDIT_PAYOUTS_ENABLED: "true" },
    { RESEND_API_KEY: "real-token" }, { PAYMONGO_SECRET_KEY: "real-token" },
    { WFM_BULK_ROSTER_PUBLISH_ENABLED: "false" },
    { WFM_BULK_ROSTER_ALLOWED_ORGANIZATION_IDS: "11,11,13" },
    { WFM_BULK_ROSTER_ALLOWED_ORGANIZATION_IDS: "*" },
    { WFM_BULK_ROSTER_ALLOWED_ORGANIZATION_IDS: "11,12" },
  ]) assert.throws(() => requireDisposableRosterBatch({ ...good, ...bad }, "prove"));
  assert.throws(() => requireDisposableRosterBatch(good, "unknown"));
});

const employer = {
  orgId: 11, batchId: 41, shiftId: 31, workerId: 21, ownerId: 51,
  ownerName: "fictional owner", makerId: 52, makerName: "fictional maker",
  marker: "TTBL-ATTA-FAKE", reason: "TTBL-ATTA-FAKE documented batch",
  note: "Fictional independent rejection for tenant isolation.",
};
const response = {
  status: 200, headers: new Headers({ "cache-control": "private, no-store" }),
  json: { batches: [{ id: 41, reason: employer.reason, status: "pending",
    shiftDefinitionId: 31, requestedByUserId: 52, requestedBy: employer.makerName,
    overrideCount: 0,
    employees: [{ id: 21, employeeNo: employer.marker, name: "Table " + employer.marker }] }] },
};
test("a positive read cannot accept an empty list or another employer's data", () => {
  assert.doesNotThrow(() => assertOwnedRosterRead(response, employer));
  assert.throws(() => assertOwnedRosterRead(response, { ...employer, batchId: 42 }));
  assert.throws(() => assertOwnedRosterRead(response, { ...employer, marker: "FOREIGN" }));
  assert.throws(() => assertOwnedRosterRead({ ...response, json: { batches: [] } }, employer));
});
const now = new Date("2026-10-27T00:00:00.000Z");
const before = {
  batches: [{
    id: 41, organizationId: 11, workDate: "2026-11-10",
    shiftDefinitionId: 31, employeeIds: [21], evidenceSha256: "a".repeat(64),
    requestSha256: "b".repeat(64), idempotencyKey: "fictional_unique_key_0001",
    reason: employer.reason, requestedByUserId: 52, requestedByName: employer.makerName,
    requestedAt: now, overrideIds: [], createdAt: now, updatedAt: now,
    status: "pending", decidedByUserId: null, decidedByName: null,
    decidedAt: null, decisionNote: null,
  }],
  audits: [], staff: [{ id: 21 }], shifts: [{ id: 31 }],
  overrides: [], payroll: [], punches: [], leaves: [],
};
test("reject proof demands an actual persisted transition and exact actor audit", () => {
  const after = structuredClone(before);
  after.batches[0].status = "rejected";
  after.batches[0].decidedByUserId = employer.ownerId;
  after.batches[0].decidedByName = employer.ownerName;
  after.batches[0].decidedAt = new Date(now.getTime() + 10_000);
  after.batches[0].updatedAt = new Date(now.getTime() + 10_000);
  after.batches[0].decisionNote = employer.note;
  after.audits.push({
    organizationId: 11, actor: employer.ownerName,
    action: "WFM bulk roster batch rejected", resource: "Batch #41",
    metadata: { batchId: 41, reason: employer.note },
  });
  const own = { status: 200, json: { id: 41, status: "rejected" } };
  assert.doesNotThrow(() => assertRejectedRosterMutation(before, after, employer, own));
  assert.throws(() => assertRejectedRosterMutation(before, before, employer, own),
    "a successful HTTP response without an actual DB change is not a proof");
  assert.throws(() => assertRejectedRosterMutation(before, { ...after, audits: [] }, employer, own));
  assert.throws(() => assertRejectedRosterMutation(before,
    { ...after, staff: [{ id: 999 }] }, employer, own));
  assert.throws(() => assertRejectedRosterMutation(before, after,
    { ...employer, ownerId: 999 }, own));
  assert.doesNotThrow(() => assertUnchangedState(before, structuredClone(before), "foreign denial"));
  assert.throws(() => assertUnchangedState(before, after, "foreign denial"));
});
test("route still binds selected employer, real batch ID and maker/checker for rejection", () => {
  const route = readFileSync("src/app/api/workforce/roster-batches/route.ts", "utf8");
  assert.match(route, /eq\(workforceRosterBatches\.organizationId, organizationId\)/);
  assert.match(route, /eq\(workforceRosterBatches\.id, batchId\)/);
  assert.match(route, /canReviewRosterBatch\(batch\.requestedByUserId, user\.id\)/);
  assert.match(route, /if \(action === "reject"\)/);
  assert.match(route, /WFM bulk roster batch rejected/);
});
