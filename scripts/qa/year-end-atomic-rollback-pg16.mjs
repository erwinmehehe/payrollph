/**
 * Disposable PostgreSQL 16 + real localhost HTTP rollback probe for PR #1744.
 * Fictional employers only. No payroll workers, payments, banks or filings.
 * This is a regression/acceptance candidate, not payroll/security sign-off.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { auditEvents, payrollEntries, payrollJobs, payrollRuns, yearEndAdjustments, payrollMonthClosures, sessions } from "../../src/db/schema";
import {
  requireTenantTableDisposable, seedEmployer, standaloneMakeSession,
  standaloneRequest, standaloneExpectStatus,
} from "./tenant-table-http.mjs";

function asJson(rows) {
  return JSON.parse(JSON.stringify(rows));
}

async function snapshot(orgId) {
  const runs = await db.select().from(payrollRuns)
    .where(eq(payrollRuns.organizationId, orgId)).orderBy(asc(payrollRuns.id));
  const ids = runs.map((run) => run.id);
  const entries = ids.length ? await db.select().from(payrollEntries)
    .where(inArray(payrollEntries.payrollRunId, ids)).orderBy(asc(payrollEntries.id)) : [];
  const jobs = ids.length ? await db.select().from(payrollJobs)
    .where(inArray(payrollJobs.payrollRunId, ids)).orderBy(asc(payrollJobs.id)) : [];
  return asJson({
    runs, entries, jobs,
    adjustments: await db.select().from(yearEndAdjustments)
      .where(eq(yearEndAdjustments.organizationId, orgId)).orderBy(asc(yearEndAdjustments.id)),
    monthClosures: await db.select().from(payrollMonthClosures)
      .where(eq(payrollMonthClosures.organizationId, orgId)).orderBy(asc(payrollMonthClosures.id)),
    audit: await db.select().from(auditEvents)
      .where(eq(auditEvents.organizationId, orgId)).orderBy(asc(auditEvents.id)),
  });
}

async function seedYearEnd(e) {
  const salary = String(20000 + (e.org.id % 10) * 100) + ".00";
  const [released] = await db.insert(payrollRuns).values({
    organizationId: e.org.id, legalEntityId: e.entity.id,
    periodLabel: "Fictional November " + e.marker,
    periodStart: "2026-11-01", periodEnd: "2026-11-15", payDate: "2026-11-20",
    status: "Released", employeeCount: 1, grossPay: salary, netPay: salary,
  }).returning();
  await db.insert(payrollEntries).values({
    payrollRunId: released.id, employeeId: e.worker.id, grossPay: salary,
    deductions: "0.00", netPay: salary,
    lineItems: [
      { code: "BASIC", label: "Fictional earned salary", amount: salary },
      { code: "TAX", label: "Fictional tax withheld", amount: "0.00" },
    ],
    trace: { fictional: true, marker: e.marker },
  });
  const [final] = await db.insert(payrollRuns).values({
    organizationId: e.org.id, legalEntityId: e.entity.id,
    periodLabel: "Fictional December cutoff " + e.marker,
    periodStart: "2026-12-16", periodEnd: "2026-12-31", payDate: "2026-12-31",
    status: "Needs review", employeeCount: 1,
  }).returning();
  // Existing register and job must survive BOTH injected failures unchanged.
  await db.insert(payrollEntries).values({
    payrollRunId: final.id, employeeId: e.worker.id,
    grossPay: "0.00", deductions: "0.00", netPay: "0.00",
    lineItems: [], trace: { fictional: true, preBinding: true, marker: e.marker },
  });
  await db.insert(payrollJobs).values({
    payrollRunId: final.id, organizationId: e.org.id,
    status: "completed", chunkIndex: 0, chunkSize: 25, attempts: 1,
  });
  // Annualization deletes/replaces this computed row. An injected failure
  // must roll the deletion back, not merely avoid inserting new adjustments.
  await db.insert(yearEndAdjustments).values({
    organizationId: e.org.id, employeeId: e.worker.id, taxYear: 2026,
    grossCompensation: "12345.67", status: "computed",
  });
  const [wrongCutoff] = await db.insert(payrollRuns).values({
    organizationId: e.org.id, legalEntityId: e.entity.id,
    periodLabel: "Fictional not-Dec31 " + e.marker,
    periodStart: "2026-12-01", periodEnd: "2026-12-30", payDate: "2026-12-30",
    status: "Needs review",
  }).returning();
  const [wrongStatus] = await db.insert(payrollRuns).values({
    organizationId: e.org.id, legalEntityId: e.entity.id,
    periodLabel: "Fictional uncalculated " + e.marker,
    periodStart: "2026-12-16", periodEnd: "2026-12-31", payDate: "2026-12-31",
    status: "Draft",
  }).returning();
  return { released, final, wrongCutoff, wrongStatus };
}

function body(orgId, runId) {
  return { organizationId: orgId, taxYear: 2026, applyToPayrollRunId: runId };
}

async function requestBind(e, runId, orgId = e.org.id) {
  return standaloneRequest("/api/year-end", {
    method: "POST", cookie: e.cookie, body: body(orgId, runId),
  });
}

async function withInsertVeto(table, predicate, action) {
  // The private fixture owns the entire localhost PG16 database. The trigger
  // is installed on that database only, with a verified numeric selector.
  const functionName = "qa_year_end_atomic_veto";
  const triggerName = "qa_year_end_atomic_veto";
  assert.ok(["audit_events", "payroll_jobs"].includes(table));
  await pool.query("CREATE FUNCTION " + functionName + "() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA_YEAR_END_ATOMIC_VETO'; END; $$");
  try {
    await pool.query("CREATE TRIGGER " + triggerName + " BEFORE INSERT ON " + table
      + " FOR EACH ROW WHEN (" + predicate + ") EXECUTE FUNCTION " + functionName + "()");
    try {
      await action();
    } finally {
      await pool.query("DROP TRIGGER IF EXISTS " + triggerName + " ON " + table);
    }
  } finally {
    await pool.query("DROP FUNCTION IF EXISTS " + functionName + "()");
  }
}

async function proveVeto(e, fixture, victim, label, table, predicate) {
  const before = await snapshot(e.org.id);
  const victimBefore = await snapshot(victim.org.id);
  await withInsertVeto(table, predicate, async () => {
    const refused = await requestBind(e, fixture.final.id);
    assert.equal(refused.status, 500,
      label + ": the actual SQL veto must abort HTTP, got " + refused.status + " " + refused.text.slice(0, 150));
    assert.ok(!refused.text.includes(victim.marker), "refusal leaked victim marker");
    assert.deepEqual(await snapshot(e.org.id), before,
      label + ": adjustments (including prior computed row), payroll register, jobs and audits must all roll back");
    assert.deepEqual(await snapshot(victim.org.id), victimBefore,
      label + ": the foreign employer must stay byte-identical");
  });
}

async function proveEmployer(e, fixture, victim, victimFixture) {
  const ownBefore = await snapshot(e.org.id);
  const victimBefore = await snapshot(victim.org.id);
  // Denial checks use a real populated higher-ID employer, not a fake missing ID.
  assert.ok(victim.org.id > e.org.id && victim.worker.id > e.worker.id);
  const foreign = standaloneExpectStatus(
    await requestBind(e, victimFixture.final.id, victim.org.id), 403, "foreign employer binding");
  assert.ok(!foreign.text.includes(victim.marker));
  const forged = standaloneExpectStatus(
    await requestBind(e, victimFixture.final.id), 404, "forged real foreign payroll run");
  assert.ok(!forged.text.includes(victim.marker));
  standaloneExpectStatus(await requestBind(e, fixture.wrongStatus.id), 409, "uncalculated cutoff");
  standaloneExpectStatus(await requestBind(e, fixture.wrongCutoff.id), 422, "non-Dec31 cutoff");
  assert.deepEqual(await snapshot(e.org.id), ownBefore, "all denied requests must leave own SQL unchanged");
  assert.deepEqual(await snapshot(victim.org.id), victimBefore, "denials must leave victim SQL unchanged");

  await proveVeto(e, fixture, victim, "last binding audit", "audit_events",
    "NEW.organization_id = " + e.org.id + " AND NEW.action = 'Year-end tax adjustments bound to payroll'");
  await proveVeto(e, fixture, victim, "queue job insert", "payroll_jobs",
    "NEW.payroll_run_id = " + fixture.final.id);
  assert.deepEqual(await snapshot(e.org.id), ownBefore, "veto cleanup cannot mutate persistent state");

  const succeeded = standaloneExpectStatus(await requestBind(e, fixture.final.id), 200, "real binding success");
  assert.equal(succeeded.json?.employees, 1, "annualization must process a real fictional worker");
  assert.equal(succeeded.json?.payrollSettlement?.payrollRunId, fixture.final.id);
  assert.equal(succeeded.json?.payrollSettlement?.status, "Queued");
  const after = await snapshot(e.org.id);
  const run = after.runs.find((r) => r.id === fixture.final.id);
  assert.equal(run?.status, "Queued");
  const jobs = after.jobs.filter((job) => job.payrollRunId === fixture.final.id);
  assert.equal(jobs.length, 1, "exactly one requeued job after replacing stale job");
  assert.equal(jobs[0].status, "queued");
  assert.equal(after.entries.filter((entry) => entry.payrollRunId === fixture.final.id).length, 0,
    "old pre-binding final-cutoff register was reset");
  const adjustment = after.adjustments.filter((row) => row.employeeId === e.worker.id && row.taxYear === 2026);
  assert.equal(adjustment.length, 1);
  assert.equal(adjustment[0].payrollRunId, fixture.final.id);
  assert.equal(adjustment[0].status, "settled", "balanced fictional annual tax creates no payout");
  assert.equal(Number(adjustment[0].adjustment), 0);
  const auditAdded = after.audit.slice(ownBefore.audit.length);
  assert.deepEqual(auditAdded.map((row) => row.action), [
    "Year-end annualization computed", "Payroll job queued", "Year-end tax adjustments bound to payroll",
  ], "exactly three atomic audit receipts, no missing or duplicate audit");
  assert.ok(auditAdded.every((row) => row.organizationId === e.org.id));
  assert.equal(auditAdded[0].metadata.boundPayrollRunId, fixture.final.id);
  assert.equal(auditAdded[1].metadata.runId, fixture.final.id);
  assert.equal(auditAdded[2].metadata.payrollRunId, fixture.final.id);
  assert.equal(auditAdded[2].actor, e.owner.name);
  assert.deepEqual(await snapshot(victim.org.id), victimBefore, "legitimate binding must not touch victim");

  standaloneExpectStatus(await requestBind(e, fixture.final.id), 409, "already queued cutoff");
  assert.deepEqual(await snapshot(e.org.id), after, "duplicate submission cannot duplicate jobs or adjustment");
}

async function proveConcurrentBinding(e) {
  const fixture = await seedYearEnd(e);
  const before = await snapshot(e.org.id);
  // Two independent HTTP requests race for the same employer/year/cutoff.
  // One must commit; the loser must return a reviewable conflict, not a
  // duplicate job, partial payroll adjustment or leaked SQL exception.
  const results = await Promise.all([
    requestBind(e, fixture.final.id),
    requestBind(e, fixture.final.id),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort((a, b) => a - b), [200, 409],
    "concurrent bindings must have exactly one committed winner and one safe 409");
  const failed = results.find((r) => r.status === 409);
  assert.ok(!failed.text.includes("40001") && !failed.text.includes("deadlock"),
    "SQL serialization diagnostics must not reach the public HTTP response");
  const after = await snapshot(e.org.id);
  assert.equal(after.runs.find((r) => r.id === fixture.final.id).status, "Queued");
  assert.equal(after.jobs.filter((job) => job.payrollRunId === fixture.final.id).length, 1);
  assert.equal(after.adjustments.filter((row) => row.payrollRunId === fixture.final.id).length, 1);
  assert.deepEqual(after.audit.slice(before.audit.length).map((row) => row.action), [
    "Year-end annualization computed", "Payroll job queued", "Year-end tax adjustments bound to payroll",
  ], "the losing concurrent request may commit no additional audit or payroll state");
}

async function proveStandaloneEnqueueGuards(e, fixture) {
  const { enqueuePayrollRun } = await import("../../src/lib/payroll-engine.ts");
  const releasedBefore = await snapshot(e.org.id);
  await assert.rejects(() => enqueuePayrollRun(fixture.released.id),
    /PAYROLL_RECALCULATION_NOT_ALLOWED/,
    "direct helper callers must never overwrite released payroll");
  assert.deepEqual(await snapshot(e.org.id), releasedBefore,
    "direct released-run denial may not mutate payroll, jobs or audit");

  // A synthetic, signed month-close must veto a direct helper call, even
  // without a route-level certification check.
  await db.insert(payrollMonthClosures).values({
    organizationId: e.org.id, legalEntityId: e.entity.id,
    applicableMonth: "2026-12", status: "certified",
    snapshotHash: "a".repeat(64), evidenceSnapshot: { fictional: true, source: "isolated-ci-only" },
    certifiedByName: "Fictional independent month-close",
  });
  const certifiedBefore = await snapshot(e.org.id);
  await assert.rejects(() => enqueuePayrollRun(fixture.wrongCutoff.id),
    /PAYROLL_MONTH_CERTIFIED_IMMUTABLE/,
    "standalone enqueue cannot recalculate a certified payroll month");
  assert.deepEqual(await snapshot(e.org.id), certifiedBefore,
    "certified month veto must preserve register, queue and all audit rows");
}

async function main() {
  requireTenantTableDisposable();
  for (const flag of [
    "WORKER_ENABLED", "CENTRAL_SCHEDULER_ENABLED", "XENDIT_BILLING_ENABLED",
    "XENDIT_PAYOUTS_ENABLED", "PAYMONGO_DISBURSEMENTS_ENABLED",
    "YEAR_END_PRIOR_EVIDENCE_ENABLED", "MULTI_ENTITY_ENABLED",
  ]) {
    assert.notEqual(process.env[flag], "true", flag + " must remain disabled for fictional rollback proof");
  }
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const employers = [];
  for (const label of ["ATTA", "ATTB", "VICTIM"]) {
    employers.push(await seedEmployer(label, nonce, standaloneMakeSession));
  }
  const [a, b, victim] = employers;
  const fixtures = new Map();
  for (const employer of employers) fixtures.set(employer.org.id, await seedYearEnd(employer));
  await proveEmployer(a, fixtures.get(a.org.id), victim, fixtures.get(victim.org.id));
  await proveEmployer(b, fixtures.get(b.org.id), victim, fixtures.get(victim.org.id));
  await proveStandaloneEnqueueGuards(a, fixtures.get(a.org.id));
  const concurrent = await seedEmployer("ATTA", nonce + "race", standaloneMakeSession);
  employers.push(concurrent);
  const victimBeforeConcurrent = await snapshot(victim.org.id);
  await proveConcurrentBinding(concurrent);
  assert.deepEqual(await snapshot(victim.org.id), victimBeforeConcurrent,
    "concurrent own-employer settlement may not touch unrelated victim financial state");
  await db.delete(sessions).where(inArray(sessions.userId, employers.map((e) => e.owner.id)));
  console.log(JSON.stringify({
    kind: "year-end-binding-pg16-atomic-rollback",
    independentFictionalEmployers: 2, higherIdVictimDenied: true,
    injectedVetoes: ["final-binding-audit", "queue-job-insert"],
    completeSqlRollback: true, exactAuditCount: true, exactQueuedJobCount: true,
    concurrentSingleWinner: true, concurrentLoserConflict409: true,
    standaloneReleasedAndCertifiedMonthVetoes: true,
    noProvidersOrMoney: true, securityReviewPending: true, methodCredits: 0,
  }));
}

main().then(() => pool.end(), async (error) => {
  console.error(error);
  await pool.end();
  process.exitCode = 1;
});
