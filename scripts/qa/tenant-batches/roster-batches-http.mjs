/**
 * Independent governed-roster-batch GET + reject-only POST isolation proof.
 * Two independently authenticated attackers + one higher-ID victim.
 * Disposable PG16 / production-mode 127.0.0.1:3000 only.
 *
 * Commands (separate CI steps):
 *   node --import tsx scripts/qa/tenant-batches/roster-batches-http.mjs seed >> "$GITHUB_ENV"
 *   node --import tsx scripts/qa/tenant-batches/roster-batches-http.mjs prove
 */
import assert from "node:assert/strict";
import { constants, closeSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { requireDisposableRosterBatch } from "./roster-batches-guard.mjs";
import {
  assertOwnedRosterRead, assertRejectedRosterMutation, assertUnchangedState,
} from "./roster-batches-proof.mjs";

const mode = process.argv[2];
requireDisposableRosterBatch(process.env, mode);

function privateFixtureFile() {
  const path = process.env.ROSTER_BATCH_FIXTURE_FILE;
  assert.ok(typeof path === "string" &&
    /^\/tmp\/roster-batches-proof-[A-Za-z0-9]+\/fixture\.json$/.test(path),
    "ROSTER_BATCH_PROOF_REFUSED: unexpected private fixture path");
  return path;
}
function readPrivateFixture() {
  const path = privateFixtureFile();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    assert.ok(stat.isFile() && (stat.mode & 0o077) === 0 &&
      stat.uid === process.getuid(), "private fictional session fixture must be owner-only");
    const fixture = JSON.parse(readFileSync(fd, "utf8"));
    assert.equal(fixture.version, 1);
    assert.equal(fixture.employers?.length, 3);
    assert.deepEqual(fixture.employers.map(e => e.label), ["ATTA", "ATTB", "VICTIM"]);
    return fixture;
  } finally { closeSync(fd); }
}

async function dependencies() {
  const [{ db, pool }, schema, table, { eq, asc }, { auditBusinessSnapshot }] =
    await Promise.all([
      import("../../../src/db/index.ts"),
      import("../../../src/db/schema.ts"),
      import("../tenant-table-http.mjs"),
      import("drizzle-orm"),
      import("../tenant-table-invariants.mjs"),
    ]);
  return { db, pool, s: schema, table, eq, asc, auditBusinessSnapshot };
}
async function seed() {
  const { db, pool, s, table } = await dependencies();
  try {
    assert.equal((await db.select({ id: s.organizations.id })
      .from(s.organizations).limit(1)).length, 0,
    "ROSTER_BATCH_PROOF_REFUSED: fresh empty fictional database required");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const employers = [];
    for (const label of ["ATTA", "ATTB", "VICTIM"]) {
      const e = await table.seedEmployer(label, nonce, table.standaloneMakeSession);
      const [shift] = await db.insert(s.shiftDefinitions).values({
        organizationId: e.org.id, code: "RB-" + label + "-" + nonce.slice(0, 8),
        name: e.marker + " shift", startTime: "09:00", endTime: "17:00",
      }).returning();
      const [maker] = await db.insert(s.users).values({
        email: e.marker.toLowerCase() + "-maker@example.invalid",
        name: e.marker + " maker", role: "employee",
        passwordHash: "fictional-maker-not-a-login",
      }).returning();
      assert.notEqual(maker.id, e.owner.id, "maker and checker must be different users");
      const reason = e.marker + " fictional pending roster batch for isolation";
      const [batch] = await db.insert(s.workforceRosterBatches).values({
        organizationId: e.org.id, workDate: "2099-11-10",
        shiftDefinitionId: shift.id, employeeIds: [e.worker.id],
        evidenceSha256: "a".repeat(64), requestSha256: "b".repeat(64),
        idempotencyKey: "ROSTER_" + label + "_" + nonce + "_fixture",
        reason, status: "pending",
        requestedByUserId: maker.id, requestedByName: maker.name,
      }).returning();
      employers.push({
        label, orgId: e.org.id, ownerId: e.owner.id, ownerName: e.owner.name,
        marker: e.marker, workerId: e.worker.id, shiftId: shift.id,
        batchId: batch.id, makerId: maker.id, makerName: maker.name,
        reason, note: e.marker + " fictional independent rejection for test only",
        cookie: e.cookie,
      });
    }
    assert.ok(employers[2].orgId > employers[0].orgId &&
      employers[2].orgId > employers[1].orgId &&
      employers[2].workerId > employers[0].workerId &&
      employers[2].workerId > employers[1].workerId &&
      employers[2].batchId > employers[0].batchId &&
      employers[2].batchId > employers[1].batchId,
    "victim must be genuine and higher-ID for employer, worker and batch");
    const dir = mkdtempSync(join(tmpdir(), "roster-batches-proof-"));
    const path = join(dir, "fixture.json");
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT |
      constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, JSON.stringify({ version: 1, employers })); }
    finally { closeSync(fd); }
    // Only emitted to the CI runner's $GITHUB_ENV. Never log the fictional cookies.
    process.stdout.write("WFM_BULK_ROSTER_ALLOWED_ORGANIZATION_IDS=" +
      employers.map(e => e.orgId).join(",") + "\n");
    process.stdout.write("ROSTER_BATCH_FIXTURE_FILE=" + path + "\n");
  } finally { await pool.end(); }
}
async function prove() {
  const fixture = readPrivateFixture();
  const employers = fixture.employers;
  const authorized = requireDisposableRosterBatch(process.env, "prove");
  assert.deepEqual(authorized, employers.map(e => e.orgId),
    "server must allow exactly the dynamically seeded fictional employers");
  const { db, pool, s, table, eq, asc, auditBusinessSnapshot } = await dependencies();
  const [a, b, victim] = employers;
  const orgSnapshot = async orgId => {
    const byOrg = t => db.select().from(t).where(eq(t.organizationId, orgId)).orderBy(asc(t.id));
    const [batches, staff, shifts, overrides, payroll, punches, leaves, audit] =
      await Promise.all([
        byOrg(s.workforceRosterBatches), byOrg(s.employees),
        byOrg(s.shiftDefinitions), byOrg(s.scheduleOverrides),
        byOrg(s.payrollRuns), byOrg(s.timePunches), byOrg(s.leaveRequests),
        byOrg(s.auditEvents),
      ]);
    return { batches, staff, shifts, overrides, payroll, punches, leaves,
      audits: auditBusinessSnapshot(audit) };
  };
  const get = (actor, orgId) => table.standaloneRequest(
    "/api/workforce/roster-batches?organizationId=" + orgId,
    { cookie: actor.cookie });
  const reject = (actor, orgId, batchId) => table.standaloneRequest(
    "/api/workforce/roster-batches",
    { method: "POST", cookie: actor.cookie,
      body: { action: "reject", organizationId: orgId, batchId,
        acknowledged: true, decisionNote: actor.note } });
  const assertNoVictimMarker = (response, label) => {
    assert.ok(!response.text.includes(victim.marker), label + ": victim marker leaked");
  };
  try {
    for (const e of employers) {
      assert.ok(e.marker.startsWith("TTBL-" + e.label + "-"));
      assert.equal((await db.select({ id: s.workforceRosterBatches.id })
        .from(s.workforceRosterBatches).where(eq(s.workforceRosterBatches.id, e.batchId))
        .limit(1))[0]?.id, e.batchId, "stored batch must exist");
    }
    const before = await Promise.all(employers.map(e => orgSnapshot(e.orgId)));
    const victimOwn = await get(victim, victim.orgId);
    assertOwnedRosterRead(victimOwn, victim);
    let firstOwnRead;
    for (const actor of [a, b]) {
      const own = await get(actor, actor.orgId);
      assertOwnedRosterRead(own, actor);
      assertNoVictimMarker(own, "own roster read");
      if (firstOwnRead) {
        assert.throws(() => assertOwnedRosterRead(firstOwnRead, actor),
          "owned-response proof must reject the other attacker's genuine rows");
      }
      firstOwnRead = own;
      const foreignRead = await get(actor, victim.orgId);
      assert.equal(foreignRead.status, 403, "foreign roster GET must be denied");
      assertNoVictimMarker(foreignRead, "foreign roster read");
      const foreignReject = await reject(actor, victim.orgId, victim.batchId);
      assert.equal(foreignReject.status, 403, "foreign employer POST must be denied");
      assertNoVictimMarker(foreignReject, "foreign rejection");
      const forged = await reject(actor, actor.orgId, victim.batchId);
      assert.equal(forged.status, 404, "real victim batch forged into own employer must be denied");
      assert.equal(forged.json?.code, "WFM_BATCH_NOT_FOUND");
      assertNoVictimMarker(forged, "forged batch denial");
      for (let i = 0; i < employers.length; i++) {
        assertUnchangedState(before[i], await orgSnapshot(employers[i].orgId),
          actor.label + " read/foreign/forged requests on " + employers[i].label);
      }
    }
    // Every own reject must leave BOTH other employers untouched, not just the victim.
    const expected = new Map(employers.map((e, index) => [e.orgId, before[index]]));
    for (const actor of [a, b]) {
      const old = await orgSnapshot(actor.orgId);
      assertUnchangedState(expected.get(actor.orgId), old, actor.label + " pre-reject state");
      const ownReject = await reject(actor, actor.orgId, actor.batchId);
      const updated = await orgSnapshot(actor.orgId);
      assertRejectedRosterMutation(old, updated, actor, ownReject);
      assertNoVictimMarker(ownReject, "owned rejection");
      expected.set(actor.orgId, updated);
      for (const other of employers.filter(e => e.orgId !== actor.orgId)) {
        assertUnchangedState(expected.get(other.orgId), await orgSnapshot(other.orgId),
          actor.label + " reject must not mutate " + other.label);
      }
    }
    // The actual victim has its own authenticated, positive reject path.
    const oldVictim = await orgSnapshot(victim.orgId);
    assertUnchangedState(expected.get(victim.orgId), oldVictim, "victim pre-reject state");
    const victimReject = await reject(victim, victim.orgId, victim.batchId);
    assertRejectedRosterMutation(oldVictim, await orgSnapshot(victim.orgId),
      victim, victimReject);
    for (const other of [a, b]) {
      assertUnchangedState(expected.get(other.orgId), await orgSnapshot(other.orgId),
        "victim's own rejection must not mutate " + other.label);
    }
    // No marker-free 200 or own-only 403 is counted as a proof.
    console.log(JSON.stringify({
      kind: "tenant-governed-roster-batches-real-http-pg16",
      methods: ["GET workforce/roster-batches", "POST workforce/roster-batches (reject only)"],
      independentAttackerEmployers: 2, higherIdVictim: true,
      populatedOwnerReads: 3, foreignGetDenials: 2,
      foreignPostDenials: 2, forgedVictimBatchDenials: 2,
      persistedOwnRejectsWithAudit: 3, protectedVictimUnchangedUntilOwnAction: true,
      otherPostActionsProved: false, credits: 0, productionCertified: false,
    }));
  } finally {
    await pool.end();
    const path = privateFixtureFile();
    assert.equal(basename(path), "fixture.json");
    rmSync(dirname(path), { recursive: true, force: true });
  }
}
(mode === "seed" ? seed() : prove()).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
