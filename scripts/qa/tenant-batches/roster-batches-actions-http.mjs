/**
 * Independent POSIX-only synthetic PG16/localhost companion to the receipt-pinned
 * roster-batches-http.mjs. Run "seed" AFTER its seed, then run its original
 * "prove" BEFORE this script's "prove". No real tenant data or provider calls.
 *
 * No own POST is credited from an expected status alone: stage and approval
 * require SQL rows and exact actor-bound audit receipts for all three employers.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { requireDisposableRosterBatch } from "./roster-batches-guard.mjs";

const mode = process.argv[2];
assert.ok(mode === "seed" || mode === "prove", "ROSTER_ACTIONS_REFUSED: seed or prove required");
// Reject the target, money switches, workers and allowlist before DB imports.
const allowed = requireDisposableRosterBatch(process.env, "prove");
assert.equal(typeof process.getuid, "function", "ROSTER_ACTIONS_REFUSED: POSIX-only fixture");
assert.ok(constants.O_NOFOLLOW, "ROSTER_ACTIONS_REFUSED: O_NOFOLLOW required");
const API = "/api/workforce/roster-batches";

function readOwnedFixture(envName, prefix, version) {
  const file = process.env[envName];
  assert.ok(typeof file === "string" && file.startsWith("/tmp/" + prefix + "-") &&
    new RegExp("^/tmp/" + prefix + "-[A-Za-z0-9]+/fixture[.]json$").test(file),
  "ROSTER_ACTIONS_REFUSED: private fixture path mismatch");
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    assert.ok(stat.isFile() && stat.uid === process.getuid() &&
      (stat.mode & 0o077) === 0, "ROSTER_ACTIONS_REFUSED: unsafe fixture owner/mode");
    const data = JSON.parse(readFileSync(fd, "utf8"));
    assert.equal(data.version, version);
    assert.deepEqual(data.employers.map(e => e.label), ["ATTA", "ATTB", "VICTIM"]);
    assert.deepEqual(data.employers.map(e => e.orgId), allowed);
    return data;
  } finally { closeSync(fd); }
}

function futureMonday() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  const start = Date.parse(today + "T00:00:00Z");
  const weekDay = new Date(start).getUTCDay();
  const days = ((8 - weekDay) % 7 || 7) + 7;
  assert.ok(days >= 8 && days <= 14);
  return new Date(start + days * 86_400_000).toISOString().slice(0, 10);
}

async function dependencies() {
  const [{ db, pool }, s, t, { and, asc, eq }] = await Promise.all([
    import("../../../src/db/index.ts"),
    import("../../../src/db/schema.ts"),
    import("../tenant-table-http.mjs"),
    import("drizzle-orm"),
  ]);
  return { db, pool, s, t, and, asc, eq };
}

async function seed() {
  const old = readOwnedFixture("ROSTER_BATCH_FIXTURE_FILE", "roster-batches-proof", 1);
  const { db, pool, s, t, and, eq } = await dependencies();
  const workDate = futureMonday();
  try {
    const employers = [];
    for (const e of old.employers) {
      const [worker] = await db.select().from(s.employees).where(and(
        eq(s.employees.id, e.workerId),
        eq(s.employees.organizationId, e.orgId),
      )).limit(1);
      const [baseShift] = await db.select().from(s.shiftDefinitions).where(and(
        eq(s.shiftDefinitions.id, e.shiftId),
        eq(s.shiftDefinitions.organizationId, e.orgId),
      )).limit(1);
      assert.equal(worker?.status, "Active");
      assert.equal(baseShift?.active, true);
      assert.equal(baseShift?.spansMidnight, false);
      assert.ok(Number.isSafeInteger(worker.orgUnitId) && worker.orgUnitId > 0);
      const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
      const [target] = await db.insert(s.shiftDefinitions).values({
        organizationId: e.orgId, code: "RB-TGT-" + e.label + "-" + nonce,
        name: e.marker + " proposed shift", startTime: "10:00", endTime: "18:00",
        breakMinutes: 60, active: true, spansMidnight: false,
      }).returning();
      const [site] = await db.insert(s.worksites).values({
        organizationId: e.orgId, orgUnitId: worker.orgUnitId,
        code: "RB-SITE-" + e.label + "-" + nonce,
        name: e.marker + " governed fictional office", siteType: "office",
        timezone: "Asia/Manila", active: true,
      }).returning();
      const [siteGrant] = await db.insert(s.employeeWorksiteAssignments).values({
        organizationId: e.orgId, employeeId: worker.id, worksiteId: site.id,
        decision: "allow", effectiveFrom: "2026-01-05",
        reason: "Disposable employer-specific worksite authorization",
      }).returning();
      const [pattern] = await db.insert(s.schedulePatterns).values({
        organizationId: e.orgId, code: "RB-PAT-" + e.label + "-" + nonce,
        name: e.marker + " five-on-two-off schedule", cycleDays: 7, active: true,
      }).returning();
      const days = await db.insert(s.schedulePatternDays).values(
        Array.from({ length: 7 }, (_, dayIndex) => ({
          patternId: pattern.id, dayIndex, isRestDay: dayIndex >= 5,
          label: dayIndex >= 5 ? "Fictional rest" : "Fictional single shift",
        })),
      ).returning();
      await db.insert(s.schedulePatternSegments).values(days.filter(d => !d.isRestDay)
        .map(day => ({
          patternDayId: day.id, shiftDefinitionId: baseShift.id, segmentOrder: 1,
        })));
      const [assignment] = await db.insert(s.employeeScheduleAssignments).values({
        organizationId: e.orgId, employeeId: worker.id, patternId: pattern.id,
        effectiveFrom: "2026-01-05", anchorDate: workDate,
        worksiteId: site.id, workLocationOrgUnitId: worker.orgUnitId,
        reason: "Disposable future Monday shift assignment",
      }).returning();
      const [checker] = await db.insert(s.users).values({
        email: e.marker.toLowerCase() + "-rb-checker@example.invalid",
        name: e.marker + " independent checker", role: "admin",
        passwordHash: "fictional-checker-no-password-login",
        localPasswordEnabled: false, totpEnabled: true,
      }).returning();
      await db.insert(s.userOrganizations).values({
        organizationId: e.orgId, userId: checker.id, role: "admin", active: true,
      });
      const session = await t.standaloneMakeSession(checker.id);
      await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
        .where(eq(s.sessions.id, session.id));
      employers.push({
        label: e.label, orgId: e.orgId, marker: e.marker,
        workerId: e.workerId, ownerId: e.ownerId, ownerName: e.ownerName,
        cookie: e.cookie, checkerCookie: session.cookie, checkerId: checker.id,
        checkerName: checker.name, baseShiftId: e.shiftId, targetShiftId: target.id,
        workDate, worksiteId: site.id, orgUnitId: worker.orgUnitId,
        siteGrantId: siteGrant.id, patternId: pattern.id, assignmentId: assignment.id,
        legacyBatchId: e.batchId,
        idempotencyKey: "RB_STAGE_" + e.label + "_" + randomUUID().replaceAll("-", ""),
        reason: e.marker + " authorized fictional future shift change",
        decisionNote: e.marker + " approved by independent fictional checker",
      });
    }
    assert.ok(employers[2].workerId > employers[0].workerId &&
      employers[2].workerId > employers[1].workerId &&
      employers[2].targetShiftId > employers[0].targetShiftId &&
      employers[2].targetShiftId > employers[1].targetShiftId,
    "actual higher-ID victim worker and shift required");
    const directory = mkdtempSync(join(tmpdir(), "roster-batches-actions-"));
    const path = join(directory, "fixture.json");
    const fd = openSync(path, constants.O_CREAT | constants.O_EXCL |
      constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, JSON.stringify({ version: 2, employers })); }
    finally { closeSync(fd); }
    process.stdout.write("ROSTER_BATCH_ACTION_FIXTURE_FILE=" + path + "\n");
  } finally { await pool.end(); }
}

async function prove() {
  const file = process.env.ROSTER_BATCH_ACTION_FIXTURE_FILE;
  const { employers } = readOwnedFixture("ROSTER_BATCH_ACTION_FIXTURE_FILE",
    "roster-batches-actions", 2);
  const { db, pool, s, t, eq, asc } = await dependencies();
  const [a, b, victim] = employers;
  const read = (table, orgId) => db.select().from(table)
    .where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const snapshot = async orgId => ({
    batches: await read(s.workforceRosterBatches, orgId),
    overrides: await read(s.scheduleOverrides, orgId),
    audits: await read(s.auditEvents, orgId),
    employees: await read(s.employees, orgId),
    shifts: await read(s.shiftDefinitions, orgId),
    patterns: await read(s.schedulePatterns, orgId),
    assignments: await read(s.employeeScheduleAssignments, orgId),
    worksiteAssignments: await read(s.employeeWorksiteAssignments, orgId),
    worksites: await read(s.worksites, orgId),
    payroll: await read(s.payrollRuns, orgId),
  });
  const expected = new Map();
  const unchanged = async label => {
    for (const e of employers) {
      assert.deepEqual(await snapshot(e.orgId), expected.get(e.orgId),
        label + ": " + e.label + " roster, overrides and raw audit must stay byte-identical");
    }
  };
  const post = (actor, body, cookie = actor.cookie) => t.standaloneRequest(API, {
    method: "POST", cookie, body,
  });
  const stageBody = (e, changes = {}) => ({
    action: "stage", organizationId: e.orgId,
    workDate: e.workDate, shiftDefinitionId: e.targetShiftId,
    employeeIds: [e.workerId], reason: e.reason, idempotencyKey: e.idempotencyKey,
    acknowledged: true, ...changes,
  });
  const decideBody = (action, orgId, batchId, note) => ({
    action, organizationId: orgId, batchId, acknowledged: true,
    decisionNote: note,
  });
  const check = (response, status, label) => {
    assert.equal(response.status, status,
      label + ": expected HTTP " + status + ", got " + response.status +
      " code " + (response.json?.code ?? "NONE") + " " +
      String(response.json?.error ?? "").slice(0, 140));
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    return response;
  };
  const deny = async (actor, body, status, label, cookie = actor.cookie) => {
    const result = check(await post(actor, body, cookie), status, label);
    assert.ok(!result.text.includes(victim.marker), label + ": victim marker exposed");
    assert.ok(result.json && typeof result.json.error === "string",
      label + ": denial requires an error JSON");
    for (const key of ["batch", "batches", "overrides", "worker", "employee"]) {
      assert.equal(Object.hasOwn(result.json, key), false,
        label + ": denial returned protected " + key);
    }
    await unchanged(label);
  };
  const assertUnrelated = (before, after, label) => {
    for (const key of Object.keys(before).filter(k => !["batches", "overrides", "audits"].includes(k))) {
      assert.deepEqual(after[key], before[key], label + ": unrelated " + key + " changed");
    }
  };
  try {
    // The prior, receipt-pinned script has already rejected exactly one
    // OTHER-MAKER pending batch per employer and deleted only its own fixture.
    for (const e of employers) {
      const initial = await snapshot(e.orgId);
      const legacy = initial.batches.find(batch => batch.id === e.legacyBatchId);
      assert.equal(legacy?.status, "rejected",
        "old independent reject path must have genuinely executed first");
      assert.ok(initial.audits.some(event =>
        event.action === "WFM bulk roster batch rejected" &&
        event.organizationId === e.orgId &&
        event.metadata?.batchId === e.legacyBatchId &&
        event.actor === e.ownerName), "persisted legacy reject audit required");
      assert.equal(initial.batches.length, 1);
      assert.equal(initial.overrides.length, 0);
      assert.equal(initial.assignments.length, 1);
      assert.equal(initial.worksiteAssignments.length, 1);
      assert.equal(initial.worksites.length, 1);
      assert.equal(initial.shifts.length, 2);
      expected.set(e.orgId, initial);
    }

    for (const e of employers) {
      const before = expected.get(e.orgId);
      const response = check(await post(e, stageBody(e)), 201, e.label + " own stage");
      assert.equal(response.json?.status, "pending");
      assert.equal(response.json?.workers, 1);
      assert.ok(Number.isSafeInteger(response.json?.id) && response.json.id > 0);
      const after = await snapshot(e.orgId);
      assertUnrelated(before, after, e.label + " stage");
      assert.equal(after.batches.length, before.batches.length + 1);
      assert.deepEqual(after.batches.slice(0, -1), before.batches);
      assert.deepEqual(after.overrides, before.overrides, "stage must not publish any shift");
      const row = after.batches.at(-1);
      assert.equal(row.id, response.json.id);
      assert.equal(row.organizationId, e.orgId);
      assert.equal(row.requestedByUserId, e.ownerId);
      assert.equal(row.requestedByName, e.ownerName);
      assert.equal(row.status, "pending");
      assert.equal(row.workDate, e.workDate);
      assert.equal(row.shiftDefinitionId, e.targetShiftId);
      assert.deepEqual(row.employeeIds, [e.workerId]);
      assert.equal(row.reason, e.reason);
      assert.equal(row.idempotencyKey, e.idempotencyKey);
      assert.match(row.evidenceSha256, /^[a-f0-9]{64}$/);
      const requestDigest = createHash("sha256").update(JSON.stringify([
        e.orgId, e.workDate, e.targetShiftId, [e.workerId], e.reason,
      ])).digest("hex");
      assert.equal(row.requestSha256, requestDigest, "request fingerprint must bind own source");
      assert.equal(after.audits.length, before.audits.length + 1);
      assert.deepEqual(after.audits.slice(0, -1), before.audits);
      const receipt = after.audits.at(-1);
      assert.equal(receipt.organizationId, e.orgId);
      assert.equal(receipt.actor, e.ownerName);
      assert.equal(receipt.action, "WFM bulk roster batch staged");
      assert.equal(receipt.metadata?.batchId, row.id);
      assert.equal(receipt.metadata?.evidenceSha256, row.evidenceSha256);
      assert.equal(receipt.metadata?.automaticPublish, false);
      e.stageBatchId = row.id;
      e.evidenceSha256 = row.evidenceSha256;
      expected.set(e.orgId, after);
      await unchanged(e.label + " stage must touch only own employer");

      const replay = check(await post(e, stageBody(e)), 200, e.label + " idempotent replay");
      assert.equal(replay.json?.id, e.stageBatchId);
      assert.equal(replay.json?.replayed, true);
      assert.equal(replay.json?.status, "pending");
      await unchanged(e.label + " replay must not create row, override or audit");
    }
    assert.ok(victim.stageBatchId > a.stageBatchId &&
      victim.stageBatchId > b.stageBatchId,
    "victim staged batch must have real higher ID than both attackers");

    // Every denial is followed immediately by identical snapshots of ALL
    // three employers, including unprojected audit rows and override payloads.
    let denied = 0;
    for (const actor of [a, b]) {
      const unique = () => "RB_DENIED_" + randomUUID().replaceAll("-", "");
      await deny(actor, stageBody(actor, {
        employeeIds: [victim.workerId], idempotencyKey: unique(),
      }), 409, actor.label + " forged victim worker stage"); denied++;
      await deny(actor, stageBody(actor, {
        shiftDefinitionId: victim.targetShiftId, idempotencyKey: unique(),
      }), 409, actor.label + " forged victim shift stage"); denied++;
      await deny(actor, stageBody(actor, {
        organizationId: victim.orgId, employeeIds: [victim.workerId],
        idempotencyKey: unique(),
      }), 403, actor.label + " foreign employer stage"); denied++;
      await deny(actor, decideBody("approve", actor.orgId,
        victim.stageBatchId, actor.decisionNote), 404,
      actor.label + " forged victim batch approval", actor.checkerCookie); denied++;
      await deny(actor, decideBody("reject", actor.orgId,
        victim.stageBatchId, actor.decisionNote), 404,
      actor.label + " forged victim batch rejection"); denied++;
      await deny(actor, decideBody("approve", victim.orgId,
        victim.stageBatchId, actor.decisionNote), 403,
      actor.label + " foreign employer approval", actor.checkerCookie); denied++;
    }
    assert.equal(denied, 12);

    for (const e of employers) {
      // A valid company owner still cannot approve their own source batch.
      await deny(e, decideBody("approve", e.orgId,
        e.stageBatchId, e.decisionNote), 403, e.label + " maker self-approval");
      const before = expected.get(e.orgId);
      const result = check(await post(e, decideBody("approve", e.orgId,
        e.stageBatchId, e.decisionNote), e.checkerCookie), 200,
      e.label + " independent checker approve");
      assert.equal(result.json?.id, e.stageBatchId);
      assert.equal(result.json?.status, "approved");
      assert.equal(result.json?.published, 1);
      assert.ok(Array.isArray(result.json.overrideIds) &&
        result.json.overrideIds.length === 1);
      const after = await snapshot(e.orgId);
      assertUnrelated(before, after, e.label + " approve");
      assert.equal(after.batches.length, before.batches.length);
      const row = after.batches.find(batch => batch.id === e.stageBatchId);
      assert.equal(row.status, "approved");
      assert.equal(row.decidedByUserId, e.checkerId);
      assert.equal(row.decidedByName, e.checkerName);
      assert.equal(row.requestedByUserId, e.ownerId);
      assert.equal(row.evidenceSha256, e.evidenceSha256);
      assert.deepEqual(row.overrideIds, result.json.overrideIds);
      assert.deepEqual(after.batches.filter(batch => batch.id !== row.id),
        before.batches.filter(batch => batch.id !== row.id));
      assert.equal(after.overrides.length, before.overrides.length + 1);
      assert.deepEqual(after.overrides.slice(0, -1), before.overrides);
      const override = after.overrides.at(-1);
      assert.equal(override.id, result.json.overrideIds[0]);
      assert.equal(override.organizationId, e.orgId);
      assert.equal(override.employeeId, e.workerId);
      assert.equal(override.workDate, e.workDate);
      assert.equal(override.kind, "shift");
      assert.equal(override.status, "approved");
      assert.equal(override.worksiteId, e.worksiteId);
      assert.equal(override.workLocationOrgUnitId, e.orgUnitId);
      assert.deepEqual(override.segments,
        [{ shiftDefinitionId: e.targetShiftId, segmentOrder: 1 }]);
      assert.equal(override.createdBy, e.ownerName);
      assert.equal(override.approvedBy, e.checkerName);
      assert.equal(after.audits.length, before.audits.length + 1);
      assert.deepEqual(after.audits.slice(0, -1), before.audits);
      const receipt = after.audits.at(-1);
      assert.equal(receipt.organizationId, e.orgId);
      assert.equal(receipt.actor, e.checkerName);
      assert.equal(receipt.action, "WFM governed bulk roster published");
      assert.equal(receipt.metadata?.batchId, row.id);
      assert.equal(receipt.metadata?.makerUserId, e.ownerId);
      assert.equal(receipt.metadata?.checkerUserId, e.checkerId);
      assert.equal(receipt.metadata?.sourceEvidenceSha256, e.evidenceSha256);
      assert.deepEqual(receipt.metadata?.overrideIds, [override.id]);
      assert.equal(receipt.metadata?.payrollRelease, false);
      expected.set(e.orgId, after);
      await unchanged(e.label + " approval must touch only own employer");
    }
    console.log(JSON.stringify({
      kind: "tenant-governed-roster-batches-all-POST-actions-pg16",
      ownStageHttp201: 3, idempotentReplayHttp200: 3,
      ownDifferentCheckerApproveHttp200: 3,
      ownIndependentRejectHttp200: 3,
      deniedForgedOrForeignHttp: denied,
      makerSelfApprovalDenied: 3, exactSQLAndAuditReadback: true,
      unchangedAllEmployersAfterEveryDenial: true,
      independentReview: "PENDING", newCredits: 0,
      productionTested: false, providerCalls: 0, moneyChanges: 0,
    }));
  } finally {
    await pool.end();
    assert.equal(basename(file), "fixture.json");
    rmSync(dirname(file), { recursive: true, force: true });
  }
}

(mode === "seed" ? seed() : prove()).catch(error => {
  console.error("ROSTER_ACTIONS_PROOF_FAILED:", error);
  process.exitCode = 1;
});
