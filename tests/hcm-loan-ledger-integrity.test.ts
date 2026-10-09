import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { auditEvents, employeeLoans, employees, loanPayments, organizations } from "../src/db/schema";
import {
  SUPPORTED_LOAN_TYPES, MAX_LOAN_PRINCIPAL_CENTS, MAX_PAYMENT_CENTS,
  isoCalendarDate, nextLoanState, pesoString, phpCents,
  validManualRepayment, validateLoanRegistration, validPayrollLoanSchedule,
} from "../src/lib/loan-ledger-guards";

function sampleRegistration(override: Record<string, unknown> = {}) {
  return {
    loanType: "SSS Salary Loan",
    referenceNo: "SSS-LOAN-2026-001",
    authorizationEvidenceReference: "SSS-LETTER-2026-001",
    principal: "24000.00",
    monthlyAmortization: "2000.00",
    cutoffDeduction: "1000.00",
    startDate: "2026-10-15",
    endDate: "2027-10-15",
    notes: "Confirmed by employer",
    ...override,
  };
}

test("loan amount parser only accepts exact positive PHP precision within database limits", () => {
  assert.equal(phpCents("1.01"), 101);
  assert.equal(phpCents(20), 2000);
  assert.equal(phpCents("0.00"), 0);
  assert.equal(phpCents("9999999999.99", MAX_LOAN_PRINCIPAL_CENTS), MAX_LOAN_PRINCIPAL_CENTS);
  assert.equal(phpCents("99999999.99", MAX_PAYMENT_CENTS), MAX_PAYMENT_CENTS);
  for (const v of ["1.234", "-5", "NaN", "1e3", "Infinity", "01.00", "10,000.00", "", null, Number.NaN, 1.234]) {
    assert.equal(phpCents(v), null, String(v));
  }
  assert.equal(phpCents("100000000.00", MAX_PAYMENT_CENTS), null);
  assert.equal(phpCents("10000000000.00", MAX_LOAN_PRINCIPAL_CENTS), null);
  assert.equal(pesoString(1001), "10.01");
  assert.throws(() => pesoString(-100));
});

test("loan types never permit arbitrary wage recovery disguised as a loan", () => {
  assert.equal(SUPPORTED_LOAN_TYPES.length, 7);
  const valid = validateLoanRegistration(sampleRegistration());
  assert.ok(valid.ok);
  if (valid.ok) {
    assert.equal(valid.value.principalCents, 2400000);
    assert.equal(valid.value.cutoffCents, 100000);
    assert.equal(valid.value.authorizationEvidenceReference, "SSS-LETTER-2026-001");
  }
  for (const unsafe of ["Payroll Overpayment Recovery", "Salary Clawback", "Custom Deduction", ""]) {
    const parsed = validateLoanRegistration(sampleRegistration({ loanType: unsafe }));
    assert.equal(parsed.ok, false, unsafe);
    if (!parsed.ok) assert.equal(parsed.code, "LOAN_TYPE_UNSUPPORTED");
  }
});

test("registration requires an independently traceable employee authorization reference", () => {
  const valid = validateLoanRegistration(sampleRegistration({ authorizationEvidenceReference: "SIGNED-CONSENT-2001" }));
  assert.equal(valid.ok, true);
  for (const evidenceReference of ["", "short", "X".repeat(201), "ACCEPTED\nspoof"]) {
    const parsed = validateLoanRegistration(sampleRegistration({ authorizationEvidenceReference: evidenceReference }));
    assert.equal(parsed.ok, false, evidenceReference);
    if (!parsed.ok) assert.equal(parsed.code, "LOAN_AUTHORIZATION_EVIDENCE_REQUIRED");
  }
  const missing = validateLoanRegistration(sampleRegistration({ referenceNo: "bad" }));
  assert.equal(missing.ok, false);
});

test("loan amortization must be positive, centavo-exact, and cannot exceed principal or monthly pay", () => {
  for (const override of [
    { principal: "0" }, { principal: "-1" }, { principal: "1000.001" },
    { monthlyAmortization: "0" }, { monthlyAmortization: "25000.00" },
    { cutoffDeduction: "0" }, { cutoffDeduction: "-50" },
    { cutoffDeduction: "2500.00" }, { cutoffDeduction: "1000.005" },
  ]) {
    const parsed = validateLoanRegistration(sampleRegistration(override));
    assert.equal(parsed.ok, false, JSON.stringify(override));
    if (!parsed.ok) assert.equal(parsed.code, "LOAN_AMORTIZATION_INVALID");
  }
  const computed = validateLoanRegistration(sampleRegistration({
    principal: "24000", monthlyAmortization: "1041.67",
    cutoffDeduction: undefined,
  }));
  assert.ok(computed.ok);
  if (computed.ok) assert.equal(computed.value.cutoffCents, 52084);
});

test("loan dates must be real Gregorian dates and end after the start", () => {
  assert.equal(isoCalendarDate("2024-02-29"), true);
  assert.equal(isoCalendarDate("2026-02-30"), false);
  for (const dates of [
    { startDate: "" }, { startDate: "2026-02-30" }, { startDate: "2026-13-01" },
    { startDate: "10/09/2026" }, { endDate: "2026-10-14" }, { endDate: "2027-02-29" },
  ]) {
    const parsed = validateLoanRegistration(sampleRegistration(dates));
    assert.equal(parsed.ok, false, JSON.stringify(dates));
    if (!parsed.ok) assert.equal(parsed.code, "LOAN_DATES_INVALID");
  }
});

test("malformed legacy loan schedules cannot reach net pay or loan settlement", () => {
  assert.equal(validPayrollLoanSchedule({ cutoffDeduction: 1000, remainingBalance: 2000 }), true);
  for (const loan of [
    { cutoffDeduction: -100, remainingBalance: 2000 },
    { cutoffDeduction: 0, remainingBalance: 2000 },
    { cutoffDeduction: Number.NaN, remainingBalance: 2000 },
    { cutoffDeduction: Number.POSITIVE_INFINITY, remainingBalance: 2000 },
    { cutoffDeduction: 100.001, remainingBalance: 2000 },
    { cutoffDeduction: 100, remainingBalance: -1 },
    { cutoffDeduction: 100, remainingBalance: 0 },
    { cutoffDeduction: 100, remainingBalance: Number.NaN },
  ]) assert.equal(validPayrollLoanSchedule(loan), false, JSON.stringify(loan));
  const engine = readFileSync("src/lib/payroll-engine.ts", "utf8");
  assert.ok(engine.includes("validPayrollLoanSchedule(loan)"));
  assert.ok(engine.includes("No loan deduction applied; pause and reconcile"));
});

test("manual loan repayment requires independent unique receipt evidence", () => {
  const ok = validManualRepayment("250.75", "BANK-TRANSACTION-298");
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.amountCents, 25075);
  for (const amount of ["-1", "0", "1.005", "100000000", "1e3"]) {
    const parsed = validManualRepayment(amount, "BANK-TRANSACTION-298");
    assert.equal(parsed.ok, false, String(amount));
  }
  assert.equal(validManualRepayment("250.75", "short").ok, false);
  assert.equal(validManualRepayment("250.75", "LINE\nINJECTED").ok, false);
});

test("pause/resume/close cannot erase outstanding loans or resume an exited worker", () => {
  assert.deepEqual(nextLoanState("pause", "active", 10000, "Active"), { ok: true, next: "paused" });
  assert.deepEqual(nextLoanState("resume", "paused", 10000, "Active"), { ok: true, next: "active" });
  assert.deepEqual(nextLoanState("resume", "paused", 10000, "On leave"), { ok: true, next: "active" });
  const closed = nextLoanState("close", "active", 10000, "Active");
  assert.equal(closed.ok, false);
  if (!closed.ok) assert.equal(closed.code, "LOAN_OUTSTANDING_CANNOT_CLOSE");
  assert.deepEqual(nextLoanState("close", "paused", 0, "Separated"), { ok: true, next: "paid_off" });
  assert.equal(nextLoanState("resume", "paused", 10000, "Separated").ok, false);
  assert.equal(nextLoanState("resume", "paid_off", 0, "Active").ok, false);
});

test("loan money mutations have company-wide payroll, MFA, atomic audit and row-lock guarantees", () => {
  const route = readFileSync("src/app/api/loans/route.ts", "utf8");
  const panel = readFileSync("src/components/loans-panel.tsx", "utf8");
  assert.ok(route.includes("PAYROLL_OPERATOR_ROLES"));
  assert.ok(route.includes("eq(employeeLoans.organizationId, employees.organizationId)"));
  assert.ok(route.includes("requestedEmployeeId != null"));
  assert.ok(route.includes("!access?.companyWide"));
  assert.ok(route.includes("requireSensitiveActionMfa(user)"));
  assert.ok(route.includes("enforceSensitiveActionRateLimit(request"));
  assert.ok(route.includes("pg_advisory_xact_lock(4532"));
  assert.ok(route.includes("for update"));
  assert.ok(route.includes("db.transaction(async tx"));
  assert.ok(route.includes("tx.insert(loanPayments)"));
  assert.ok(route.includes("tx.update(employeeLoans)"));
  assert.ok(route.includes("tx.insert(auditEvents)"));
  assert.ok(route.includes("LOAN_REPAYMENT_REFERENCE_DUPLICATE"));
  assert.ok(route.includes("LOAN_REFERENCE_ALREADY_REGISTERED"));
  assert.ok(route.includes("LOAN_OUTSTANDING_CANNOT_CLOSE") === false); // helper owns semantic policy
  assert.ok(panel.includes("authorizationEvidenceReference"));
  assert.ok(panel.includes("manualPaymentReference"));
  assert.ok(!route.includes("await recordAuditEvent("));
});

test("failed financial/audit transaction leaves loan balance and payment ledger unchanged", async () => {
  const suffix = randomUUID().slice(0, 8);
  const [org] = await db.insert(organizations).values({
    name: `Loan transaction QA ${suffix}`,
    legalName: `Loan transaction QA ${suffix}`, plan: "Core",
  }).returning();
  try {
    const [worker] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: `LOAN-TXN-${suffix}`,
      firstName: "Maria", lastName: "Santos", title: "Staff",
      avatarInitials: "MS", basicRate: "20000.00", startDate: "2025-01-01",
    }).returning();
    const [loan] = await db.insert(employeeLoans).values({
      organizationId: org.id,
      employeeId: worker.id,
      loanType: "SSS Salary Loan",
      referenceNo: `LOAN-REF-${suffix}`,
      principal: "12000.00",
      monthlyAmortization: "1000.00",
      cutoffDeduction: "500.00",
      remainingBalance: "12000.00",
      totalPaid: "0.00",
      startDate: "2026-01-01",
      status: "active",
    }).returning();

    await assert.rejects(() => db.transaction(async tx => {
      await tx.execute(sql`select id from employee_loans where id = ${loan.id} for update`);
      await tx.insert(loanPayments).values({
        loanId: loan.id, amount: "500.00", paymentDate: "2026-10-09",
        reference: "FAILED-AUDIT-RECEIPT",
      });
      await tx.update(employeeLoans).set({
        remainingBalance: "11500.00", totalPaid: "500.00",
      }).where(eq(employeeLoans.id, loan.id));
      // An audit-storage outage must invalidate the entire payment and
      // balance update, not leave half-posted ledger money.
      await tx.execute(sql`
        insert into audit_events (organization_id, actor, action, resource)
        values (${org.id}, NULL, 'Loan balance updated', 'QA')
      `);
    }));

    const [fresh] = await db.select().from(employeeLoans).where(eq(employeeLoans.id, loan.id));
    assert.equal(fresh.remainingBalance, "12000.00");
    assert.equal(fresh.totalPaid, "0.00");
    const pending = await db.select().from(loanPayments)
      .where(and(eq(loanPayments.loanId, loan.id), eq(loanPayments.reference, "FAILED-AUDIT-RECEIPT")));
    assert.equal(pending.length, 0);
    // No audit rows should have been created either.
    const audits = await db.select().from(auditEvents)
      .where(and(eq(auditEvents.organizationId, org.id), eq(auditEvents.action, "Loan balance updated")));
    assert.equal(audits.length, 0);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
