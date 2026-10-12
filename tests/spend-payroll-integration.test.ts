import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employees, employeePayProfiles, expenseCategoryPolicies, expenseClaims,
  organizations, payrollEntries, payrollRuns, users,
} from "../src/db/schema";
import { drainPayrollQueue, enqueuePayrollRun } from "../src/lib/payroll-engine";

const readTrace = (value: unknown, name: string): number | null => {
  const inputs = value && typeof value === "object" ? (value as { inputs?: unknown }).inputs : null;
  if (!Array.isArray(inputs)) return null;
  const text = inputs.find(row => typeof row === "string" && row.startsWith(name + "="));
  if (typeof text !== "string") return null;
  const parsed = Number(text.slice(name.length + 1));
  return Number.isFinite(parsed) ? parsed : null;
};

test("tax-reviewed reimbursement changes withholding base but never changes SSS/Pag-IBIG bases", async () => {
  const prior = process.env.SPEND_PAYROLL_REIMBURSEMENTS_ENABLED;
  process.env.SPEND_PAYROLL_REIMBURSEMENTS_ENABLED = "true";
  const [org] = await db.insert(organizations).values({
    name: "A4 Synthetic Payroll Employer", legalName: "A4 Synthetic Payroll Employer Inc.", plan: "Core",
  }).returning();
  let reviewerId: number | null = null;
  try {
    const [reviewer] = await db.insert(users).values({
      email: "spend-test-" + org.id + "@example.invalid",
      name: "Synthetic Tax Reviewer",
      passwordHash: "synthetic-not-a-login-hash",
      role: "owner",
    }).returning();
    reviewerId = reviewer.id;
    const staff = await db.insert(employees).values([
      { organizationId: org.id, employeeNo: "EXP-TAXED", firstName: "Taxed",
        lastName: "Reimbursed", title: "Associate", avatarInitials: "TR",
        basicRate: "60000.00", startDate: "2025-01-01" },
      { organizationId: org.id, employeeNo: "EXP-EXEMPT", firstName: "Exempt",
        lastName: "Reimbursed", title: "Associate", avatarInitials: "ER",
        basicRate: "60000.00", startDate: "2025-01-01" },
    ]).returning();

    await db.insert(employeePayProfiles).values(staff.map(employee => ({
      organizationId: org.id, employeeId: employee.id, payBasis: "monthly",
      rateAmount: "60000.00", standardWorkDaysPerMonth: "22",
      standardHoursPerDay: "8",
    })));
    const policies = await db.insert(expenseCategoryPolicies).values([
      { organizationId: org.id, category: "Taxable benefit reimbursement",
        taxable: true, reviewReference: "Synthetic tax policy review 2026-A4",
        reviewedByUserId: reviewer.id },
      { organizationId: org.id, category: "Documented business travel",
        taxable: false, reviewReference: "Synthetic substantiated business travel review",
        reviewedByUserId: reviewer.id },
    ]).returning();
    const receiptSha = "a".repeat(64);
    const claims = await db.insert(expenseClaims).values(staff.map((employee, i) => ({
      organizationId: org.id, employeeId: employee.id,
      submittedByUserId: reviewer.id,
      category: policies[i].category, categoryPolicyId: policies[i].id,
      taxable: policies[i].taxable,
      description: "Synthetic reimbursed expense", amount: "450.01",
      approvedAmount: "450.01", incurredOn: "2026-09-08",
      receiptStorageKey: "private-documents/" + org.id + "/" + employee.id +
        "/00000000-0000-4000-8000-00000000000" + (i + 1),
      receiptSha256: receiptSha, receiptMime: "application/pdf", receiptFileName: "receipt.pdf",
      receiptScanNote: "Synthetic reviewed scanner result — no real file",
      status: "approved",
    }))).returning();
    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id, periodLabel: "A4 Sep 1–15 2026 review",
      periodStart: "2026-09-01", periodEnd: "2026-09-15",
      payDate: "2026-09-15", status: "Draft", scopeLabel: "All locations",
    }).returning();

    await enqueuePayrollRun(run.id);
    await drainPayrollQueue(15, run.id);

    const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    assert.equal(entries.length, 2, "one entry per employee, no duplicates");
    const byId = new Map(entries.map(row => [row.employeeId, row]));
    const taxed = byId.get(staff[0].id);
    const exempt = byId.get(staff[1].id);
    assert.ok(taxed && exempt);
    const toLines = (entry: typeof payrollEntries.$inferSelect) => entry.lineItems as Array<{
      code: string; amount: string; notes?: string[];
    }>;
    const taxableLine = toLines(taxed!).find(line => line.code === "EXP-" + claims[0].id);
    const exemptLine = toLines(exempt!).find(line => line.code === "EXP-" + claims[1].id);
    assert.equal(Number(taxableLine?.amount), 450.01);
    assert.equal(Number(exemptLine?.amount), 450.01);
    assert.ok(taxableLine?.notes?.includes("Taxable reimbursement"));
    assert.ok(exemptLine?.notes?.includes("Non-taxable reimbursement"));
    assert.equal(Number(taxed!.grossPay), Number(exempt!.grossPay));

    const taxedBase = readTrace(taxed!.trace, "taxableCompensation");
    const exemptBase = readTrace(exempt!.trace, "taxableCompensation");
    assert.ok(taxedBase !== null && exemptBase !== null);
    assert.equal(Math.round((taxedBase! - exemptBase!) * 100), 45001);
    for (const base of ["sssCutoffRemuneration", "pagIbigCutoffCompensation"]) {
      const left = readTrace(taxed!.trace, base);
      const right = readTrace(exempt!.trace, base);
      if (left !== null && right !== null) assert.equal(left, right,
        "reviewed taxable flag must not distort statutory contribution base " + base);
    }
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    if (reviewerId !== null) await db.delete(users).where(eq(users.id, reviewerId));
    if (prior === undefined) delete process.env.SPEND_PAYROLL_REIMBURSEMENTS_ENABLED;
    else process.env.SPEND_PAYROLL_REIMBURSEMENTS_ENABLED = prior;
  }
});
