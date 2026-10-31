/**
 * Synthetic source/authorization regression for seven payroll-run method keys.
 * Zero new coverage credits: only Xendit GET has a fully populated own-data
 * positive; mutations deliberately stop before release, sign-off, or transfers.
 * This never exercises a live provider, production database, or payout.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db, pool } from "../../../src/db";
import {
  approvalTasks, auditEvents, legalEntities, payrollEntries, payrollRuns,
  payoutBatches, payoutBatchTransfers, payoutTransfers,
  userLegalEntityGrants, userOrganizations, users,
} from "../../../src/db/schema";
import {
  requireTenantTableDisposable, seedEmployer,
  standaloneMakeSession, standaloneRequest, standaloneExpectStatus,
} from "../tenant-table-http.mjs";

export const PAYROLL_PATH_METHODS = Object.freeze([
  "POST payroll-runs/[id]/submit-review",
  "POST payroll-runs/[id]/exports",
  "POST payroll-runs/[id]/pilot-signoff",
  "POST payroll-runs/[id]/release",
  "GET payroll-runs/[id]/xendit-payout",
  "POST payroll-runs/[id]/xendit-payout",
  "POST payroll-runs/[id]/payout-reconciliation",
]);

export function requireNoMoneyFixture(env = process.env) {
  requireTenantTableDisposable(env);
  assert.equal(env.WORKER_ENABLED, "false");
  assert.equal(env.CENTRAL_SCHEDULER_ENABLED, "false");
  assert.notEqual(env.XENDIT_PAYOUTS_ENABLED, "true");
  assert.notEqual(env.XENDIT_PAYOUTS_LIVE_APPROVED, "true");
  assert.notEqual(env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
  assert.ok(!env.PAYMONGO_SECRET_KEY && !env.PAYMONGO_WALLET_ID);
  assert.ok(!env.XENDIT_PAYOUT_SECRET_KEY);
  assert.ok(!env.RESEND_API_KEY && !env.XENDIT_PAYOUT_CALLBACK_TOKEN);
  assert.ok(!env.PAYROLL_PAYOUT_PROVIDER || env.PAYROLL_PAYOUT_PROVIDER === "paymongo");
  assert.equal(env.NODE_ENV, "production");
}

const plain = (value) => JSON.parse(JSON.stringify(value));
async function businessState(orgId) {
  const [runs, entries, batches, transfers, links, tasks, audit] = await Promise.all([
    db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, orgId)).orderBy(asc(payrollRuns.id)),
    db.select({ entry: payrollEntries }).from(payrollEntries)
      .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
      .where(eq(payrollRuns.organizationId, orgId)).orderBy(asc(payrollEntries.id)),
    db.select().from(payoutBatches).where(eq(payoutBatches.organizationId, orgId)).orderBy(asc(payoutBatches.id)),
    db.select().from(payoutTransfers).where(eq(payoutTransfers.organizationId, orgId)).orderBy(asc(payoutTransfers.id)),
    db.select().from(payoutBatchTransfers).where(eq(payoutBatchTransfers.organizationId, orgId)).orderBy(asc(payoutBatchTransfers.id)),
    db.select().from(approvalTasks).where(eq(approvalTasks.organizationId, orgId)).orderBy(asc(approvalTasks.id)),
    db.select().from(auditEvents).where(eq(auditEvents.organizationId, orgId)).orderBy(asc(auditEvents.id)),
  ]);
  return plain({ runs, entries, batches, transfers, links, tasks, audit });
}

async function seedRuns(employer, multiEntity) {
  const e = employer;
  if (multiEntity) {
    await db.insert(userLegalEntityGrants).values({
      organizationId: e.org.id, userId: e.owner.id, legalEntityId: e.entity.id,
    });
  }
  const makeRun = async (suffix, status, entityId = e.entity.id) => {
    const [run] = await db.insert(payrollRuns).values({
      organizationId: e.org.id, legalEntityId: entityId, scopeOrgUnitId: e.unit.id,
      periodLabel: e.marker + "-" + suffix,
      periodStart: "2026-07-01", periodEnd: "2026-07-15", payDate: "2026-07-16",
      status, employeeCount: status === "Draft" ? 0 : 1,
      grossPay: status === "Draft" ? "0" : "20000.00",
      netPay: status === "Draft" ? "0" : "20000.00",
      processedChunks: status === "Draft" ? 0 : 1,
      totalChunks: status === "Draft" ? 0 : 1,
    }).returning();
    return run;
  };
  const draft = await makeRun("DRAFT", "Draft");
  const processed = await makeRun("PROCESSED", "Processed");
  const released = await makeRun("RELEASED", "Released");
  for (const run of [processed, released]) {
    const [entry] = await db.insert(payrollEntries).values({
      payrollRunId: run.id, employeeId: e.worker.id,
      grossPay: "20000.00", deductions: "0.00", netPay: "20000.00",
    }).returning();
    if (run.id === released.id) e.releasedEntry = entry;
  }
  // Purely pre-populated fictional ledger rows. Nothing is submitted to Xendit.
  const amountCents = 2000000;
  const [batch] = await db.insert(payoutBatches).values({
    organizationId: e.org.id, payrollRunId: released.id, provider: "xendit",
    idempotencyKey: "fictional-ledger-" + e.marker,
    requestHash: createHash("sha256").update(e.marker).digest("hex"),
    transferCount: 1, totalAmountCents: amountCents, status: "prepared",
  }).returning();
  const [transfer] = await db.insert(payoutTransfers).values({
    organizationId: e.org.id, payrollRunId: released.id, payrollEntryId: e.releasedEntry.id,
    employeeId: e.worker.id, referenceNumber: e.marker + "-UNSENT",
    amountCents, status: "prepared",
  }).returning();
  await db.insert(payoutBatchTransfers).values({
    organizationId: e.org.id, payoutBatchId: batch.id,
    payoutTransferId: transfer.id, status: "prepared",
  });
  let sibling = null;
  if (multiEntity) {
    const [other] = await db.insert(legalEntities).values({
      organizationId: e.org.id, code: (e.marker + "-OTHER").slice(0, 40),
      legalName: e.marker + " unrelated legal employer", displayName: e.marker + " Other",
      primaryEntity: false,
    }).returning();
    sibling = await makeRun("UNGRANTED", "Released", other.id);
    assert.ok(other.id > e.entity.id && sibling.legalEntityId !== released.legalEntityId);
  }
  return { draft, processed, released, sibling, batch };
}

async function seedUnqualifiedCheckers(e, nonce) {
  const people = await db.insert(users).values([
    { name: e.marker + " revoked checker", email: "revoked-" + e.label.toLowerCase() + "-" + nonce + "@example.invalid",
      passwordHash: "fictional-never-login", role: "admin" },
    { name: e.marker + " disabled checker", email: "disabled-" + e.label.toLowerCase() + "-" + nonce + "@example.invalid",
      passwordHash: "fictional-never-login", role: "admin", active: false },
  ]).returning();
  await db.insert(userOrganizations).values([
    { userId: people[0].id, organizationId: e.org.id, role: "admin", active: false },
    { userId: people[1].id, organizationId: e.org.id, role: "admin", active: true },
  ]);
  return people;
}

const cases = Object.freeze([
  { key: PAYROLL_PATH_METHODS[0], route: "submit-review", method: "POST", run: "draft", body: () => ({ approverUserId: -1 }), own: 409 },
  { key: PAYROLL_PATH_METHODS[1], route: "exports", method: "POST", run: "draft", body: () => ({ mode: "preflight" }), own: 409 },
  { key: PAYROLL_PATH_METHODS[2], route: "pilot-signoff", method: "POST", run: "draft", body: () => ({}), own: 409 },
  { key: PAYROLL_PATH_METHODS[3], route: "release", method: "POST", run: "draft", body: () => ({}), own: 409 },
  { key: PAYROLL_PATH_METHODS[4], route: "xendit-payout", method: "GET", run: "released", own: 200 },
  { key: PAYROLL_PATH_METHODS[5], route: "xendit-payout", method: "POST", run: "released", body: () => ({ action: "preflight" }), own: 409 },
  { key: PAYROLL_PATH_METHODS[6], route: "payout-reconciliation", method: "POST", run: "released", body: () => ({ action: "reconcile" }), own: 501 },
]);

export async function verifyPayrollPathBoundary() {
  requireNoMoneyFixture();
  const multiEntity = process.env.MULTI_ENTITY_ENABLED === "true";
  const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
  const employers = {};
  for (const label of ["ATTA", "ATTB", "VICTIM"]) {
    const e = await seedEmployer(label, nonce, standaloneMakeSession);
    e.runs = await seedRuns(e, multiEntity);
    employers[label] = e;
  }
  const victim = employers.VICTIM;
  const attackers = [employers.ATTA, employers.ATTB];
  assert.ok(victim.org.id > attackers[0].org.id && victim.org.id > attackers[1].org.id);
  for (const key of ["draft", "processed", "released"]) {
    assert.ok(victim.runs[key].id > attackers[0].runs[key].id && victim.runs[key].id > attackers[1].runs[key].id,
      "The victim resource must be a real independently seeded higher-ID row");
  }
  const victimBefore = await businessState(victim.org.id);
  let verifiedPairs = 0, uncreditedDenials = 0, legalEmployerDenials = 0, checkerDenials = 0;
  for (const attacker of attackers) {
    const before = await businessState(attacker.org.id);
    for (const item of cases) {
      const ownId = attacker.runs[item.run].id;
      const foreignId = victim.runs[item.run].id;
      const own = standaloneExpectStatus(await standaloneRequest(
        "/api/payroll-runs/" + ownId + "/" + item.route,
        { method: item.method, cookie: attacker.cookie, body: item.body?.(attacker) }
      ), item.own, item.key + " own guarded path");
      if (item.method === "GET") {
        assert.equal(own.json?.ledger?.batchId, attacker.runs.batch.id);
        assert.equal(own.json?.ledger?.rows?.length, 1);
        assert.equal(own.json.ledger.rows[0].employeeNo, attacker.worker.employeeNo);
        assert.equal(own.json.ledger.rows[0].referenceNumber, attacker.marker + "-UNSENT");
        assert.equal(own.json.ledger.rows[0].status, "prepared");
      } else {
        // These are deliberately negative-only preconditions, NOT a real own
        // payroll submission, release, sign-off, provider preflight or retry.
        assert.ok([400, 409, 422, 501].includes(own.status));
        uncreditedDenials++;
      }
      const foreign = standaloneExpectStatus(await standaloneRequest(
        "/api/payroll-runs/" + foreignId + "/" + item.route,
        { method: item.method, cookie: attacker.cookie, body: item.body?.(attacker) }
      ), 403, item.key + " real higher-ID foreign employer");
      assert.ok(!own.text.includes(victim.marker) && !foreign.text.includes(victim.marker),
        item.key + ": a response exposed victim employer data");
      assert.deepEqual(await businessState(victim.org.id), victimBefore,
        item.key + ": victim business, payroll, ledger and audit data changed");
      assert.deepEqual(await businessState(attacker.org.id), before,
        item.key + ": precondition-only probes must never write payroll, payout or audit state");
      verifiedPairs++;
      if (multiEntity) {
        assert.ok(attacker.runs.sibling && attacker.runs.sibling.id !== ownId);
        const sibling = standaloneExpectStatus(await standaloneRequest(
          "/api/payroll-runs/" + attacker.runs.sibling.id + "/" + item.route,
          { method: item.method, cookie: attacker.cookie, body: item.body?.(attacker) }
        ), 403, item.key + " same-workspace ungranted legal employer");
        assert.ok(!sibling.text.includes(attacker.runs.sibling.periodLabel));
        assert.deepEqual(await businessState(attacker.org.id), before,
          item.key + ": denial against an ungranted legal employer must not write");
        legalEmployerDenials++;
      }
    }
    const checkers = await seedUnqualifiedCheckers(attacker, nonce);
    for (const checker of checkers) {
      const r = standaloneExpectStatus(await standaloneRequest(
        "/api/payroll-runs/" + attacker.runs.processed.id + "/submit-review",
        { method: "POST", cookie: attacker.cookie, body: { approverUserId: checker.id } }
      ), 422, "Inactive membership or globally disabled checker must not receive an approval task");
      assert.ok(!r.text.includes(victim.marker));
      checkerDenials++;
    }
    // Checker probes only generate fictional checker users, never payroll writes.
    assert.deepEqual(await businessState(attacker.org.id), before);
  }
  assert.deepEqual(await businessState(victim.org.id), victimBefore);
  assert.equal(verifiedPairs, PAYROLL_PATH_METHODS.length * 2);
  assert.equal(uncreditedDenials, 12);
  assert.equal(checkerDenials, 4);
  if (multiEntity) assert.equal(legalEmployerDenials, PAYROLL_PATH_METHODS.length * 2);
  console.log(JSON.stringify({
    kind: "payroll-run-path-negative-and-ledger-readiness",
    profile: multiEntity ? "multi-entity" : "default",
    fictionalEmployerCount: 3, attackerEmployers: 2,
    methodKeys: PAYROLL_PATH_METHODS,
    ownForeignPairs: verifiedPairs, populatedOwnXenditGet: 2,
    blockedPreconditionOnlyMutations: uncreditedDenials,
    ungrantedSameWorkspaceLegalEmployerDenials: legalEmployerDenials,
    inactiveAndDisabledCheckerDenials: checkerDenials,
    victimAndOwnedBusinessDataUnchanged: true,
    providersContacted: 0, moneyMoved: false,
    newMethodCredits: 0, productionCertified: false,
  }));
}

if (process.argv[1] && process.argv[1].replaceAll("\\", "/").endsWith("scripts/qa/tenant-batches/payroll-runs-path-http.mjs")) {
  verifyPayrollPathBoundary().then(() => pool.end(), async (error) => {
    console.error(error);
    await pool.end().catch(() => {});
    process.exitCode = 1;
  });
}
