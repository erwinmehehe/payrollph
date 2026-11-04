import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  auditEvents, employees, historicalPayrollEntries, organizations, payrollEntries,
  payrollRuns, yearEndAdjustments,
} from "../src/db/schema";
import { runYearEndAnnualization } from "../src/lib/year-end";

const YEAR = 2026;
const adjustmentRows = (organizationId: number, taxYear = YEAR) =>
  db.select().from(yearEndAdjustments).where(and(
    eq(yearEndAdjustments.organizationId, organizationId),
    eq(yearEndAdjustments.taxYear, taxYear),
  )).orderBy(yearEndAdjustments.id);

async function fixture() {
  const label = randomUUID().slice(0, 10);
  const [org] = await db.insert(organizations).values({
    name: "Atomic year-end " + label, legalName: "Fictional annualization " + label,
  }).returning();
  const [worker] = await db.insert(employees).values({
    organizationId: org.id, employeeNo: "YE-" + label,
    firstName: "Fictional", lastName: "Regular", title: "Staff",
    avatarInitials: "FR", basicRate: "26000.00",
    startDate: "2026-01-01",
  }).returning();
  const [payroll] = await db.insert(payrollRuns).values({
    organizationId: org.id, periodLabel: "2026-06 1-15",
    periodStart: "2026-06-01", periodEnd: "2026-06-15", payDate: "2026-06-15",
    status: "Released", employeeCount: 1,
    grossPay: "13000.00", netPay: "12450.00",
  }).returning();
  await db.insert(payrollEntries).values({
    payrollRunId: payroll.id, employeeId: worker.id,
    grossPay: "13000.00", deductions: "550.00", netPay: "12450.00",
    lineItems: [
      { code: "BASIC", label: "Basic / worked pay", amount: "13000.00" },
      { code: "SSS", label: "SSS contribution", amount: "-400.00" },
      { code: "WHT", label: "Withholding tax", amount: "-150.00" },
    ],
  });
  const [prior] = await db.insert(yearEndAdjustments).values({
    organizationId: org.id, employeeId: worker.id, taxYear: YEAR,
    grossCompensation: "999.99", adjustment: "17.37",
    outcome: "collect", status: "computed",
  }).returning();
  return { org, worker, payroll, prior };
}

function assertPriorUnchanged(before: { id: number; adjustment: string; status: string },
  after: Array<{ id: number; adjustment: string; status: string }>) {
  assert.equal(after.length, 1, "A failed recalculation must preserve the original row");
  assert.equal(after[0].id, before.id);
  assert.equal(after[0].adjustment, before.adjustment);
  assert.equal(after[0].status, before.status);
}

function isPgError(error: unknown, code: string) {
  let current: unknown = error;
  for (let depth = 0; depth < 8; depth++) {
    if (current == null || typeof current !== "object") return false;
    if ("code" in current && current.code === code) return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

async function countAudit(organizationId: number) {
  return db.select({ id: auditEvents.id }).from(auditEvents).where(and(
    eq(auditEvents.organizationId, organizationId),
    eq(auditEvents.action, "Year-end annualization computed"),
  ));
}

test("MWE imported-history calculation failure preserves the previously computed year-end adjustment", async () => {
  const { org, prior } = await fixture();
  try {
    const [mweWorker] = await db.insert(employees).values({
      organizationId: org.id, employeeNo: "MWE-" + randomUUID().slice(0, 8),
      firstName: "Fictional", lastName: "MWE", title: "Staff",
      avatarInitials: "MW", basicRate: "16000.00",
      mwe: true, startDate: "2026-01-01",
    }).returning();
    await db.insert(historicalPayrollEntries).values({
      organizationId: org.id, employeeId: mweWorker.id,
      sourceSystem: "fictional_test", sourceReference: randomUUID(),
      periodLabel: "June 2026", payDate: "2026-06-15",
      grossPay: "14000.00", basicSalary: "14000.00", netPay: "14000.00",
      taxWithheld: "0.00",
    });
    await assert.rejects(
      runYearEndAnnualization(org.id, YEAR, "Fictional finance"),
      /MWE employee.*does not contain the statutory-wage/,
    );
    assertPriorUnchanged(prior, await adjustmentRows(org.id));
    assert.equal((await countAudit(org.id)).length, 0);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("failing audit insert rolls back deletion and replacement of year-end financial records", async () => {
  const { org, prior } = await fixture();
  try {
    await assert.rejects(
      runYearEndAnnualization(org.id, YEAR, "X".repeat(121)),
      (error: unknown) => isPgError(error, "22001"),
    );
    assertPriorUnchanged(prior, await adjustmentRows(org.id));
    assert.equal((await countAudit(org.id)).length, 0,
      "Failed audit must not leave a fabricated success receipt");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("failed adjustment FK insert inside binding callback rolls back deletion and prior financial state", async () => {
  const { org, prior } = await fixture();
  try {
    const [finalRun] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Fictional year-end final cutoff",
      periodStart: "2026-12-16",
      periodEnd: "2026-12-31",
      payDate: "2026-12-31",
      status: "Needs review",
    }).returning();
    // Supply a valid, matching year-end binding and mandatory callback so
    // the FK failure occurs AFTER annualization has deleted the old row and
    // inserted a replacement. The 23503 must roll all of that back.
    await assert.rejects(runYearEndAnnualization(org.id, YEAR, "Fictional finance", {
      includePayrollRunId: finalRun.id,
      bindToPayrollRunId: finalRun.id,
      onBoundToPayrollRun: async (tx) => {
        await tx.insert(yearEndAdjustments).values({
          organizationId: org.id,
          employeeId: prior.employeeId,
          taxYear: YEAR,
          grossCompensation: "0.00",
          payrollRunId: -1,
        });
      },
    }), (error: unknown) => isPgError(error, "23503"));
    assertPriorUnchanged(prior, await adjustmentRows(org.id));
    assert.equal((await countAudit(org.id)).length, 0,
      "The rolled-back bound adjustment must leave no annualization audit");
    const [runAfter] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, finalRun.id));
    assert.equal(runAfter.status, "Needs review", "FK failure must not change the final run");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("successful replacement is tenant/year scoped, audited and refuses settled recalculation", async () => {
  const { org, prior } = await fixture();
  const { org: otherOrg, prior: otherPrior } = await fixture();
  try {
    const [priorYear] = await db.insert(yearEndAdjustments).values({
      organizationId: org.id, employeeId: prior.employeeId, taxYear: 2025,
      grossCompensation: "100.00", adjustment: "1.00", outcome: "collect",
      status: "computed",
    }).returning();
    const result = await runYearEndAnnualization(org.id, YEAR, "Fictional payroll maker");
    assert.equal(result.employees, 1);
    const fresh = await adjustmentRows(org.id);
    assert.equal(fresh.length, 1);
    assert.notEqual(fresh[0].id, prior.id);
    assert.notEqual(fresh[0].adjustment, prior.adjustment);
    assert.equal((await countAudit(org.id)).length, 1);
    assert.equal((await adjustmentRows(org.id, 2025))[0].id, priorYear.id);
    assert.equal((await adjustmentRows(otherOrg.id))[0].id, otherPrior.id);
    await db.update(yearEndAdjustments).set({ status: "settled" })
      .where(eq(yearEndAdjustments.id, fresh[0].id));
    await assert.rejects(
      runYearEndAnnualization(org.id, YEAR, "Fictional payroll maker"),
      /already been settled/,
    );
    const settled = await adjustmentRows(org.id);
    assert.equal(settled.length, 1);
    assert.equal(settled[0].id, fresh[0].id);
    assert.equal(settled[0].status, "settled");
    assert.equal((await countAudit(org.id)).length, 1);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    await db.delete(organizations).where(eq(organizations.id, otherOrg.id));
  }
});

test("concurrent annualizations cannot interleave deletions or leave duplicate financial rows", async () => {
  const { org } = await fixture();
  try {
    const outcomes = await Promise.allSettled([
      runYearEndAnnualization(org.id, YEAR, "Maker A"),
      runYearEndAnnualization(org.id, YEAR, "Maker B"),
    ]);
    const succeeded = outcomes.filter(row => row.status === "fulfilled").length;
    assert.ok(succeeded >= 1, "At least one isolated annualization must complete");
    for (const row of outcomes) if (row.status === "rejected") {
      assert.ok(isPgError(row.reason, "40001") || isPgError(row.reason, "40P01"),
        "Concurrent annualization must fail only on database serialization/deadlock");
    }
    assert.equal((await adjustmentRows(org.id)).length, 1,
      "Concurrent requests must leave exactly one committed year-end snapshot");
    assert.equal((await countAudit(org.id)).length, succeeded,
      "Every committed annualization must have one atomic audit receipt");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("an approved or run-bound adjustment is never deleted by a later recompute, with every optional flag off", async () => {
  const { org, prior } = await fixture();
  const savedFlags = [process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED, process.env.EXACT_THIRTEENTH_CENTAVOS_ENABLED];
  delete process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED;
  delete process.env.EXACT_THIRTEENTH_CENTAVOS_ENABLED;
  try {
    const [finalRun] = await db.insert(payrollRuns).values({
      organizationId: org.id, periodLabel: "Fictional year-end final cutoff",
      periodStart: "2026-12-16", periodEnd: "2026-12-31", payDate: "2026-12-31", status: "Needs review",
    }).returning();
    // The state a legitimate binding leaves: nonzero, approved, linked to the final run, and no
    // priorEvidence or thirteenthRoundingPolicy marker in its breakdown.
    await db.update(yearEndAdjustments).set({
      status: "approved", payrollRunId: finalRun.id, approvedAt: new Date(), approvedBy: "Fictional finance",
    }).where(eq(yearEndAdjustments.id, prior.id));
    const original = await adjustmentRows(org.id);
    assert.equal(original.length, 1);
    const markers = Object.keys((original[0].breakdown ?? {}) as Record<string, unknown>);
    assert.ok(!markers.includes("priorEvidence") && !markers.includes("thirteenthRoundingPolicy"),
      "fixture must not carry any optional marker");
    const auditBefore = (await countAudit(org.id)).length;
    const runBefore = (await db.select().from(payrollRuns).where(eq(payrollRuns.id, finalRun.id)))[0];

    // Unbound recompute: the case the earlier guard let through.
    await assert.rejects(runYearEndAnnualization(org.id, YEAR, "Fictional payroll maker"),
      /YEAR_END_BOUND_OR_APPROVED_RECOMPUTE_BLOCKED/);
    assert.deepEqual(await adjustmentRows(org.id), original, "the approved adjustment must be byte-identical");
    assert.equal((await countAudit(org.id)).length, auditBefore, "a refused recompute leaves no audit receipt");
    assert.deepEqual((await db.select().from(payrollRuns).where(eq(payrollRuns.id, finalRun.id)))[0], runBefore);

    // A second bound request is refused the same way.
    await assert.rejects(runYearEndAnnualization(org.id, YEAR, "Fictional finance", {
      includePayrollRunId: finalRun.id, bindToPayrollRunId: finalRun.id, onBoundToPayrollRun: async () => {},
    }), /YEAR_END_BOUND_OR_APPROVED_RECOMPUTE_BLOCKED/);
    assert.deepEqual(await adjustmentRows(org.id), original);

    // Either half of the immutable state alone is enough to refuse.
    for (const patch of [{ status: "computed", payrollRunId: finalRun.id }, { status: "approved", payrollRunId: null }] as const) {
      await db.update(yearEndAdjustments).set(patch).where(eq(yearEndAdjustments.id, prior.id));
      const held = await adjustmentRows(org.id);
      await assert.rejects(runYearEndAnnualization(org.id, YEAR, "Fictional payroll maker"),
        /YEAR_END_BOUND_OR_APPROVED_RECOMPUTE_BLOCKED/);
      assert.deepEqual(await adjustmentRows(org.id), held);
    }

    // A plain computed row with no run link can still be recomputed.
    await db.update(yearEndAdjustments).set({ status: "computed", payrollRunId: null, approvedAt: null, approvedBy: null })
      .where(eq(yearEndAdjustments.id, prior.id));
    assert.equal((await runYearEndAnnualization(org.id, YEAR, "Fictional payroll maker")).employees, 1);
  } finally {
    if (savedFlags[0] === undefined) delete process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED; else process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED = savedFlags[0];
    if (savedFlags[1] === undefined) delete process.env.EXACT_THIRTEENTH_CENTAVOS_ENABLED; else process.env.EXACT_THIRTEENTH_CENTAVOS_ENABLED = savedFlags[1];
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("only an unmarked approved row whose run can no longer be paid is released for recompute", async () => {
  const { org, prior } = await fixture();
  const savedFlags = [process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED, process.env.EXACT_THIRTEENTH_CENTAVOS_ENABLED];
  delete process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED;
  delete process.env.EXACT_THIRTEENTH_CENTAVOS_ENABLED;
  try {
    const bindTo = async (status: string) => {
      const [run] = await db.insert(payrollRuns).values({
        organizationId: org.id, periodLabel: "Fictional final cutoff " + status,
        periodStart: "2026-12-16", periodEnd: "2026-12-31", payDate: "2026-12-31", status,
      }).returning();
      await db.update(yearEndAdjustments).set({
        status: "approved", payrollRunId: run.id, approvedAt: new Date(), approvedBy: "Fictional finance", breakdown: {},
      }).where(eq(yearEndAdjustments.id, prior.id));
      return run;
    };
    // A run that can still be paid keeps its approved year-end line, whatever the status name.
    for (const status of ["Draft", "Queued", "Processing", "Needs review", "Approved", "Released"]) {
      await bindTo(status);
      const held = await adjustmentRows(org.id);
      await assert.rejects(runYearEndAnnualization(org.id, YEAR, "Fictional payroll maker"),
        /YEAR_END_BOUND_OR_APPROVED_RECOMPUTE_BLOCKED/, status + " run must hold its adjustment");
      assert.deepEqual(await adjustmentRows(org.id), held, status + ": byte-identical");
    }
    // A run that can never be paid does not hold it, so a replacement final cutoff can be annualized.
    for (const status of ["Failed", "Cancelled", "Voided", "Superseded"]) {
      await bindTo(status);
      const result = await runYearEndAnnualization(org.id, YEAR, "Fictional payroll maker");
      assert.equal(result.employees, 1, status + " run releases its adjustment");
      const fresh = await adjustmentRows(org.id);
      assert.equal(fresh.length, 1);
      assert.equal(fresh[0].status, "computed");
      assert.equal(fresh[0].payrollRunId, null);
      prior.id = fresh[0].id;
    }
    // A prior-evidence marker or a settled row is never released, even for an unpayable run.
    await bindTo("Voided");
    await db.update(yearEndAdjustments).set({ breakdown: { priorEvidence: { id: 1, revision: 1, digest: "x" } } })
      .where(eq(yearEndAdjustments.id, prior.id));
    await assert.rejects(runYearEndAnnualization(org.id, YEAR, "Fictional payroll maker"), /RECOMPUTE_BLOCKED/);
    await db.update(yearEndAdjustments).set({ breakdown: {}, status: "settled" }).where(eq(yearEndAdjustments.id, prior.id));
    await assert.rejects(runYearEndAnnualization(org.id, YEAR, "Fictional payroll maker"), /already been settled/);
    // A run that belongs to another employer never releases this employer's row.
    const other = await fixture();
    try {
      const [foreignVoided] = await db.insert(payrollRuns).values({
        organizationId: other.org.id, periodLabel: "Fictional foreign voided cutoff",
        periodStart: "2026-12-16", periodEnd: "2026-12-31", payDate: "2026-12-31", status: "Voided",
      }).returning();
      await db.update(yearEndAdjustments).set({ status: "approved", payrollRunId: foreignVoided.id, breakdown: {} })
        .where(eq(yearEndAdjustments.id, prior.id));
      await assert.rejects(runYearEndAnnualization(org.id, YEAR, "Fictional payroll maker"), /YEAR_END_BOUND_OR_APPROVED_RECOMPUTE_BLOCKED/);
    } finally {
      await db.delete(organizations).where(eq(organizations.id, other.org.id));
    }
  } finally {
    if (savedFlags[0] === undefined) delete process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED; else process.env.YEAR_END_PRIOR_EVIDENCE_ENABLED = savedFlags[0];
    if (savedFlags[1] === undefined) delete process.env.EXACT_THIRTEENTH_CENTAVOS_ENABLED; else process.env.EXACT_THIRTEENTH_CENTAVOS_ENABLED = savedFlags[1];
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
