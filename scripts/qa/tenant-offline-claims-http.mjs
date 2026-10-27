/**
 * Uncredited GAP acceptance candidate: POST and PATCH /api/attendance/offline-claims.
 * Invoked only after the shared flagged-reads tenant-table HTTP proofs have passed.
 * Three actual fictional employers: two independently signed-in attackers and one
 * higher-ID, populated victim. Only the isolated PG16/localhost server is touched.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  attendanceCorrectionRequests, auditEvents, employees, offlinePunchClaims, payrollEntries,
  payrollRuns, timePunches, userOrganizations, users,
} from "../../src/db/schema";
import { assertClaimDenied, assertOwnEmployeeClaimList, assertClaimNoStore } from "./tenant-offline-claims-contract.mjs";

const PATH = "/api/attendance/offline-claims";

function requireDisposable() {
  const app = new URL(process.env.SECURITY_SMOKE_URL ?? "");
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(process.env.CI, "true", "only the fictional CI database is allowed");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(process.env.TENANT_TABLE_PROFILE, "flagged-reads");
  assert.equal(process.env.FACE_OFFLINE_PUNCH_UI_ENABLED, "true");
  assert.equal(app.origin, "http://127.0.0.1:3000");
  assert.equal(database.protocol, "postgresql:");
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.port, "5432");
  assert.equal(database.pathname, "/app_db");
  assert.notEqual(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
  assert.notEqual(process.env.XENDIT_PAYOUTS_ENABLED, "true");
  assert.ok(!process.env.PAYMONGO_SECRET_KEY && !process.env.XENDIT_SECRET_KEY,
    "no payout-provider credentials may be present");
}

const orgRows = (table, organizationId) =>
  db.select().from(table).where(eq(table.organizationId, organizationId)).orderBy(table.id);

async function victimSnapshot(organizationId) {
  return {
    employees: await orgRows(employees, organizationId),
    claims: await orgRows(offlinePunchClaims, organizationId),
    audit: await orgRows(auditEvents, organizationId),
  };
}

async function attendanceAndMoneySnapshot() {
  return {
    punches: await db.select().from(timePunches).orderBy(timePunches.id),
    corrections: await db.select().from(attendanceCorrectionRequests).orderBy(attendanceCorrectionRequests.id),
    runs: await db.select().from(payrollRuns).orderBy(payrollRuns.id),
    entries: await db.select().from(payrollEntries).orderBy(payrollEntries.id),
  };
}

async function ownWriteSnapshot(organizationId) {
  return {
    claims: await orgRows(offlinePunchClaims, organizationId),
    audit: await orgRows(auditEvents, organizationId),
  };
}

async function employeeActor(employer, makeSession) {
  const [user] = await db.insert(users).values({
    email: "offline-claim-" + randomUUID() + "@example.invalid",
    name: "Fictional offline employee " + employer.label,
    passwordHash: "fictional-no-password-login",
    role: "employee",
    employeeId: employer.worker.id,
  }).returning({ id: users.id, name: users.name });
  await db.insert(userOrganizations).values({
    userId: user.id, organizationId: employer.org.id, role: "employee", active: true,
  });
  const session = await makeSession(user.id);
  return { employer, user, cookie: session.cookie };
}

async function submitOwn({ request, expectStatus }, actor, actionType) {
  const body = {
    organizationId: actor.employer.org.id,
    employeeId: actor.employer.worker.id,
    clientEventId: randomUUID(),
    actionType,
    claimedAt: new Date(Math.floor((Date.now() - 120_000) / 1000) * 1000).toISOString(),
    acknowledged: true,
  };
  const response = expectStatus(await request(PATH, {
    method: "POST", cookie: actor.cookie, body,
  }), 201, "linked employee must create a real own unverified claim");
  assert.equal(response.json?.received, true);
  assert.equal(response.json?.replayed, false);
  assert.equal(response.json?.verified, false, "submitted claim is never an authoritative punch");
  const id = response.json?.claimId;
  assert.ok(Number.isSafeInteger(id) && id > 0, "POST must return a persisted claim ID");
  const [stored] = await db.select().from(offlinePunchClaims)
    .where(and(eq(offlinePunchClaims.id, id),
      eq(offlinePunchClaims.organizationId, actor.employer.org.id))).limit(1);
  assert.ok(stored, "POST success must be backed by actual PostgreSQL");
  assert.equal(stored.employeeId, actor.employer.worker.id);
  assert.equal(stored.submittedByUserId, actor.user.id);
  assert.equal(stored.clientEventId, body.clientEventId);
  assert.equal(stored.actionType, body.actionType);
  assert.equal(stored.claimedAt.toISOString(), body.claimedAt);
  assert.equal(stored.status, "pending_review");
  assert.equal(stored.reviewedByUserId, null);
  const receipts = await db.select().from(auditEvents).where(and(
    eq(auditEvents.organizationId, actor.employer.org.id),
    eq(auditEvents.action, "Offline attendance claim submitted (unverified)"),
    eq(auditEvents.resource, String(id)),
  ));
  assert.equal(receipts.length, 1, "exactly one actor-bound submission audit required");
  assert.equal(receipts[0].metadata.actorUserId, actor.user.id);
  assert.equal(receipts[0].metadata.employeeId, actor.employer.worker.id);
  assert.equal(receipts[0].metadata.noAttendanceLedgerWrite, true);
  return { actor, body, id };
}

export async function verifyOfflineClaimsTenantWrites(employers, {
  request, expectStatus, makeSession,
}) {
  requireDisposable();
  assert.equal(employers.length, 3, "two attacker employers and one victim are required");
  const [victim, attackerA, attackerB] = employers;
  for (const field of ["org", "worker"]) {
    assert.ok(victim[field].id > attackerA[field].id && victim[field].id > attackerB[field].id,
      "victim IDs must be real and higher than both attackers");
  }
  const seededVictim = victim.seeded["GET attendance/offline-claims"];
  assert.ok(seededVictim?.id && seededVictim.organizationId === victim.org.id,
    "existing tenant-table read row must seed a real populated victim claim");

  const a = await employeeActor(attackerA, makeSession);
  const b = await employeeActor(attackerB, makeSession);
  const v = await employeeActor(victim, makeSession);
  const http = { request, expectStatus };
  const own = [
    await submitOwn(http, a, "clock_in"),
    await submitOwn(http, b, "clock_out"),
  ];
  const victimOwn = await submitOwn(http, v, "clock_in");
  assert.ok(victimOwn.id > own[0].id && victimOwn.id > own[1].id,
    "victim-only event must have a persisted higher claim ID");
  const victimBefore = await victimSnapshot(victim.org.id);
  const moneyBefore = await attendanceAndMoneySnapshot();

  const victimRead = expectStatus(await request(PATH + "?organizationId=" + victim.org.id,
    { cookie: v.cookie }), 200, "victim must have a genuine populated own GET");
  assertOwnEmployeeClaimList(victimRead, {
    organizationId: victim.org.id, claimId: victimOwn.id,
    forbiddenIds: own.map(x => x.id),
  });
  const ownResponses = [];
  for (const entry of own) {
    const actor = entry.actor, orgId = actor.employer.org.id;
    const foreignIds = [victimOwn.id, seededVictim.id, ...own.filter(x => x.id !== entry.id).map(x => x.id)];
    const response = expectStatus(await request(PATH + "?organizationId=" + orgId,
      { cookie: actor.cookie }), 200, "employee must read populated own claims only");
    assertOwnEmployeeClaimList(response, { organizationId: orgId, claimId: entry.id, forbiddenIds: foreignIds });
    assert.ok(!response.text.includes(victim.marker), "own GET leaked victim's seeded marker");
    ownResponses.push(response);
  }
  assert.throws(() => assertOwnEmployeeClaimList(ownResponses[0], {
    organizationId: attackerB.org.id, claimId: own[1].id, forbiddenIds: [own[0].id],
  }), "attacker A's actual response cannot satisfy attacker B's positive proof");

  for (const entry of own) {
    const actor = entry.actor, orgId = actor.employer.org.id;
    const ownBefore = await ownWriteSnapshot(orgId);
    const forgedOrg = {
      ...entry.body, organizationId: victim.org.id, employeeId: victim.worker.id,
      clientEventId: randomUUID(),
    };
    const foreignPost = await request(PATH, {
      method: "POST", cookie: actor.cookie, body: forgedOrg,
    });
    assertClaimDenied(foreignPost, { status: 403, forbiddenMarker: victim.marker,
      forbiddenClaimId: victimOwn.id });

    const forgedEmployee = await request(PATH, {
      method: "POST", cookie: actor.cookie,
      body: { ...entry.body, employeeId: victim.worker.id, clientEventId: randomUUID() },
    });
    assertClaimDenied(forgedEmployee, { status: 422, forbiddenMarker: victim.marker,
      forbiddenClaimId: victimOwn.id });

    const foreignEmployeeRead = await request(PATH + "?organizationId=" + victim.org.id,
      { cookie: actor.cookie });
    assertClaimDenied(foreignEmployeeRead, { status: 403, forbiddenMarker: victim.marker,
      forbiddenClaimId: victimOwn.id });

    const foreignOwnerRead = await request(PATH + "?organizationId=" + victim.org.id,
      { cookie: actor.employer.cookie });
    assertClaimDenied(foreignOwnerRead, { status: 403, forbiddenMarker: victim.marker,
      forbiddenClaimId: victimOwn.id });

    for (const { selectedOrg, claimId, denied } of [
      { selectedOrg: victim.org.id, claimId: victimOwn.id, denied: 403 },
      { selectedOrg: orgId, claimId: victimOwn.id, denied: 404 },
      { selectedOrg: orgId, claimId: own.find(x => x.id !== entry.id).id, denied: 404 },
    ]) {
      const foreignReview = await request(PATH, {
        method: "PATCH", cookie: actor.employer.cookie,
        body: { organizationId: selectedOrg, id: claimId, action: "dismiss",
          note: "Fictional foreign claim must remain untouched." },
      });
      assertClaimDenied(foreignReview, { status: denied, forbiddenMarker: victim.marker,
        forbiddenClaimId: victimOwn.id });
    }

    const replay = expectStatus(await request(PATH, {
      method: "POST", cookie: actor.cookie, body: entry.body,
    }), 200, "same actor plus exact same event is only an idempotent replay");
    assert.equal(replay.json?.claimId, entry.id);
    assert.equal(replay.json?.replayed, true);
    assert.equal(replay.json?.verified, false);
    assertClaimNoStore(replay.headers);
    const alteredReplay = await request(PATH, {
      method: "POST", cookie: actor.cookie,
      body: { ...entry.body, actionType: entry.body.actionType === "clock_in" ? "clock_out" : "clock_in" },
    });
    assertClaimDenied(alteredReplay, { status: 409, forbiddenMarker: victim.marker,
      forbiddenClaimId: victimOwn.id });

    assert.deepEqual(await ownWriteSnapshot(orgId), ownBefore,
      "foreign references, exact replay and modified replay must not add/alter own claims or audits");
    assert.deepEqual(await victimSnapshot(victim.org.id), victimBefore,
      "attacker foreign POST/GET/PATCH must not mutate victim employee, claims or audit");
  }

  for (const [index, entry] of own.entries()) {
    const action = index === 0 ? "flag" : "dismiss";
    const note = "Fictional independent review - no attendance or payroll mutation.";
    const review = expectStatus(await request(PATH, {
      method: "PATCH", cookie: entry.actor.employer.cookie,
      body: { organizationId: entry.actor.employer.org.id, id: entry.id, action, note },
    }), 200, "different authenticated owner must review own pending claim");
    assert.equal(review.json?.claim?.id, entry.id);
    assert.equal(review.json?.verified, false);
    assert.equal(review.json?.nextAction,
      action === "flag" ? "Use the existing governed attendance correction workflow." : "No attendance modification.");
    const [saved] = await db.select().from(offlinePunchClaims).where(
      eq(offlinePunchClaims.id, entry.id)).limit(1);
    assert.equal(saved.organizationId, entry.actor.employer.org.id);
    assert.equal(saved.employeeId, entry.actor.employer.worker.id);
    assert.equal(saved.status, action === "flag" ? "flagged" : "dismissed");
    assert.equal(saved.reviewNote, note);
    assert.equal(saved.reviewedByUserId, entry.actor.employer.owner.id);
    assert.ok(saved.reviewedAt instanceof Date);
    const audits = await db.select().from(auditEvents).where(and(
      eq(auditEvents.organizationId, entry.actor.employer.org.id),
      eq(auditEvents.resource, String(entry.id)),
      eq(auditEvents.action, action === "flag"
        ? "Offline attendance claim flagged for correction" : "Offline attendance claim dismissed"),
    ));
    assert.equal(audits.length, 1, "review action needs one actual employer-scoped audit");
    assert.equal(audits[0].metadata.reviewerUserId, entry.actor.employer.owner.id);
    assert.equal(audits[0].metadata.noPayrollOrTimePunchMutation, true);

    const afterFirstReview = await ownWriteSnapshot(entry.actor.employer.org.id);
    const retry = expectStatus(await request(PATH, {
      method: "PATCH", cookie: entry.actor.employer.cookie,
      body: { organizationId: entry.actor.employer.org.id, id: entry.id, action, note },
    }), 409, "review must be one-way, not a replayable update");
    assertClaimDenied(retry, { status: 409, forbiddenMarker: victim.marker,
      forbiddenClaimId: victimOwn.id });
    assert.deepEqual(await ownWriteSnapshot(entry.actor.employer.org.id), afterFirstReview,
      "duplicate reviewer decision must have no additional claim or audit write");
  }
  assert.deepEqual(await victimSnapshot(victim.org.id), victimBefore,
    "victim claims, staff and audit must remain unchanged after both independent reviewers");
  assert.deepEqual(await attendanceAndMoneySnapshot(), moneyBefore,
    "unverified offline claims must not modify any attendance ledger, correction, payroll run or entry");
  console.log("OFFLINE CLAIM TENANT PASS: 2 independent employees and reviewers; higher-ID victim; " +
    "POST persisted/audited; GET scoped; 403/404/422/409; replay; PATCH flag+dismiss; " +
    "victim and authoritative attendance/payroll unchanged; fictional PG16 only; zero credits");
}
