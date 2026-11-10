/** Fictional-only, narrow resolve/reopen proof; never a whole-method credit. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const ORIGIN = "http://127.0.0.1:3000";
export const ROUTE = "/api/automation-studio";
export const SOURCE_BLOBS = Object.freeze({
  "src/app/api/automation-studio/route.ts": "3bfc6666644ca11b480cf2735e9563d46139ebf4",
  "src/lib/automation-operational-cases.ts": "5355d830524f54e6d47dd551c9d7bc5e73649f52",
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
  "src/lib/access.ts": "08d3481dbd20279a4a8aef64f0932f79bec48444",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e",
});
export const REQUIRED_ENV = Object.freeze({
  CI: "true", GITHUB_ACTIONS: "true", NODE_ENV: "production",
  BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
  TENANT_STUDIO_RESOLUTION_PROOF: "fictional-pg16-only",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  APP_BASE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN, SECURITY_SMOKE_URL: ORIGIN,
  REQUIRE_PRIVILEGED_MFA: "true", DEMO_MODE: "false", WORKER_ENABLED: "false",
  CENTRAL_SCHEDULER_ENABLED: "false", PAYMONGO_DISBURSEMENTS_ENABLED: "false",
  XENDIT_PAYOUTS_ENABLED: "false", XENDIT_BILLING_ENABLED: "false",
  FINAL_PAY_SIGNED_REVIEW_ENABLED: "false", EXACT_THIRTEENTH_CENTAVOS_ENABLED: "false",
  PAYROLL_CALCULATION_HISTORY_ENABLED: "false", NEXT_CSP_ENABLED: "false",
});
export const FORBIDDEN_ENV = Object.freeze([
  "NEON_DATABASE_URL", "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET",
  "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY", "XENDIT_CALLBACK_TOKEN",
  "STRIPE_SECRET_KEY", "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN",
  "SMTP_URL", "SMTP_PASSWORD", "OPENAI_API_KEY", "CRON_SECRET", "WORKER_TOKEN",
]);
export function requireDisposableResolutionEnv(env = process.env) {
  for (const [key, value] of Object.entries(REQUIRED_ENV))
    assert.equal(env[key], value, "STUDIO_RESOLUTION_REFUSED: " + key);
  for (const key of FORBIDDEN_ENV)
    assert.ok(!env[key], "STUDIO_RESOLUTION_REFUSED: credential " + key);
  return true;
}
export function gitBlobSha(bytes) {
  const buffer = Buffer.from(bytes);
  return createHash("sha1").update("blob " + buffer.length + "\0").update(buffer).digest("hex");
}
export function verifyResolutionSources(root = process.cwd()) {
  for (const [file, hash] of Object.entries(SOURCE_BLOBS))
    assert.equal(gitBlobSha(readFileSync(root + "/" + file)), hash,
      "STUDIO_RESOLUTION_REFUSED: re-review changed source " + file);
  return true;
}
export function assertNoMarkers(response, actors, label) {
  assert.equal(typeof response?.text, "string", label + ": response body required");
  const decoded = response.text.replace(/\\u([0-9a-fA-F]{4})/g,
    (_, value) => String.fromCharCode(Number.parseInt(value, 16)));
  for (const actor of actors) {
    assert.ok(actor.marker, "real private marker required");
    assert.ok(!decoded.includes(actor.marker), label + ": private marker leaked");
  }
}
export function assertDenied(response, status, actors, label) {
  assert.equal(response?.status, status, label + ": exact denial required");
  assert.equal(response.json?.operationalCase, undefined, label + ": denied case disclosed");
  assertNoMarkers(response, actors, label);
}
export function assertUnchanged(before, after, label) {
  assert.deepEqual(after, before, label + ": protected SQL changed");
}
export function assertAuditRollback(before, after, hitsBefore, hitsAfter) {
  assert.equal(hitsAfter, hitsBefore + 1, "audit veto must actually be reached once");
  assertUnchanged(before, after, "reached audit veto rollback");
}
export function assertHigherVictim(actors, victim) {
  for (const key of ["org", "owner", "entity", "unit", "worker", "membership", "profile", "source", "case", "payroll"]) {
    const id = victim[key]?.id;
    assert.ok(Number.isSafeInteger(id) && id > 6, "persisted victim " + key + " must exceed six");
    for (const actor of actors)
      assert.ok(id > actor[key].id, "victim " + key + " must exceed both owners");
  }
}
const validTime = value => typeof value === "string" && Number.isFinite(Date.parse(value));
export function assertOwnedTransition(response, before, after, actor, transition, note, others = []) {
  assert.ok(["resolve", "reopen"].includes(transition), "only reviewed transitions");
  assert.equal(response?.status, 200, "real own HTTP 200 required");
  assert.deepEqual(Object.keys(response.json ?? {}).sort(),
    ["operationalCase", "sourceMutation", "executionStatusUnchanged"].sort());
  assert.equal(response.json.sourceMutation, false);
  assert.equal(response.json.executionStatusUnchanged, true);
  const oldRows = before.automationOperationalCases, newRows = after.automationOperationalCases;
  assert.equal(newRows.length, oldRows.length, "case cardinality changed");
  const old = oldRows.find(row => row.id === actor.case.id);
  const row = newRows.find(item => item.id === actor.case.id);
  assert.ok(old && row, "persisted own case must exist before and after");
  assert.equal(old.organizationId, actor.org.id);
  assert.equal(row.organizationId, actor.org.id);
  assert.equal(old.status, transition === "resolve" ? "acknowledged" : "resolved");
  assert.equal(row.status, transition === "resolve" ? "resolved" : "open");
  assert.deepEqual(response.json.operationalCase, row, "HTTP must equal persisted SQL row");
  assert.ok(row.title.includes(actor.marker), "nonempty own marker required");
  assert.ok(validTime(row.updatedAt), "updatedAt must be a timestamp");
  const mutable = new Set(["status", "updatedAt", "resolvedByUserId", "resolvedByName", "resolvedAt", "resolutionNote"]);
  if (transition === "resolve") {
    assert.equal(row.resolvedByUserId, actor.owner.id);
    assert.equal(row.resolvedByName, actor.owner.name);
    assert.ok(validTime(row.resolvedAt));
    assert.equal(row.resolutionNote, note);
  } else {
    for (const key of ["acknowledgedByUserId", "acknowledgedByName", "acknowledgedAt",
      "resolvedByUserId", "resolvedByName", "resolvedAt", "resolutionNote"]) {
      mutable.add(key);
      assert.equal(row[key], null, "reopen must clear " + key);
    }
  }
  for (const key of Object.keys(old))
    if (!mutable.has(key)) assert.deepEqual(row[key], old[key], "unexpected changed case field: " + key);
  assert.deepEqual(newRows.filter(item => item.id !== actor.case.id),
    oldRows.filter(item => item.id !== actor.case.id), "unrelated cases changed");
  assert.equal(after.auditEvents.length, before.auditEvents.length + 1, "exactly one audit required");
  assert.deepEqual(after.auditEvents.slice(0, -1), before.auditEvents, "previous audits changed");
  const audit = after.auditEvents.at(-1);
  assert.equal(audit.organizationId, actor.org.id);
  assert.equal(audit.actor, actor.owner.name);
  assert.equal(audit.action, "Automation operations case " + transition);
  assert.equal(audit.resource, row.title);
  assert.deepEqual(audit.metadata, {
    caseId: row.id, caseType: row.caseType, sourceType: row.sourceType,
    sourceId: row.sourceId, executionId: row.executionId, stepIndex: row.stepIndex,
    note, sourceMutation: false, underlyingExecutionStatusUnchanged: true,
  });
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  for (const [table, values] of Object.entries(before))
    if (!["automationOperationalCases", "auditEvents"].includes(table))
      assert.deepEqual(after[table], values, "own transition changed " + table);
  assertNoMarkers(response, others, "own transition");
}
if (process.argv[1]?.endsWith("tenant-studio-resolution-contract.mjs")) {
  if (process.argv.includes("--check-env")) requireDisposableResolutionEnv();
  if (process.argv.includes("--check-sources")) verifyResolutionSources();
}
