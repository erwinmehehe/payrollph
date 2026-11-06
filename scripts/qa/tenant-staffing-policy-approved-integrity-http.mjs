/**
 * #1780 exact-source disposable PG16 / production Next HTTP re-proof candidate.
 * This does not re-pin historical evidence, award any coverage credit, or
 * authorize production staffing, payroll or provider use.
 */
import assert from "node:assert/strict";
import {
  STAFFING_ENDPOINT, requireDisposableStaffingWrites, assertNoForeignPolicy,
} from "./tenant-wrk01-staffing-writes-contract.mjs";
import { assertNonCacheableDemand } from "./tenant-demand-governance-recovery-contract.mjs";

requireDisposableStaffingWrites(); // Fail closed before ANY DB or application import.
const [database, s, drizzle, helpers, guards, calendar] = await Promise.all([
  import("../../src/db/index.ts"),
  import("../../src/db/schema.ts"),
  import("drizzle-orm"),
  import("./tenant-table-http.mjs"),
  import("./tenant-table-invariants.mjs"),
  import("../../src/lib/workforce-employee-upcoming-week.ts"),
]);
const { db, pool } = database;
const { and, asc, eq } = drizzle;
const request = helpers.standaloneRequest;
const [victim, a, b] = guards.readAllowlistPreseed(
  process.env.TENANT_TABLE_ALLOWLIST_FIXTURE);
const excluded = guards.readPrivateAllowlistFixture(
  process.env.TENANT_TABLE_ALLOWLIST_FIXTURE).excluded;
const allEmployers = [a, b, victim, excluded];
const plain = obj => JSON.parse(JSON.stringify(obj));
const tomorrow = calendar.manilaWorkDate();
function futureDay(offset) {
  const date = new Date(tomorrow + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
async function employerSnapshot(e) {
  const rows = {};
  for (const name of [
    "organizations", "workforceDemandStaffingPolicies",
    "workforceDemandStaffingPolicyEvents", "auditEvents", "payrollRuns",
  ]) {
    const t = s[name];
    rows[name] = await db.select().from(t)
      .where(eq(name === "organizations" ? t.id : t.organizationId, e.org.id))
      .orderBy(asc(t.id));
  }
  return plain(rows);
}
async function foreignSnapshots(e) {
  return new Map(await Promise.all(allEmployers.filter(x => x !== e)
    .map(async other => [other.org.id, await employerSnapshot(other)])));
}
async function unchangedForeign(e, snapshots, what) {
  for (const other of allEmployers.filter(x => x !== e)) {
    assert.deepEqual(await employerSnapshot(other), snapshots.get(other.org.id),
      what + ": changed foreign employer " + other.marker);
  }
}
async function setup(e) {
  const [site] = await db.insert(s.worksites).values({
    organizationId: e.org.id, orgUnitId: e.unit.id,
    code: (e.marker + "-HASH").slice(0, 32),
    name: e.marker + " fictional hash-integrity worksite",
    timezone: "Asia/Manila", active: true,
  }).returning();
  const [job] = await db.insert(s.jobProfiles).values({
    organizationId: e.org.id, title: e.marker + " fictional advisory job",
    family: "General", level: "Individual Contributor", active: true,
  }).returning();
  const [checker] = await db.insert(s.users).values({
    email: e.marker.toLowerCase() + "-hash-checker@example.invalid",
    name: e.marker + " fictional independent checker",
    role: "admin", totpEnabled: true,
    passwordHash: "fictional-nonlogin",
  }).returning();
  await db.insert(s.userOrganizations).values({
    userId: checker.id, organizationId: e.org.id,
    role: "admin", active: true, orgUnitId: null,
  });
  const session = await helpers.standaloneMakeSession(checker.id);
  await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
    .where(eq(s.sessions.id, session.id));
  e.site = site;
  e.job = job;
  e.checker = { id: checker.id, cookie: session.cookie };
}
function scope(e, mode = "approved") {
  return STAFFING_ENDPOINT + "?" + new URLSearchParams({
    organizationId: String(e.org.id),
    worksiteId: String(e.site.id),
    jobProfileId: String(e.job.id),
    metricKind: "transactions", intervalMinutes: "60", mode,
  });
}
async function read(e, mode) {
  const response = await request(scope(e, mode), { cookie: e.cookie });
  assert.equal(response.status, 200, response.text.slice(0, 300));
  assertNonCacheableDemand(response.headers);
  assert.equal(response.json?.readOnly, true);
  assert.equal(response.json.scope.organizationId, e.org.id);
  assertNoForeignPolicy(response, allEmployers.filter(other => other !== e)
    .map(other => other.marker));
  return response.json?.policies ?? [];
}
async function verified(e, visible, integrity, label) {
  const before = await employerSnapshot(e);
  const approved = await read(e, "approved");
  const manages = await read(e, "manage");
  assert.equal(approved.some(p => p.id === e.policy.id), visible,
    label + ": approved-only eligibility should fail closed");
  if (visible) {
    assert.equal(approved.find(p => p.id === e.policy.id).approvalIntegrity,
      "matches_hash", label);
  }
  const managed = manages.find(p => p.id === e.policy.id);
  assert.ok(managed, label + ": management must retain visible audit record");
  assert.equal(managed.approvalIntegrity, integrity, label);
  assert.deepEqual(await employerSnapshot(e), before,
    label + ": GET must not mutate own SQL or audit");
}
async function approve(e) {
  const body = {
    organizationId: e.org.id, worksiteId: e.site.id,
    jobProfileId: e.job.id, metricKind: "transactions",
    intervalMinutes: 60, effectiveFrom: futureDay(14),
    effectiveUntil: futureDay(44), productiveUnitsPerWorkerHour: 11,
    serviceTargetCoveragePercent: 84,
    rationale: e.marker + " fictional approved-only integrity case",
    idempotencyKey: "ci-" + e.marker.toLowerCase() + "-approved-hash-integrity",
  };
  const draft = await request(STAFFING_ENDPOINT, {
    method: "POST", cookie: e.cookie, body,
  });
  assert.equal(draft.status, 201, draft.text.slice(0, 300));
  assert.ok(Number.isSafeInteger(draft.json?.id));
  const transition = action => ({
    organizationId: e.org.id, policyId: draft.json.id,
    action, decisionNote: e.marker + " fictional " + action,
    acknowledged: true,
  });
  const submitted = await request(STAFFING_ENDPOINT, {
    method: "PATCH", cookie: e.cookie, body: transition("submit"),
  });
  assert.equal(submitted.status, 200, submitted.text.slice(0, 300));
  const approved = await request(STAFFING_ENDPOINT, {
    method: "PATCH", cookie: e.checker.cookie, body: transition("approve"),
  });
  assert.equal(approved.status, 200, approved.text.slice(0, 300));
  const [row] = await db.select().from(s.workforceDemandStaffingPolicies)
    .where(and(eq(s.workforceDemandStaffingPolicies.id, draft.json.id),
      eq(s.workforceDemandStaffingPolicies.organizationId, e.org.id)))
    .limit(1);
  assert.equal(row?.status, "approved");
  const [event] = await db.select().from(s.workforceDemandStaffingPolicyEvents)
    .where(and(eq(s.workforceDemandStaffingPolicyEvents.organizationId, e.org.id),
      eq(s.workforceDemandStaffingPolicyEvents.policyId, row.id),
      eq(s.workforceDemandStaffingPolicyEvents.action, "approved")))
    .limit(1);
  assert.ok(event && event.receiptSha256);
  e.policy = row;
  e.event = event;
  await verified(e, true, "matches_hash", e.marker + " valid approved");
}
async function prove() {
  const version = await pool.query("show server_version_num");
  assert.equal(Math.floor(Number(version.rows[0].server_version_num) / 10000), 16);
  assert.equal((await db.select().from(s.workforceDemandStaffingPolicies).limit(1)).length, 0,
    "must be an initially empty disposable staffing policy store");
  for (const e of allEmployers) assert.ok(e.org?.id > 0 && e.cookie);
  for (const e of [a, b, victim]) await setup(e);
  assert.ok(victim.site.id > b.site.id && victim.site.id > a.site.id);
  for (const e of [a, b, victim]) await approve(e);
  assert.ok(victim.policy.id > a.policy.id && victim.policy.id > b.policy.id,
    "real victim target must have a higher primary key");
  const originalVictim = await employerSnapshot(victim);

  for (const actor of [a, b]) {
    const before = await employerSnapshot(victim);
    const foreign = await request(scope(victim, "approved"), { cookie: actor.cookie });
    assert.equal(foreign.status, 403,
      "foreign employer GET must deny rather than reveal real victim policy");
    assert.ok(!foreign.text.includes(victim.marker));
    assert.deepEqual(await employerSnapshot(victim), before,
      "foreign probe must not change victim SQL/audit");
  }

  for (const e of [a, b]) {
    const foreignBefore = await foreignSnapshots(e);
    // A database-tampered content hash cannot remain eligible.
    await db.update(s.workforceDemandStaffingPolicies)
      .set({ contentSha256: "f".repeat(64) })
      .where(eq(s.workforceDemandStaffingPolicies.id, e.policy.id));
    await verified(e, false, "source_review", e.marker + " tampered content");
    await unchangedForeign(e, foreignBefore, "content tamper GET");
    await db.update(s.workforceDemandStaffingPolicies)
      .set({ contentSha256: e.policy.contentSha256 })
      .where(eq(s.workforceDemandStaffingPolicies.id, e.policy.id));
    await verified(e, true, "matches_hash", e.marker + " restored content");

    // A mismatching independent approval-event receipt also fails closed.
    await db.update(s.workforceDemandStaffingPolicyEvents)
      .set({ receiptSha256: "f".repeat(64) })
      .where(eq(s.workforceDemandStaffingPolicyEvents.id, e.event.id));
    await verified(e, false, "source_review", e.marker + " tampered receipt");
    await unchangedForeign(e, foreignBefore, "receipt tamper GET");
    await db.update(s.workforceDemandStaffingPolicyEvents)
      .set({ receiptSha256: e.event.receiptSha256 })
      .where(eq(s.workforceDemandStaffingPolicyEvents.id, e.event.id));
    await verified(e, true, "matches_hash", e.marker + " restored receipt");
    await unchangedForeign(e, foreignBefore, "restored own policy");
  }
  // A missing approval event must be rejected just like a tampered receipt.
  const foreignBeforeMissing = await foreignSnapshots(a);
  await db.delete(s.workforceDemandStaffingPolicyEvents)
    .where(eq(s.workforceDemandStaffingPolicyEvents.id, a.event.id));
  await verified(a, false, "source_review", "missing signed approval event");
  await unchangedForeign(a, foreignBeforeMissing, "missing receipt GET");
  await verified(b, true, "matches_hash", "intact second owner after missing event");
  assert.deepEqual(await employerSnapshot(victim), originalVictim);
  console.log(JSON.stringify({
    kind: "STAFFING_APPROVED_INTEGRITY_HTTP",
    result: "PASS", postgres: 16,
    attackers: 2, higherIdVictim: victim.policy.id,
    validOwnApproved: true, tamperedContentDenied: true,
    tamperedReceiptDenied: true, missingReceiptDenied: true,
    managementAuditVisible: true, foreignAndVictimSqlUnchanged: true,
    coverageCredits: 0, productionCertified: false,
    payrollOrProviderOperations: 0,
  }));
}
try { await prove(); } finally { await pool.end(); }
