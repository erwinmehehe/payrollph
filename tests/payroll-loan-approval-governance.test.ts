import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employeeLoans, employees, organizations, users } from "../src/db/schema";
import {
  activeLoanPayrollConflict, independentLoanReviewer,
  loanApprovalReference, moneyFromCents, parseLoanCents, validLoanDate,
} from "../src/lib/payroll-loan-approval";

test("loan amounts must be centavo-exact, positive and within database precision", () => {
  const valid: Array<[unknown, number]> = [
    ["0.01", 1], ["100", 10000], ["100.00", 10000],
    [100.25, 10025], ["9999999999.99", 999999999999],
  ];
  for (const [input, cents] of valid) {
    assert.equal(parseLoanCents(input), cents, String(input));
    assert.equal(moneyFromCents(cents), (cents / 100).toFixed(2));
  }
  for (const input of [0, "0", "-1", -0.01, "2.003", "₱100", "1,000", "1e3", "Infinity", "01", "99999999999.99", Number.NaN, null]) {
    assert.equal(parseLoanCents(input), null, String(input));
  }
  assert.equal(parseLoanCents("100.00", 9_999), null);
  assert.throws(() => moneyFromCents(-1), /Expected/);
  assert.throws(() => moneyFromCents(1.2), /Expected/);
});

test("Gregorian start/end dates and evidence references are not guessed", () => {
  assert.equal(validLoanDate("2024-02-29"), true);
  assert.equal(validLoanDate("2026-02-30"), false);
  assert.equal(validLoanDate("2026-13-01"), false);
  assert.equal(validLoanDate("01/01/2026"), false);
  assert.equal(loanApprovalReference(" Source-Contract-123 "), "Source-Contract-123");
  assert.equal(loanApprovalReference("short"), null);
  assert.equal(loanApprovalReference(123456789), null);
});

test("a maker cannot activate or re-activate their own payroll deduction", () => {
  assert.equal(independentLoanReviewer(null, 3), "LOAN_REQUESTER_UNKNOWN");
  assert.equal(independentLoanReviewer(3, 3), "LOAN_SELF_APPROVAL");
  assert.equal(independentLoanReviewer(3, 4), null);
});

test("activation is blocked by processing payroll, never by already Released history", () => {
  const run = {
    periodEnd: "2026-10-31",
    status: "Draft",
    employeeCount: 0,
    processedChunks: 0,
    scopeOrgUnitId: null,
  };
  assert.equal(activeLoanPayrollConflict([run], "2026-10-01", null), null);
  assert.ok(activeLoanPayrollConflict([{ ...run, status: "Queued" }], "2026-10-01", null));
  assert.ok(activeLoanPayrollConflict([{ ...run, employeeCount: 1 }], "2026-10-01", null));
  assert.ok(activeLoanPayrollConflict([{ ...run, processedChunks: 1 }], "2026-10-01", null));
  assert.equal(activeLoanPayrollConflict([{ ...run, status: "Released" }], "2026-10-01", null), null);
  assert.equal(activeLoanPayrollConflict([{ ...run, status: "Processing" }], "2026-11-01", null), null);
  assert.equal(activeLoanPayrollConflict([{ ...run, scopeOrgUnitId: 9, status: "Processing" }], "2026-10-01", 8), null);
});

test("database defaults new loans to non-deducting pending status and enforces separate reviewer", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Loan authorization test",
    legalName: "Loan authorization test",
    plan: "Core",
  }).returning();
  const [maker, checker] = await db.insert(users).values([
    { email: `loan-maker-${randomUUID()}@example.invalid`, name: "Loan Maker", passwordHash: "test-only" },
    { email: `loan-checker-${randomUUID()}@example.invalid`, name: "Loan Checker", passwordHash: "test-only" },
  ]).returning();
  try {
    const [worker] = await db.insert(employees).values({
      organizationId: org.id, employeeNo: "LOAN-QA-1", firstName: "Ada",
      lastName: "Reyes", title: "Clerk", avatarInitials: "AR",
      basicRate: "21000.00", startDate: "2026-01-01",
    }).returning();
    const [requested] = await db.insert(employeeLoans).values({
      organizationId: org.id, employeeId: worker.id,
      loanType: "Company Emergency Loan",
      referenceNo: "AGREEMENT-2026-1001",
      principal: "12000.00",
      monthlyAmortization: "1000.00",
      cutoffDeduction: "500.00",
      remainingBalance: "12000.00",
      totalPaid: "0.00",
      startDate: "2026-10-15",
      requestedByUserId: maker.id,
      deductionAuthorizationReference: "SIGNED-AUTHORIZATION-REF-1001",
    }).returning();
    assert.equal(requested.status, "pending_approval");
    assert.equal(requested.reviewedByUserId, null);
    // DB constraint prevents even a raw SQL/app writer from activating this
    // newly requested deduction without an independent reviewer ID.
    await assert.rejects(() => db.update(employeeLoans).set({ status: "active" })
      .where(eq(employeeLoans.id, requested.id)));
    await assert.rejects(() => db.update(employeeLoans).set({
      status: "active", reviewedByUserId: maker.id,
    }).where(eq(employeeLoans.id, requested.id)));
    await assert.rejects(() => db.update(employeeLoans).set({
      status: "active", reviewedByUserId: checker.id, reviewedAt: new Date(),
    }).where(eq(employeeLoans.id, requested.id)), "Reviewed source reference is mandatory");
    const [unchanged] = await db.select().from(employeeLoans).where(eq(employeeLoans.id, requested.id));
    assert.equal(unchanged.status, "pending_approval");
    assert.equal(unchanged.remainingBalance, "12000.00");

    const [approved] = await db.update(employeeLoans).set({
      status: "active",
      reviewedByUserId: checker.id,
      reviewedAt: new Date(),
      reviewEvidenceReference: "CHECKER-REVIEW-REF-1001",
    }).where(eq(employeeLoans.id, requested.id)).returning();
    assert.equal(approved.status, "active");
    assert.equal(approved.requestedByUserId, maker.id);
    assert.equal(approved.reviewedByUserId, checker.id);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    await db.delete(users).where(eq(users.id, maker.id));
    await db.delete(users).where(eq(users.id, checker.id));
  }
});

test("new loan request cannot bypass authorization and approval UI does not promise automatic activation", () => {
  const route = readFileSync("src/app/api/loans/route.ts", "utf8");
  const ui = readFileSync("src/components/loans-panel.tsx", "utf8");
  const payrollEngine = readFileSync("src/lib/payroll-engine.ts", "utf8");
  assert.ok(route.includes('status: "pending_approval"'));
  assert.ok(route.includes("deductionAuthorizationReference: authorization"));
  assert.ok(route.includes('action: "loan-deduction-request"'));
  assert.ok(route.includes("PAYROLL_TAX_APPROVER_ROLES"));
  assert.ok(route.includes("independentLoanReviewer(fresh.requestedByUserId, user.id)"));
  assert.ok(route.includes("requireSensitiveActionMfa(user)"));
  assert.ok(route.includes("!access?.companyWide"));
  assert.ok(route.includes("pg_advisory_xact_lock(4304"));
  assert.ok(route.includes("activeLoanPayrollConflict(cutoffRows"));
  assert.ok(route.includes('process.env.PAYROLL_LOAN_DEDUCTION_ACTIVATION_ENABLED !== "true"'));
  assert.ok(route.includes('"LOAN_DEDUCTION_ACTIVATION_NOT_CERTIFIED"'));
  assert.ok(ui.includes("Deduction activation disabled."));
  assert.ok(route.includes("FOR UPDATE"));
  assert.ok(ui.includes("Submit for Review — No Deduction Yet"));
  assert.ok(ui.includes("Approve &amp; Activate"));
  assert.ok(payrollEngine.includes('eq(employeeLoans.status, "active")'));
});

test("verified external payments are never a free-text default or a partial unlogged balance edit", () => {
  const route = readFileSync("src/app/api/loans/route.ts", "utf8");
  const ui = readFileSync("src/components/loans-panel.tsx", "utf8");
  assert.ok(route.includes('action === "record_payment"'));
  assert.ok(route.includes("paymentRef.length < 8"));
  assert.ok(route.includes("LOAN_PAYMENT_EXCEEDS_BALANCE"));
  assert.ok(route.includes("LOAN_CLOSE_REQUIRES_ZERO_BALANCE"));
  assert.ok(route.includes("tx.insert(loanPayments)"));
  assert.ok(route.includes("tx.update(employeeLoans)"));
  assert.ok(route.includes("tx.insert(auditEvents)"));
  assert.ok(route.includes("db.transaction(async tx"));
  assert.ok(!ui.includes('reference: "Direct Employee Remittance"'));
  assert.ok(ui.includes("manualPaymentReference.trim()"));
});

test("migration and Drizzle schema preserve historical active rows and enforce approval on new requests", () => {
  const sqlMigration = readFileSync("drizzle/0100_independent_employee_loan_deductions.sql", "utf8");
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const baseline = readFileSync("drizzle/baseline.sql", "utf8");
  assert.ok(sqlMigration.includes("ALTER COLUMN \"status\" SET DEFAULT 'pending_approval'"));
  assert.ok(sqlMigration.includes("employee_loans_independent_deduction_check"));
  assert.ok(schema.includes('default("pending_approval")'));
  assert.ok(schema.includes('check("employee_loans_independent_deduction_check"'));
  assert.ok(!baseline.includes("employee_loans_independent_deduction_check"), "Immutable historical baseline is not rewritten");
});
