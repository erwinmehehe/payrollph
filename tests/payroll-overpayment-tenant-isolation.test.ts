import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employees, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import { loadReleasedOverpaymentEvidence } from "../src/lib/payroll-overpayment-preview-server";

test("overpayment preview source retrieval cannot mix employees and Released runs between employers", async () => {
  const suffix = randomUUID().slice(0, 10);
  const [alpha, beta] = await db.insert(organizations).values([
    { name: "Overpayment Alpha " + suffix, legalName: "Overpayment Alpha " + suffix, plan: "Core" },
    { name: "Overpayment Beta " + suffix, legalName: "Overpayment Beta " + suffix, plan: "Core" },
  ]).returning();

  try {
    const [workerA] = await db.insert(employees).values({
      organizationId: alpha.id, employeeNo: "ALPHA-READ-ONLY",
      firstName: "Only", lastName: "Alpha", title: "Staff",
      avatarInitials: "OA", basicRate: "20000.00",
      startDate: "2025-01-01", status: "Separated",
    }).returning();
    const [workerB] = await db.insert(employees).values({
      organizationId: beta.id, employeeNo: "BETA-READ-ONLY",
      firstName: "Only", lastName: "Beta", title: "Staff",
      avatarInitials: "OB", basicRate: "21000.00",
      startDate: "2025-01-01", status: "Active",
    }).returning();
    const [runA] = await db.insert(payrollRuns).values({
      organizationId: alpha.id, periodLabel: "Sep 2026 A",
      periodStart: "2026-09-01", periodEnd: "2026-09-15",
      payDate: "2026-09-15", status: "Released",
    }).returning();
    const [runB] = await db.insert(payrollRuns).values({
      organizationId: beta.id, periodLabel: "Sep 2026 B",
      periodStart: "2026-09-01", periodEnd: "2026-09-15",
      payDate: "2026-09-15", status: "Released",
    }).returning();
    const [unreleased] = await db.insert(payrollRuns).values({
      organizationId: alpha.id, periodLabel: "Oct 2026 Draft",
      periodStart: "2026-10-01", periodEnd: "2026-10-15",
      payDate: "2026-10-15", status: "Draft",
    }).returning();
    await db.insert(payrollEntries).values([
      { payrollRunId: runA.id, employeeId: workerA.id,
        grossPay: "20000.00", deductions: "3500.00", netPay: "16500.00",
        lineItems: [{ code: "BASIC", amount: "20000.00" }] },
      { payrollRunId: runB.id, employeeId: workerB.id,
        grossPay: "21000.00", deductions: "4000.00", netPay: "17000.00",
        lineItems: [{ code: "BASIC", amount: "21000.00" }] },
    ]);

    const allowed = await loadReleasedOverpaymentEvidence(alpha.id, workerA.id, runA.id);
    assert.equal(allowed.ok, true, "historically Separated workers remain reviewable");
    if (allowed.ok) {
      assert.equal(allowed.worker.employeeNo, "ALPHA-READ-ONLY");
      assert.equal(allowed.entry.grossPay, "20000.00");
      assert.equal(allowed.run.organizationId, alpha.id);
    }

    for (const tuple of [
      [alpha.id, workerB.id, runB.id],
      [alpha.id, workerB.id, runA.id],
      [alpha.id, workerA.id, runB.id],
      [beta.id, workerA.id, runA.id],
      [beta.id, workerA.id, runB.id],
      [alpha.id, workerA.id, unreleased.id],
      [alpha.id, -1, runA.id],
    ]) {
      const result = await loadReleasedOverpaymentEvidence(tuple[0], tuple[1], tuple[2]);
      assert.deepEqual(result, { ok: false, reason: "SOURCE_NOT_FOUND" },
        "foreign or unreleased source must fail: " + tuple.join("/"));
    }

    // A corrupted historical register must never choose one of two records
    // arbitrarily. One extra duplicate is a hard evidence-reconciliation hold.
    await db.insert(payrollEntries).values({
      payrollRunId: runA.id, employeeId: workerA.id,
      grossPay: "20000.00", deductions: "3500.00", netPay: "16500.00",
      lineItems: [{ code: "BASIC", amount: "20000.00" }],
    });
    assert.deepEqual(await loadReleasedOverpaymentEvidence(alpha.id, workerA.id, runA.id),
      { ok: false, reason: "SOURCE_ENTRY_COUNT" });
    // No status, salary or original payroll state was mutated by the reader.
    const [workerAfter] = await db.select().from(employees).where(eq(employees.id, workerA.id));
    const [runAfter] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runA.id));
    assert.equal(workerAfter.status, "Separated");
    assert.equal(runAfter.status, "Released");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, alpha.id));
    await db.delete(organizations).where(eq(organizations.id, beta.id));
  }
});
