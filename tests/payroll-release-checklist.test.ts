import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { approvalTasks, employees, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import { buildPayrollReleaseChecklist } from "../src/lib/payroll-release-checklist";
import { managedPayrollRunFingerprint } from "../src/lib/managed-payroll";

test("release checklist gates payout readiness and approved checker state", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Checklist Test",
    legalName: "Checklist Test Inc.",
    plan: "Core",
  }).returning();

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "CHECK-001",
      firstName: "Release",
      lastName: "Ready",
      title: "Associate",
      avatarInitials: "RR",
      basicRate: "30000.00",
      bankAccount: "1234567890",
      bankCode: "BDO",
      startDate: "2025-01-01",
      status: "Active",
    }).returning();

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026 checklist",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      scopeLabel: "All locations",
      status: "Ready for release",
      payDate: "2026-09-30",
      employeeCount: 1,
      grossPay: "15000.00",
      netPay: "13000.00",
      processedChunks: 1,
      totalChunks: 1,
    }).returning();

    await db.insert(payrollEntries).values({
      payrollRunId: run.id,
      employeeId: employee.id,
      grossPay: "15000.00",
      deductions: "2000.00",
      netPay: "13000.00",
      status: "Ready",
      lineItems: [
        { code: "BASIC", label: "Basic / worked pay", amount: "15000.00" },
        { code: "SSS", label: "SSS contribution", amount: "-700.00" },
        { code: "PHIC", label: "PhilHealth contribution", amount: "-500.00" },
        { code: "HDMF", label: "Pag-IBIG contribution", amount: "-100.00" },
        { code: "WHT", label: "Withholding tax", amount: "-700.00" },
      ],
      trace: {
        ruleVersion: "PH-2026.01",
        inputs: ["punches=10", "regularMinutes=4800"],
        flags: [],
      },
    });

    const payrollFingerprint = await managedPayrollRunFingerprint(run.id);
    await db.insert(approvalTasks).values({
      organizationId: org.id,
      title: "Review payroll",
      detail: `Payroll run #${run.id} · checklist test`,
      approver: "Checker",
      dueLabel: "Required before release",
      status: "Approved",
      decidedBy: "Checker",
      decidedAt: new Date(),
      payrollRunId: run.id,
      payrollFingerprint,
      payrollGross: run.grossPay,
      payrollNet: run.netPay,
      payrollEmployeeCount: run.employeeCount,
    });

    const ready = await buildPayrollReleaseChecklist(run.id);
    assert.equal(ready?.ready, true);
    assert.ok(ready?.items.every((item) => item.passed));

    await db.update(employees).set({ bankAccount: null }).where(eq(employees.id, employee.id));
    const blocked = await buildPayrollReleaseChecklist(run.id);
    assert.equal(blocked?.ready, false);
    assert.equal(blocked?.items.find((item) => item.key === "bank")?.passed, false);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
