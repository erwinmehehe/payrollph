import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { spendIsolatedDatabase, waitForSpendLockWaiters } from "./helpers/spend-isolated-database";
import { encryptBankAccount } from "../src/lib/bank-account-crypto";
import { storedMoneyCentavos } from "../src/lib/stored-money-centavos";
import {
  employees, employeePayProfiles, expenseCategoryPolicies, expenseClaimEvidence, expenseClaims,
  organizations, payrollEntries, payrollRuns, users,
} from "../src/db/schema";

const cents = (amount: unknown): number => {
  const parsed = storedMoneyCentavos(amount);
  assert.notEqual(parsed, null, "Payroll and reimbursement ledger money must be exact centavos");
  return parsed!;
};

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
  const originalFetch = globalThis.fetch;
  const storageKeys = ["DOCUMENT_OBJECT_STORAGE_ENDPOINT", "DOCUMENT_OBJECT_STORAGE_BUCKET",
    "DOCUMENT_OBJECT_STORAGE_REGION", "DOCUMENT_OBJECT_STORAGE_ACCESS_KEY_ID",
    "DOCUMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY"] as const;
  const previousStorage = storageKeys.map(key => process.env[key]);
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
    const receiptBytes = staff.map((_employee, i) => Buffer.from("%PDF-1." + (i + 1)));
    const receiptHashes = receiptBytes.map(bytes => createHash("sha256").update(bytes).digest("hex"));
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
      receiptSha256: receiptHashes[i], receiptByteSize: receiptBytes[i].length, receiptVerifiedAt: new Date(),
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
    const [calculatedRun] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));
    assert.ok(calculatedRun);
    assert.equal(cents(calculatedRun.grossPay), entries.reduce((sum, row) => sum + cents(row.grossPay), 0),
      "Employer payroll gross must reconcile to the sum of employee registers");
    assert.equal(cents(calculatedRun.netPay), entries.reduce((sum, row) => sum + cents(row.netPay), 0),
      "Employer payroll net must reconcile to the sum of employee registers");
    const byId = new Map(entries.map(row => [row.employeeId, row]));
    const taxed = byId.get(staff[0].id);
    const exempt = byId.get(staff[1].id);
    assert.ok(taxed && exempt);
    const toLines = (entry: typeof payrollEntries.$inferSelect) => entry.lineItems as Array<{
      code: string; amount: string; notes?: string[];
    }>;
    const approvalRows = await db.select().from(expenseClaimEvidence);
    const approvedByClaimId = new Map(approvalRows.map(row => [row.claimId, row]));
    const submittedByClaimId = new Map(claims.map(claim => [claim.id, claim]));
    let registerReimbursementCents = 0;
    let approvedReimbursementCents = 0;
    for (const employee of staff) {
      const entry = byId.get(employee.id);
      assert.ok(entry, "Every worker must have exactly one calculated entry");
      const claim = claims.find(item => item.employeeId === employee.id);
      assert.ok(claim, "Every reimbursement must map to a worker in the run");
      const evidence = approvedByClaimId.get(claim.id);
      assert.ok(evidence?.approvedAmount, "Reviewed expense must have an approved amount");
      assert.equal(submittedByClaimId.get(claim.id)?.employeeId, entry.employeeId);
      const paymentLines = toLines(entry).filter(line => line.code === "EXP-" + claim.id);
      assert.equal(paymentLines.length, 1, "One and only one payment line per approved claim");
      const approved = cents(evidence.approvedAmount);
      const paid = cents(paymentLines[0].amount);
      assert.ok(approved > 0 && approved <= cents(claim.amount),
        "Approved cents cannot exceed the submitted claim");
      assert.equal(paid, approved, "Payroll line must be exactly the approved centavos");
      approvedReimbursementCents += approved;
      registerReimbursementCents += paid;
    }
    assert.equal(registerReimbursementCents, approvedReimbursementCents,
      "All payroll reimbursement amounts match the approved employer ledger, centavo for centavo");
    assert.equal(approvedReimbursementCents, 4_090_002,
      "Two PHP 450.01 partial approvals and two PHP 20,000 full approvals total PHP 40,900.02");
    const taxableLine = toLines(taxed!).find(line => line.code === "EXP-" + claims[0].id);
    const exemptLine = toLines(exempt!).find(line => line.code === "EXP-" + claims[1].id);
    assert.equal(Number(taxableLine?.amount), 450.01);
    assert.equal(Number(exemptLine?.amount), 450.01);
    assert.ok(taxableLine?.notes?.includes("Taxable reimbursement"));
    assert.ok(exemptLine?.notes?.includes("Non-taxable reimbursement"));
    assert.equal(Number(taxed!.grossPay), Number(exempt!.grossPay));
    const whtCents = (entry: typeof payrollEntries.$inferSelect) =>
      cents(toLines(entry).find(line => line.code === "WHT")?.amount ?? "0.00");
    for (const deduction of ["SSS", "PHIC", "HDMF", "HDMF_VOL"]) {
      const amount = (entry: typeof payrollEntries.$inferSelect) =>
        cents(toLines(entry).find(line => line.code === deduction)?.amount ?? "0.00");
      assert.equal(amount(taxed!), amount(exempt!),
        "Tax classification must not unexpectedly change statutory contribution " + deduction);
    }
    assert.equal(cents(taxed!.netPay) - cents(exempt!.netPay), whtCents(taxed!) - whtCents(exempt!),
      "Ordinary-worker net pay difference must equal only the withholding difference");

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
    assert.equal(cents(mweTaxed.grossPay), cents(mweExempt.grossPay),
      "MWE tax review does not alter the gross approved reimbursement");
    assert.equal(cents(mweTaxed.netPay) - cents(mweExempt.netPay),
      whtCents(mweTaxed) - whtCents(mweExempt),
      "MWE net pay difference must equal only the withholding difference");
    for (const base of ["statutoryMonthlySssCompensation", "statutoryMonthlyPagIbigCompensation"]) {
      assert.equal(readTrace(mweTaxed.trace, base), readTrace(mweExempt.trace, base));
    }
    Object.assign(process.env, {
      DOCUMENT_OBJECT_STORAGE_ENDPOINT: "https://objects.example.invalid",
      DOCUMENT_OBJECT_STORAGE_BUCKET: "reimbursements-synthetic",
      DOCUMENT_OBJECT_STORAGE_REGION: "us-east-1",
      DOCUMENT_OBJECT_STORAGE_ACCESS_KEY_ID: "synthetic",
      DOCUMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY: "synthetic-never-production",
    });
    let tamperedReceipt: number | null = null;
    let missingReceipt: number | null = null;
    let unsafeProviderError = false;
    globalThis.fetch = async (url, options) => {
      assert.equal(options?.method, "GET", "Only private signed receipt reads are permitted");
      assert.equal(options?.redirect, "error");
      const uri = new URL(String(url));
      assert.equal(uri.hostname, "objects.example.invalid");
      const name = uri.pathname.split("/").at(-1) ?? "";
      const index = Number(name.slice(-1)) - 1;
      assert.ok(index >= 0 && index < receiptBytes.length, "Signed receipt identity is known");
      if (unsafeProviderError) throw new Error("Synthetic provider failed at https://objects.example.invalid/?signature=synthetic-private-signature");
      if (missingReceipt === index) return new Response("Synthetic missing receipt", { status: 404 });
      return new Response(new Uint8Array(tamperedReceipt === index ? Buffer.from("%PDF-1.9") : receiptBytes[index]));
    };
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
    const mutatedLine = (mutate: (line: Record<string, unknown>) => Record<string, unknown>) =>
      originalLines.map(item => item && typeof item === "object" &&
        (item as { code?: string }).code === taxableLine?.code
        ? mutate(item as Record<string, unknown>) : item);
    await db.update(payrollEntries).set({ lineItems: mutatedLine(line => ({
      ...line, amount: "450.02",
    })) }).where(eq(payrollEntries.id, taxed!.id));
    await assert.rejects(settlePayrollRun(run.id), /amount_changed/);
    await db.update(payrollEntries).set({ lineItems: mutatedLine(line => ({
      ...line, notes: [...(line.notes as string[]), "Tax treatment: non-taxable"],
    })) }).where(eq(payrollEntries.id, taxed!.id));
    await assert.rejects(settlePayrollRun(run.id), /different taxable policy/);
    await db.update(payrollEntries).set({ lineItems: originalLines }).where(eq(payrollEntries.id, taxed!.id));
    tamperedReceipt = 0;
    await assert.rejects(settlePayrollRun(run.id), /RECEIPT_RELEASE_VERIFICATION_FAILED.*RECEIPT_HASH_MISMATCH/);
    assert.equal((await db.select().from(expenseClaims).where(eq(expenseClaims.id, claims[0].id)))[0].status, "approved");
    tamperedReceipt = null;
    missingReceipt = 1;
    await assert.rejects(settlePayrollRun(run.id), /RECEIPT_RELEASE_VERIFICATION_FAILED.*RECEIPT_READ_UNAVAILABLE/);
    missingReceipt = null;
    unsafeProviderError = true;
    await assert.rejects(settlePayrollRun(run.id), (error: unknown) => error instanceof Error &&
      error.message.includes("RECEIPT_RELEASE_VERIFICATION_FAILED") && !error.message.includes("synthetic-private-signature"));
    unsafeProviderError = false;
    const [lateClaim] = await db.insert(expenseClaims).values({
      organizationId: org.id, employeeId: staff[0].id,
      submittedByUserId: maker.id, category: policies[0].category,
      description: "Approved after register calculation", amount: "1.01",
      incurredOn: "2026-09-08", status: "approved",
    }).returning();
    await db.insert(expenseClaimEvidence).values({
      claimId: lateClaim.id, organizationId: org.id, employeeId: staff[0].id,
      categoryPolicyId: policies[0].id, taxable: true,
      approvedAmount: "1.01", approvedByUserId: reviewer.id, approvedAt: new Date(),
      receiptStorageKey: "private-documents/" + org.id + "/" + staff[0].id +
        "/00000000-0000-4000-8000-000000000005",
      receiptSha256: createHash("sha256").update("%PDF-late").digest("hex"),
      receiptByteSize: 9, receiptVerifiedAt: new Date(),
    });
    await assert.rejects(settlePayrollRun(run.id), /Newly approved reimbursement .* missing from the payroll register/);
    assert.equal((await db.select().from(expenseClaims).where(eq(expenseClaims.id, claims[0].id)))[0].status, "approved",
      "A missing reimbursement must roll back every other reimbursement");
    await db.delete(expenseClaims).where(eq(expenseClaims.id, lateClaim.id));
    // Disabling the gate cannot reinterpret taxable or partially approved A4 data.
    process.env.SPEND_PAYROLL_REIMBURSEMENTS_ENABLED = "false";
    await assert.rejects(settlePayrollRun(run.id), /Reviewed reimbursements are paused/);
    process.env.SPEND_PAYROLL_REIMBURSEMENTS_ENABLED = "true";
    const { lockReviewedSpendOrganization } = await import("../src/lib/spend-claim-evidence");
    const holder = await fixture.pool.connect();
    let competing: PromiseSettledResult<Awaited<ReturnType<typeof settlePayrollRun>>>[];
    try {
      await holder.query("BEGIN"); await lockReviewedSpendOrganization(drizzle(holder), org.id);
      const waiting = Promise.allSettled([settlePayrollRun(run.id), settlePayrollRun(run.id)]);
      await waitForSpendLockWaiters(fixture, 2);
      assert.equal((await db.select().from(expenseClaims).where(eq(expenseClaims.id, claims[0].id)))[0].status, "approved");
      await holder.query("COMMIT"); competing = await waiting;
    } finally { await holder.query("ROLLBACK"); holder.release(); }
    assert.equal(competing.filter(result => result.status === "fulfilled").length, 1);
    let settledApprovedCents = 0;
    for (const claim of claims) {
      const [paid] = await db.select().from(expenseClaims).where(eq(expenseClaims.id, claim.id));
      assert.equal(paid.status, "paid"); assert.equal(paid.payrollRunId, run.id);
      settledApprovedCents += cents(approvedByClaimId.get(claim.id)?.approvedAmount);
    }
    assert.equal(settledApprovedCents, registerReimbursementCents,
      "Every settled claim corresponds to exactly one approved payslip reimbursement");
    const [releasedRun] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));
    assert.equal(releasedRun.status, "Released");
    assert.equal(cents(releasedRun.netPay), cents(calculatedRun.netPay),
      "Releasing the ledger cannot change calculated take-home pay");
    assert.equal(cents(releasedRun.grossPay), cents(calculatedRun.grossPay),
      "Releasing the ledger cannot change calculated gross pay");
    await db.update(payrollRuns).set({ status: "Releasing" }).where(eq(payrollRuns.id, laterRun.id));
    await assert.rejects(settlePayrollRun(laterRun.id), /paid_elsewhere|already settled/);
    const [later] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, laterRun.id));
    assert.equal(later.status, "Releasing", "Losing cutoff did not release any reimbursement");
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    if (reviewerId !== null) await db.delete(users).where(eq(users.id, reviewerId));
    if (prior === undefined) delete process.env.SPEND_PAYROLL_REIMBURSEMENTS_ENABLED;
    else process.env.SPEND_PAYROLL_REIMBURSEMENTS_ENABLED = prior;
    globalThis.fetch = originalFetch;
    storageKeys.forEach((key, i) => {
      if (previousStorage[i] === undefined) delete process.env[key];
      else process.env[key] = previousStorage[i];
    });
    await fixture.close();
  }
});
