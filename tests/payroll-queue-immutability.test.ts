import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employees, legalEntities, organizations, payrollEntries, payrollJobs,
  payrollMonthClosures, payrollRuns,
} from "../src/db/schema";
import { enqueuePayrollRun } from "../src/lib/payroll-engine";

test("queue rejects Released payroll before deleting even one original register entry", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Immutable Payroll Queue Regression", legalName: "Immutable Payroll Queue Regression Inc.",
  }).returning();
  try {
    const [entity] = await db.insert(legalEntities).values({
      organizationId: org.id, code: "MAIN", legalName: "Immutable Payroll Inc.",
      displayName: "Immutable Payroll",
    }).returning();
    const [worker] = await db.insert(employees).values({
      organizationId: org.id, legalEntityId: entity.id, employeeNo: "IMM-001",
      firstName: "Payroll", lastName: "Worker", title: "Employee",
      avatarInitials: "PW", basicRate: "20000.00", startDate: "2026-01-01",
    }).returning();
    const [released] = await db.insert(payrollRuns).values({
      organizationId: org.id, legalEntityId: entity.id,
      periodLabel: "Sep 2026 released", periodStart: "2026-09-16",
      periodEnd: "2026-09-30", payDate: "2026-09-30",
      status: "Released", employeeCount: 1, grossPay: "10000.00", netPay: "9000.00",
    }).returning();
    const [entry] = await db.insert(payrollEntries).values({
      payrollRunId: released.id, employeeId: worker.id,
      grossPay: "10000.00", deductions: "1000.00", netPay: "9000.00",
    }).returning();

    await assert.rejects(() => enqueuePayrollRun(released.id), /PAYROLL_RECALCULATION_NOT_ALLOWED/);
    const [unchanged] = await db.select().from(payrollRuns)
      .where(eq(payrollRuns.id, released.id));
    const [stillExists] = await db.select().from(payrollEntries)
      .where(eq(payrollEntries.id, entry.id));
    assert.equal(unchanged.status, "Released");
    assert.equal(unchanged.netPay, "9000.00");
    assert.equal(stillExists?.netPay, "9000.00");
    assert.equal((await db.select().from(payrollJobs)
      .where(eq(payrollJobs.payrollRunId, released.id))).length, 0);

    // Even a corrupted Draft status cannot rewrite a formally certified month.
    const [closedButDraft] = await db.insert(payrollRuns).values({
      organizationId: org.id, legalEntityId: entity.id,
      periodLabel: "Sep 2026 closed", periodStart: "2026-09-01",
      periodEnd: "2026-09-15", payDate: "2026-09-15", status: "Draft",
    }).returning();
    await db.insert(payrollMonthClosures).values({
      organizationId: org.id, legalEntityId: entity.id,
      applicableMonth: "2026-09", status: "certified",
      snapshotHash: "a".repeat(64),
      evidenceSnapshot: { test: "closed", payrollRunId: released.id },
      certifiedByName: "Separate month-close checker",
    });
    await assert.rejects(
      () => enqueuePayrollRun(closedButDraft.id),
      /PAYROLL_MONTH_CERTIFIED_IMMUTABLE/,
    );
    const [unmodified] = await db.select().from(payrollRuns)
      .where(eq(payrollRuns.id, closedButDraft.id));
    assert.equal(unmodified.status, "Draft");

    // Different pay month can still queue normally.
    const [openMonth] = await db.insert(payrollRuns).values({
      organizationId: org.id, legalEntityId: entity.id,
      periodLabel: "Oct 2026 open", periodStart: "2026-10-01",
      periodEnd: "2026-10-15", payDate: "2026-10-15", status: "Draft",
    }).returning();
    const result = await enqueuePayrollRun(openMonth.id);
    assert.equal(result.runId, openMonth.id);
    const [queued] = await db.select().from(payrollRuns)
      .where(eq(payrollRuns.id, openMonth.id));
    assert.equal(queued.status, "Queued");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});

test("destructive queue rewrites and status claim are under the same lock/transaction", () => {
  const s = readFileSync("src/lib/payroll-engine.ts", "utf8");
  const start = s.indexOf("export async function enqueuePayrollRun");
  const end = s.indexOf("export async function processNextPayrollJob", start);
  const source = s.slice(start, end);
  assert.match(source, /db.transaction\(async \(tx\) =>/);
  assert.match(source, /SELECT id FROM payroll_runs WHERE id = \$\{runId\} FOR UPDATE/);
  assert.match(source, /PAYROLL_RECALCULATION_NOT_ALLOWED/);
  assert.match(source, /PAYROLL_MONTH_CERTIFIED_IMMUTABLE/);
  assert.match(source, /lockedRun\.scopeOrgUnitId !== run\.scopeOrgUnitId/,
    "Changing a run's org-unit scope during queue preparation must invalidate the claim");
  assert.ok(source.indexOf("PAYROLL_MONTH_CERTIFIED_IMMUTABLE") < source.indexOf("tx.delete(payrollEntries)"));
  assert.ok(source.includes("await tx.delete(payrollEntries)"));
  assert.ok(source.includes("await tx.update(payrollRuns)"));
  assert.ok(source.includes("await tx.insert(payrollJobs)"));
  assert.ok(!source.includes("await db.delete(payrollEntries)"));
});
