import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { requireDisposableRosterBatch } from "../../scripts/qa/tenant-batches/roster-batches-guard.mjs";

const script = readFileSync("scripts/qa/tenant-batches/roster-batches-actions-http.mjs", "utf8");
const original = readFileSync("scripts/qa/tenant-batches/roster-batches-http.mjs", "utf8");
const originalProof = readFileSync("scripts/qa/tenant-batches/roster-batches-proof.mjs", "utf8");
const workflow = readFileSync(".github/workflows/tenant-roster-batches-http.yml", "utf8");
const route = readFileSync("src/app/api/workforce/roster-batches/route.ts", "utf8");

const env = {
  CI: "true", NODE_ENV: "production", TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  WFM_BULK_ROSTER_PUBLISH_ENABLED: "true",
  WFM_BULK_ROSTER_ALLOWED_ORGANIZATION_IDS: "11,12,13",
};

test("roster action candidate still requires exactly three disposable employers", () => {
  assert.deepEqual(requireDisposableRosterBatch(env, "prove"), [11, 12, 13]);
  for (const patch of [
    { DATABASE_URL: "postgresql://postgres:postgres@prod.invalid:5432/app_db" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db?host=remote.invalid" },
    { SECURITY_SMOKE_URL: "https://example.invalid" },
    { WFM_BULK_ROSTER_ALLOWED_ORGANIZATION_IDS: "11,12" },
    { WFM_BULK_ROSTER_ALLOWED_ORGANIZATION_IDS: "*" },
    { WORKER_ENABLED: "true" },
    { XENDIT_PAYOUTS_ENABLED: "true" },
    { PAYMONGO_SECRET_KEY: "secret" },
  ]) assert.throws(() => requireDisposableRosterBatch({ ...env, ...patch }, "prove"));
  assert.match(script, /requireDisposableRosterBatch\(process\.env, "prove"\)/);
  assert.ok(script.indexOf('requireDisposableRosterBatch(process.env, "prove")') <
    script.indexOf('import("../../../src/db/index.ts")'),
  "Disposable refusal must happen before any application DB import");
  assert.doesNotMatch(script, /from ["']\.\.\/\.\.\/\.\.\/src\/db/);
  assert.match(script, /constants\.O_NOFOLLOW/);
  assert.match(script, /stat\.uid === process\.getuid\(\)/);
  assert.match(script, /stat\.mode & 0o077/);
});

test("seed gives ATTA, ATTB and VICTIM genuine shift, schedule and worksite evidence", () => {
  for (const essential of [
    '["ATTA", "ATTB", "VICTIM"]',
    'futureMonday()',
    'db.insert(s.shiftDefinitions)',
    'db.insert(s.schedulePatterns)',
    'db.insert(s.schedulePatternDays)',
    'db.insert(s.schedulePatternSegments)',
    'db.insert(s.employeeScheduleAssignments)',
    'db.insert(s.worksites)',
    'db.insert(s.employeeWorksiteAssignments)',
    'decision: "allow"',
    'active: true',
    'cycleDays: 7',
    'dayIndex >= 5',
    'db.insert(s.users)',
    'db.insert(s.userOrganizations)',
    't.standaloneMakeSession(checker.id)',
    'mfaVerifiedAt: new Date()',
    'ROSTER_BATCH_ACTION_FIXTURE_FILE=',
  ]) assert.ok(script.includes(essential), "Real roster seed missing " + essential);
  assert.match(script, /assert\.equal\(worker\?\.status, "Active"\)/);
  assert.match(script, /targetShiftId > employers\[0\]\.targetShiftId/);
  assert.match(script, /targetShiftId > employers\[1\]\.targetShiftId/);
});

test("all three action positives are independently distinguished by persistent SQL and audit", () => {
  for (const exact of [
    'initial.batches.find(batch => batch.id === e.legacyBatchId)',
    'event.action === "WFM bulk roster batch rejected"',
    'check(await post(e, stageBody(e)), 201',
    'check(await post(e, stageBody(e)), 200',
    'assert.equal(replay.json?.replayed, true)',
    'assert.equal(after.batches.length, before.batches.length + 1)',
    'assert.equal(row.requestSha256, requestDigest',
    'assert.match(row.evidenceSha256, /^[a-f0-9]{64}$/)',
    'assert.equal(receipt.action, "WFM bulk roster batch staged")',
    'assert.equal(receipt.metadata?.evidenceSha256, row.evidenceSha256)',
    'assert.deepEqual(after.overrides, before.overrides',
    'assert.equal(row.decidedByUserId, e.checkerId)',
    'assert.equal(override.employeeId, e.workerId)',
    'assert.equal(override.worksiteId, e.worksiteId)',
    'assert.deepEqual(override.segments,',
    'assert.equal(receipt.action, "WFM governed bulk roster published")',
    'assert.equal(receipt.metadata?.checkerUserId, e.checkerId)',
    'assert.equal(receipt.metadata?.sourceEvidenceSha256, e.evidenceSha256)',
    'ownIndependentRejectHttp200: 3',
    'independentReview: "PENDING", newCredits: 0',
  ]) assert.ok(script.includes(exact), "Discriminating roster action evidence missing: " + exact);
  assert.match(script, /for \(const e of employers\) \{/);
  assert.match(script, /e\.checkerCookie\), 200/);
  assert.match(original, /assertRejectedRosterMutation\(oldVictim,/);
  assert.match(originalProof, /WFM bulk roster batch rejected/);
  assert.match(route, /canReviewRosterBatch\(batch\.requestedByUserId, user\.id\)/);
});

test("attacker forged references and maker self-approval cannot mutate any employer", () => {
  for (const exact of [
    'employeeIds: [victim.workerId], idempotencyKey: unique()',
    'shiftDefinitionId: victim.targetShiftId, idempotencyKey: unique()',
    'organizationId: victim.orgId, employeeIds: [victim.workerId]',
    'victim.stageBatchId, actor.decisionNote), 404',
    'victim.stageBatchId, actor.decisionNote), 403',
    'e.stageBatchId, e.decisionNote), 403',
    'assert.equal(denied, 12)',
    'assert.deepEqual(await snapshot(e.orgId), expected.get(e.orgId)',
    'assert.deepEqual(after.batches.filter(batch => batch.id !== row.id)',
  ]) assert.ok(script.includes(exact), "Tenant/maker denial evidence missing: " + exact);
  assert.ok(script.includes("roster, overrides and raw audit must stay byte-identical"));
  assert.match(script, /assert\.ok\(!result\.text\.includes\(victim\.marker\)/);
  assert.match(script, /await unchanged\(label\)/);
});

test("dedicated workflow runs old receipt-pinned rejection first and all-actions proof afterward", () => {
  assert.match(workflow, /image: postgres:16/);
  const originalSeed = workflow.indexOf("roster-batches-http.mjs seed");
  const newSeed = workflow.indexOf("roster-batches-actions-http.mjs seed");
  const originalProve = workflow.indexOf("roster-batches-http.mjs prove");
  const newProve = workflow.indexOf("roster-batches-actions-http.mjs prove");
  assert.ok(originalSeed >= 0 && originalSeed < newSeed &&
    newSeed < originalProve && originalProve < newProve,
  "Original reject receipts must remain intact and execute before the new stage/approve HTTP");
  assert.match(workflow, /node --test tests\/tenant-\*\.test\.mjs/);
  assert.match(workflow, /npm run lint/);
  assert.doesNotMatch(script, /tenant-write-table-http\.mjs/);
});

test("route POST stays uncredited until new full-branch HTTP proof and independent review", () => {
  const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const method = manifest.allApiRouteFiles["src/app/api/workforce/roster-batches/route.ts"]
    .methods.find(row => row.name === "POST");
  // This source-only PR never turns a CI job which has not run into a receipt.
  if (method.status === "GAP") {
    assert.equal(method.testedBy, null);
  } else {
    assert.equal(method.status, "COVERED");
    assert.equal(method.testedBy?.independentSecurityReview, "PENDING");
    assert.ok(method.testedBy?.runLabel && method.testedBy?.workflowRunId,
      "Any future POST promotion requires an actual exact-head CI receipt");
  }
});
