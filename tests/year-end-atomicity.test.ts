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

test("failed adjustment FK insert rolls back deletion and leaves the old calculation intact", async () => {
  const { org, prior } = await fixture();
  try {
    await assert.rejects(runYearEndAnnualization(
      org.id, YEAR, "Fictional finance", { bindToPayrollRunId: -1 },
    ), (error: unknown) => isPgError(error, "23503"));
    assertPriorUnchanged(prior, await adjustmentRows(org.id));
    assert.equal((await countAudit(org.id)).length, 0);
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
