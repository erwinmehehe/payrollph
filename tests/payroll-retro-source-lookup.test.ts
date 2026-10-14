import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employeePayRetroAdjustments, employeePayRevisions, employees, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import { loadPendingPayrollRetroSources } from "../src/lib/payroll-retro-source-lookup";
import { reviewRetroStatutorySourcePeriods } from "../src/lib/payroll-retro-statutory-source-period";

test("M-10 source lookup uses the original run and never joins another employer's period", async () => {
  // CI shard uses disposable PostgreSQL. Never point this test at shared Neon.
  const ids = randomUUID().slice(0, 8);
  const orgs = await db.insert(organizations).values([
    { name: "M10 employer A " + ids, legalName: "Synthetic A", plan: "Core" },
    { name: "M10 employer B " + ids, legalName: "Synthetic B", plan: "Core" },
  ]).returning();
  const [a, b] = orgs;
  try {
    const [worker] = await db.insert(employees).values({
      organizationId: a.id, employeeNo: "M10-" + ids,
      firstName: "Synthetic", lastName: "Worker", title: "QA",
      avatarInitials: "SW", basicRate: "30000.00", startDate: "2026-01-01",
    }).returning();
    const [revision] = await db.insert(employeePayRevisions).values({
      organizationId: a.id, employeeId: worker.id, effectiveDate: "2026-10-01",
      previousPayBasis: "monthly", previousRateAmount: "28000.00",
      previousStandardWorkDaysPerMonth: "22.00", previousStandardHoursPerDay: "8.00",
      newPayBasis: "monthly", newRateAmount: "30000.00",
      newStandardWorkDaysPerMonth: "22.00", newStandardHoursPerDay: "8.00",
      reason: "Synthetic compensation correction",
    }).returning();

    const [own, foreign] = await Promise.all([
      db.insert(payrollRuns).values({
        organizationId: a.id, periodLabel: "Sept A", status: "Released",
        periodStart: "2026-09-01", periodEnd: "2026-09-15", payDate: "2026-09-16",
      }).returning(),
      db.insert(payrollRuns).values({
        organizationId: b.id, periodLabel: "Aug B", status: "Released",
        periodStart: "2026-08-01", periodEnd: "2026-08-15", payDate: "2026-08-16",
      }).returning(),
    ]);
    await db.insert(payrollEntries).values({
      payrollRunId: own[0].id, employeeId: worker.id,
      grossPay: "15000.00", deductions: "2500.00", netPay: "12500.00",
    });
    const [unrelatedRun] = await db.insert(payrollRuns).values({
      organizationId: a.id, periodLabel: "No employee source",
      periodStart: "2026-07-01", periodEnd: "2026-07-15", payDate: "2026-07-16",
      status: "Released",
    }).returning();
    const retro = await db.insert(employeePayRetroAdjustments).values([
      {
        organizationId: a.id, employeeId: worker.id, revisionId: revision.id,
        sourcePayrollRunId: own[0].id, sourcePeriodLabel: "UNTRUSTED JAN LABEL",
        amount: "250.25",
      },
      {
        organizationId: a.id, employeeId: worker.id, revisionId: revision.id,
        sourcePayrollRunId: foreign[0].id, sourcePeriodLabel: "UNTRUSTED OCT LABEL",
        amount: "125.25",
      },
      {
        organizationId: a.id, employeeId: worker.id, revisionId: revision.id,
        sourcePayrollRunId: unrelatedRun.id, sourcePeriodLabel: "FAKE SOURCE",
        amount: "75.25",
      },
    ]).returning();
    const loaded = await loadPendingPayrollRetroSources({ organizationId: a.id, employeeIds: [worker.id] });
    assert.equal(loaded.length, 3);
    const unrelated = loaded.find(row => row.id === retro[2].id);
    assert.ok(unrelated);
    assert.equal(unrelated.sourcePeriodStart, null, "run with no employee pay entry cannot establish attribution");
    assert.equal(unrelated.sourcePeriodEnd, null);
    const ownRow = loaded.find(row => row.id === retro[0].id);
    const foreignRow = loaded.find(row => row.id === retro[1].id);
    assert.ok(ownRow && foreignRow);
    assert.equal(ownRow.sourcePeriodStart, "2026-09-01");
    assert.equal(ownRow.sourcePeriodEnd, "2026-09-15");
    assert.equal(ownRow.sourcePeriodLabel, "UNTRUSTED JAN LABEL");
    assert.equal(foreignRow.sourcePeriodStart, null, "cross-tenant source date must never leak");
    assert.equal(foreignRow.sourcePeriodEnd, null);
    const flags = reviewRetroStatutorySourcePeriods({
      currentPeriodStart: "2026-10-01", currentPeriodEnd: "2026-10-15",
      adjustments: loaded.map(row => ({
        id: row.id, amount: Number(row.amount),
        sourcePeriodStart: row.sourcePeriodStart, sourcePeriodEnd: row.sourcePeriodEnd,
      })),
    });
    assert.ok(flags.some(flag => flag.includes("STATUTORY_RETRO_PRIOR_MONTH_REVIEW")));
    assert.ok(flags.some(flag => flag.includes("STATUTORY_RETRO_SOURCE_UNVERIFIED")));

    assert.deepEqual(await loadPendingPayrollRetroSources({
      organizationId: b.id, employeeIds: [worker.id],
    }), [], "a different employer cannot load the worker's pending retro");
    assert.deepEqual(await loadPendingPayrollRetroSources({
      organizationId: a.id, employeeIds: [],
    }), [], "zero workers is a zero-row query");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, a.id));
    await db.delete(organizations).where(eq(organizations.id, b.id));
  }
});
