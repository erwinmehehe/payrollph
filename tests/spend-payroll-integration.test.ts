import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { spendIsolatedDatabase } from "./helpers/spend-isolated-database";
import { encryptBankAccount } from "../src/lib/bank-account-crypto";
import {
  employees, employeePayProfiles, expenseCategoryPolicies, expenseClaimEvidence, expenseClaims,
  organizations, payrollEntries, payrollRuns, users,
} from "../src/db/schema";

const readTrace = (value: unknown, name: string): number | null => {
  const inputs = value && typeof value === "object" ? (value as { inputs?: unknown }).inputs : null;
  if (!Array.isArray(inputs)) return null;
  const text = inputs.find(row => typeof row === "string" && row.startsWith(name + "="));
  if (typeof text !== "string") return null;
  const parsed = Number(text.slice(name.length + 1));
  return Number.isFinite(parsed) ? parsed : null;
};

test("tax-reviewed reimbursement changes withholding base but never changes SSS/Pag-IBIG bases", async () => {
  const fixture = await spendIsolatedDatabase();
  const { db } = fixture;
  const { drainPayrollQueue, enqueuePayrollRun } = await import("../src/lib/payroll-engine");
  const prior = process.env.SPEND_PAYROLL_REIMBURSEMENTS_ENABLED;
  process.env.SPEND_PAYROLL_REIMBURSEMENTS_ENABLED = "true";
  const [org] = await db.insert(organizations).values({
    name: "A4 Synthetic Payroll Employer", legalName: "A4 Synthetic Payroll Employer Inc.", plan: "Core",
  }).returning();
  let reviewerId: number | null = null;
  try {
    const [reviewer, maker] = await db.insert(users).values([{
      email: "spend-test-" + org.id + "@example.invalid",
      name: "Synthetic Tax Reviewer",
      passwordHash: "synthetic-not-a-login-hash",
      role: "owner",
    }, { email: "spend-maker-" + org.id + "@example.invalid", name: "Synthetic maker",
      passwordHash: "synthetic-not-a-login-hash", role: "employee" }]).returning();
    reviewerId = reviewer.id;
    const staff = await db.insert(employees).values([
      { organizationId: org.id, employeeNo: "EXP-TAXED", firstName: "Taxed",
        lastName: "Reimbursed", title: "Associate", avatarInitials: "TR",
        basicRate: "60000.00", startDate: "2025-01-01",
        bankCode: "BDO", bankAccount: encryptBankAccount("0000000001") },
      { organizationId: org.id, employeeNo: "EXP-EXEMPT", firstName: "Exempt",
        lastName: "Reimbursed", title: "Associate", avatarInitials: "ER",
        basicRate: "60000.00", startDate: "2025-01-01",
        bankCode: "BDO", bankAccount: encryptBankAccount("0000000002") },
      { organizationId: org.id, employeeNo: "EXP-MWE-TAXED", firstName: "MWE taxed",
        lastName: "Synthetic", title: "Associate", avatarInitials: "MT", mwe: true,
        basicRate: "11000.00", startDate: "2025-01-01", bankCode: "BDO", bankAccount: encryptBankAccount("0000000003") },
      { organizationId: org.id, employeeNo: "EXP-MWE-EXEMPT", firstName: "MWE exempt",
        lastName: "Synthetic", title: "Associate", avatarInitials: "ME", mwe: true,
        basicRate: "11000.00", startDate: "2025-01-01", bankCode: "BDO", bankAccount: encryptBankAccount("0000000004") },
    ]).returning();

    await db.insert(employeePayProfiles).values(staff.map(employee => ({
      organizationId: org.id, employeeId: employee.id, payBasis: "monthly",
      rateAmount: employee.basicRate, standardWorkDaysPerMonth: "22",
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
      submittedByUserId: maker.id,
      category: policies[i % 2].category,
      description: "Synthetic reimbursed expense", amount: i < 2 ? "500.00" : "20000.00",
      incurredOn: "2026-09-08", status: "approved",
    }))).returning();
    await db.insert(expenseClaimEvidence).values(claims.map((claim, i) => ({
      claimId: claim.id, organizationId: org.id, employeeId: staff[i].id,
      categoryPolicyId: policies[i % 2].id, taxable: policies[i % 2].taxable,
      approvedAmount: i < 2 ? "450.01" : "20000.00", approvedByUserId: reviewer.id, approvedAt: new Date(),
      receiptStorageKey: "private-documents/" + org.id + "/" + staff[i].id +
        "/00000000-0000-4000-8000-00000000000" + (i + 1),
      receiptSha256: receiptSha, receiptByteSize: 8, receiptVerifiedAt: new Date(),
      receiptMime: "application/pdf", receiptFileName: "receipt.pdf",
      receiptScanNote: "Synthetic reviewed scanner result — no real file",
    })));
    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id, periodLabel: "A4 Sep 1–15 2026 review",
      periodStart: "2026-09-01", periodEnd: "2026-09-15",
      payDate: "2026-09-15", status: "Draft", scopeLabel: "All locations",
    }).returning();

    await enqueuePayrollRun(run.id);
    await drainPayrollQueue(15, run.id);

    const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
    assert.equal(entries.length, 4, "one entry per employee, no duplicates");
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
    for (const base of ["statutoryMonthlySssCompensation", "statutoryMonthlyPagIbigCompensation"]) {
      const left = readTrace(taxed!.trace, base);
      const right = readTrace(exempt!.trace, base);
      assert.ok(left !== null && right !== null, "Required statutory base trace must exist");
      assert.equal(left, right,
        "reviewed taxable flag must not distort statutory contribution base " + base);
    }
    const mweTaxed = byId.get(staff[2].id)!, mweExempt = byId.get(staff[3].id)!;
    assert.equal(readTrace(mweTaxed.trace, "mweTaxableSupplementaryCompensation"), 20000);
    assert.equal(readTrace(mweExempt.trace, "mweTaxableSupplementaryCompensation"), 0);
    assert.equal(Number(toLines(mweExempt).find(line => line.code === "WHT")?.amount ?? 0), 0);
    assert.ok(Number(toLines(mweTaxed).find(line => line.code === "WHT")?.amount) < 0, "MWE taxable reimbursement is not silently exempted");
    for (const base of ["statutoryMonthlySssCompensation", "statutoryMonthlyPagIbigCompensation"]) {
      assert.equal(readTrace(mweTaxed.trace, base), readTrace(mweExempt.trace, base));
    }
    const { settlePayrollRun } = await import("../src/lib/payroll-settlement");
    const [laterRun] = await db.insert(payrollRuns).values({ organizationId: org.id,
      periodLabel: "A4 Sep 16-30 synthetic", periodStart: "2026-09-16", periodEnd: "2026-09-30",
      payDate: "2026-09-30", status: "Draft", scopeLabel: "All locations" }).returning();
    await enqueuePayrollRun(laterRun.id);
    await drainPayrollQueue(15, laterRun.id);
    // Corrupt a register intentionally; no transaction may partially settle it.
    const originalLines = taxed!.lineItems as unknown[];
    await db.update(payrollEntries).set({ lineItems: [...originalLines, taxableLine] }).where(eq(payrollEntries.id, taxed!.id));
    await db.update(payrollRuns).set({ status: "Releasing" }).where(eq(payrollRuns.id, run.id));
    await assert.rejects(settlePayrollRun(run.id), /duplicate expense reimbursement/);
    assert.equal((await db.select().from(expenseClaims).where(eq(expenseClaims.id, claims[0].id)))[0].status, "approved");
    await db.update(payrollEntries).set({ lineItems: originalLines }).where(eq(payrollEntries.id, taxed!.id));
    // Disabling the gate cannot reinterpret taxable or partially approved A4 data.
    process.env.SPEND_PAYROLL_REIMBURSEMENTS_ENABLED = "false";
    await assert.rejects(settlePayrollRun(run.id), /Reviewed reimbursements are paused/);
    process.env.SPEND_PAYROLL_REIMBURSEMENTS_ENABLED = "true";
    const competing = await Promise.allSettled([settlePayrollRun(run.id), settlePayrollRun(run.id)]);
    assert.equal(competing.filter(result => result.status === "fulfilled").length, 1);
    for (const claim of claims) {
      const [paid] = await db.select().from(expenseClaims).where(eq(expenseClaims.id, claim.id));
      assert.equal(paid.status, "paid"); assert.equal(paid.payrollRunId, run.id);
    }
    await db.update(payrollRuns).set({ status: "Releasing" }).where(eq(payrollRuns.id, laterRun.id));
    await assert.rejects(settlePayrollRun(laterRun.id), /paid_elsewhere|already settled/);
    const [later] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, laterRun.id));
    assert.equal(later.status, "Releasing", "Losing cutoff did not release any reimbursement");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    if (reviewerId !== null) await db.delete(users).where(eq(users.id, reviewerId));
    if (prior === undefined) delete process.env.SPEND_PAYROLL_REIMBURSEMENTS_ENABLED;
    else process.env.SPEND_PAYROLL_REIMBURSEMENTS_ENABLED = prior;
    await fixture.close();
  }
});
