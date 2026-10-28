/**
 * Uncredited GET/POST /api/self/availability tenant-isolation contract.
 * Pure, fail-closed verifiers. Database/HTTP imports are in the guarded runner.
 * All fixtures are fictional. This contract does not enable production flags
 * or grant any tenant-isolation method coverage credits.
 */
import assert from "node:assert/strict";
import { requireSensitiveNoStoreCache } from "./tenant-self-availability-guard.mjs";

export const ENDPOINT = "/api/self/availability";
export const METHODS = Object.freeze([
  "GET self/availability", "POST self/availability",
]);
const SOURCE = "employee_availability_rules";
const STABLE_SOURCES = Object.freeze([
  "employees", "memberships", "payroll", "assignments", "punches", "leaves",
]);

export function requireDisposableAvailability(env = process.env) {
  let app, database;
  try {
    app = new URL(env.SECURITY_SMOKE_URL);
    database = new URL(env.DATABASE_URL);
  } catch {
    throw Error("AVAILABILITY_TENANT_REFUSED: explicit local HTTP and SQL endpoints required");
  }
  const providers = [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL",
    "STRIPE_SECRET_KEY", "NEON_API_KEY",
  ];
  const safe =
    env.GITHUB_ACTIONS === "true" &&
    env.CI === "true" &&
    env.NODE_ENV === "production" &&
    env.DEMO_MODE === "false" &&
    env.TENANT_SECOND_PASS_MODE === "isolated-ci-only" &&
    env.TENANT_AVAILABILITY_MODE === "fictional-only" &&
    env.WFM_EMPLOYEE_AVAILABILITY_ENABLED === "true" &&
    env.WORKER_ENABLED === "false" &&
    env.CENTRAL_SCHEDULER_ENABLED === "false" &&
    env.PAYMONGO_DISBURSEMENTS_ENABLED === "false" &&
    env.XENDIT_PAYOUTS_ENABLED === "false" &&
    env.XENDIT_BILLING_ENABLED === "false" &&
    env.HCM_OVERPAYMENT_PREVIEW_ENABLED === "false" &&
    env.PAYROLL_OVERPAYMENT_REVIEW_ENABLED === "false" &&
    String(env.WORKER_TOKEN ?? "").startsWith("ci-worker-token-") &&
    app.href === "http://127.0.0.1:3000/" &&
    database.href === "postgresql://postgres:postgres@127.0.0.1:5432/app_db" &&
    !providers.some(name => env[name]);
  if (!safe) {
    throw Error("AVAILABILITY_TENANT_REFUSED: fictional GitHub Actions PG16, isolated localhost HTTP, no workers, billing, payouts or provider secrets required");
  }
}

export function assertNoPrivateMarkers(response, markers = []) {
  for (const marker of markers) {
    if (marker) assert.ok(!String(response.text ?? "").includes(marker),
      "employee availability response must not reveal a peer or victim marker");
  }
}

function privateHeaders(response) {
  // Next.js normalizes private,no-store to no-store,max-age=0 in some builds.
  // Reuse the established source guard rather than asserting one serialization.
  requireSensitiveNoStoreCache(response.headers);
  const vary = response.headers?.get?.("vary");
  if (vary) assert.match(vary, /cookie/i,
    "employee availability must vary by authenticated cookie");
}

function exactEnvelope(json, names) {
  assert.ok(json && typeof json === "object" && !Array.isArray(json),
    "availability HTTP response must be JSON object");
  assert.deepEqual(Object.keys(json).sort(), [...names].sort(),
    "availability response may not contain added private or invented fields");
}

export function assertUnchanged(before, after, label) {
  assert.deepEqual(after, before, label + ": all SQL source and audit rows must be unchanged");
}

function stableSources(before, after) {
  for (const key of STABLE_SOURCES) {
    assert.deepEqual(after[key], before[key],
      "ESS availability must not change " + key + " personnel, schedule or payroll data");
  }
}

function auditAddition(before, after, actor, action, resource, metadata) {
  assert.equal(after.audit.length, before.audit.length + 1,
    "one own ESS availability action must produce exactly one source audit row");
  assert.deepEqual(after.audit.slice(0, -1), before.audit,
    "existing employer audit business rows must remain unchanged");
  const row = after.audit.at(-1);
  assert.ok(Number.isSafeInteger(row.id) && row.id > 0,
    "audit row must have a real INSERT ID");
  assert.equal(row.organizationId, actor.org.id);
  assert.equal(row.actor, actor.self.name);
  assert.equal(row.action, action);
  assert.equal(row.resource, resource);
  assert.deepEqual(row.metadata, metadata);
}

export function projectOwnRules(allRows, actor, today) {
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  const rows = allRows.filter(row =>
    row.organizationId === actor.org.id &&
    row.employeeId === actor.worker.id &&
    (row.effectiveUntil == null || row.effectiveUntil >= today));
  return rows.sort((a, b) =>
    a.weekday - b.weekday ||
    String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)) ||
    a.id - b.id)
    .map(row => ({
      id: row.id, weekday: row.weekday,
      startTime: String(row.startTime).slice(0, 5),
      endTime: String(row.endTime).slice(0, 5),
      availabilityType: row.availabilityType === "preferred" ? "preferred" :
        row.availabilityType === "unavailable" ? "unavailable" : "unknown",
      effectiveFrom: String(row.effectiveFrom),
      effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
      notes: row.notes,
    }));
}

export function assertOwnAvailability(response, actor, allRows, today, forbidden = []) {
  assert.equal(response.status, 200, "own employee must GET nonempty 200");
  exactEnvelope(response.json, ["rules", "partial", "source", "note"]);
  privateHeaders(response);
  assert.equal(response.json.source, SOURCE);
  assert.equal(response.json.partial, false);
  assert.match(response.json.note, /not published shifts or approved leave/i);
  const expected = projectOwnRules(allRows, actor, today);
  assert.ok(expected.length > 0,
    "the proof requires persisted own SQL rules, never an empty 200");
  assert.ok(expected.length <= 60);
  assert.ok(expected.every(r => Number.isSafeInteger(r.id) && r.id > 0));
  assert.deepEqual(response.json.rules, expected,
    "GET must match every real own rule and exclude other employees and employers");
  assert.ok(response.json.rules.some(row =>
    typeof row.notes === "string" && row.notes.includes(actor.marker + " PRIVATE")),
    "GET must read the unique persisted own employee marker");
  assertNoPrivateMarkers(response, forbidden);
  return expected;
}

export function assertCreated(before, after, actor, response, draft) {
  assert.equal(response.status, 201, "own availability create must return HTTP 201");
  privateHeaders(response);
  exactEnvelope(response.json,
    ["id", "saved", "publishedRosterChanged", "payrollMutationPerformed"]);
  assert.equal(response.json.saved, true);
  assert.equal(response.json.publishedRosterChanged, false);
  assert.equal(response.json.payrollMutationPerformed, false);
  stableSources(before, after);
  assert.equal(after.rules.length, before.rules.length + 1,
    "one real own employee availability rule must be inserted");
  assert.deepEqual(after.rules.slice(0, -1), before.rules,
    "old own and peer availability rows cannot change");
  const created = after.rules.at(-1);
  assert.ok(Number.isSafeInteger(created.id) && created.id > 0);
  assert.equal(response.json.id, created.id,
    "201 response ID must name actual inserted PostgreSQL row");
  assert.equal(created.organizationId, actor.org.id);
  assert.equal(created.employeeId, actor.worker.id);
  assert.equal(created.createdBy, actor.self.name);
  assert.equal(created.createdByUserId, actor.self.userId);
  for (const key of [
    "weekday", "availabilityType", "effectiveFrom", "effectiveUntil", "notes",
  ]) assert.equal(created[key], draft[key], "saved availability " + key);
  for (const key of ["startTime", "endTime"]) {
    assert.equal(String(created[key]).slice(0, 5), draft[key]);
  }
  auditAddition(before, after, actor,
    "Employee WFM availability preference created",
    actor.worker.employeeNo + " · rule #" + created.id,
    { employeeId: actor.worker.id, ruleId: created.id,
      weekday: draft.weekday, availabilityType: draft.availabilityType,
      effectiveFrom: draft.effectiveFrom, effectiveUntil: draft.effectiveUntil,
      timeWindow: [draft.startTime, draft.endTime],
      source: "self-service", publishedRosterChanged: false,
      payrollMutationPerformed: false });
  return created;
}

export function assertRemovedFuture(before, after, actor, response, target) {
  assert.equal(response.status, 200, "own future-rule removal must return HTTP 200");
  privateHeaders(response);
  exactEnvelope(response.json, [
    "removed", "disposition", "publishedRosterChanged", "payrollMutationPerformed",
  ]);
  assert.equal(response.json.removed, true);
  assert.equal(response.json.disposition, "delete_future_rule");
  assert.equal(response.json.publishedRosterChanged, false);
  assert.equal(response.json.payrollMutationPerformed, false);
  assert.equal(target.organizationId, actor.org.id);
  assert.equal(target.employeeId, actor.worker.id);
  stableSources(before, after);
  assert.equal(after.rules.length, before.rules.length - 1,
    "one own future availability rule must actually be deleted");
  assert.deepEqual(after.rules, before.rules.filter(row => row.id !== target.id),
    "removing a rule must preserve all other own and peer availability rows");
  auditAddition(before, after, actor,
    "Employee WFM availability preference withdrawn",
    actor.worker.employeeNo + " · rule #" + target.id,
    { employeeId: actor.worker.id, ruleId: target.id,
      disposition: "delete_future_rule",
      weekday: target.weekday, availabilityType: target.availabilityType,
      effectiveFrom: target.effectiveFrom,
      priorEffectiveUntil: target.effectiveUntil,
      publishedRosterChanged: false, payrollMutationPerformed: false });
}

export function assertPrivateDenial(response, expectedStatus, forbidden = []) {
  assert.equal(response.status, expectedStatus,
    "unexpected denied HTTP status: " + String(response.text).slice(0, 150));
  assert.ok(response.json && typeof response.json.error === "string",
    "denial must be a generic error");
  for (const key of [
    "rules", "id", "employeeId", "organizationId", "payroll",
    "audit", "saved", "removed", "createdByUserId",
  ]) assert.ok(!Object.hasOwn(response.json, key),
    "denial cannot expose " + key);
  assertNoPrivateMarkers(response, forbidden);
}
