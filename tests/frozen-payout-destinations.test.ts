import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employees, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import {
  assertReleasedPayoutTotals, frozenReleasedPayrollPayment,
} from "../src/lib/payroll-payout-snapshot";
import { loadPayrollPayoutRows } from "../src/lib/paymongo-disbursements";

const current = {
  employeeNo: "E-007",
  bankAccount: "1234567890",
  bankCode: "BDO",
  mobile: "09123456789",
};
const trace = { payment: {
  employeeNo: "E-007", employeeName: "Released Recipient",
  bankAccount: "1234567890", bankCode: "BDO", mobile: "09123456789",
}};
test("frozen payout evidence is mandatory and detects account, bank and mobile changes", () => {
  assert.deepEqual(frozenReleasedPayrollPayment({ entryId: 9, trace, current }), trace.payment);
  assert.throws(
    () => frozenReleasedPayrollPayment({ entryId: 9, trace: {}, current }),
    /PAYOUT_FROZEN_DESTINATION_REQUIRED/,
  );
  for (const change of [
    { bankAccount: "9876543210" },
    { bankCode: "BPI" },
    { mobile: "09999999999" },
    { employeeNo: "E-008" },
  ]) {
    assert.throws(() => frozenReleasedPayrollPayment({
      entryId: 9, trace, current: { ...current, ...change },
    }), /PAYOUT_DESTINATION_CHANGED_AFTER_CALCULATION/);
  }
  const caseOnlyBankName = frozenReleasedPayrollPayment({
    entryId: 9, trace, current: { ...current, bankCode: " bdo " },
  });
  assert.equal(caseOnlyBankName.employeeNo, "E-007");
});

test("released payroll amount and register count must reconcile exactly", () => {
  assert.doesNotThrow(() => assertReleasedPayoutTotals({
    expectedEmployeeCount: 2, expectedNetPay: "100.25", amountsCents: [3000, 7025],
  }));
  assert.throws(() => assertReleasedPayoutTotals({
    expectedEmployeeCount: 2, expectedNetPay: "100.25", amountsCents: [3000],
  }), /PAYOUT_REGISTER_RECONCILIATION_FAILED/);
  assert.throws(() => assertReleasedPayoutTotals({
    expectedEmployeeCount: 2, expectedNetPay: "100.25", amountsCents: [3000, 7026],
  }), /PAYOUT_REGISTER_RECONCILIATION_FAILED/);
  assert.throws(() => assertReleasedPayoutTotals({
    expectedEmployeeCount: 1, expectedNetPay: "100.251", amountsCents: [10025],
  }), /PAYOUT_REGISTER_RECONCILIATION_FAILED/);
});

test("PayMongo rows use released frozen destination, block changed master data and never contact provider", async () => {
  const [org] = await db.insert(organizations).values({
    name: "Frozen payout QA", legalName: "Frozen payout QA",
  }).returning();
  try {
    const [worker] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "PAYOUT-007",
      firstName: "Safe", lastName: "Worker",
      avatarInitials: "SW", title: "Staff", startDate: "2026-01-01",
      basicRate: "28000.00", bankAccount: "1234567890", bankCode: "BDO",
    }).returning();
    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id, periodLabel: "Oct 2026 frozen payout",
      periodStart: "2026-10-01", periodEnd: "2026-10-15",
      payDate: "2026-10-15", status: "Released", employeeCount: 1,
      grossPay: "14000.00", netPay: "12500.00",
    }).returning();
    const [entry] = await db.insert(payrollEntries).values({
      payrollRunId: run.id, employeeId: worker.id,
      grossPay: "14000.00", deductions: "1500.00", netPay: "12500.00",
      trace: { payment: {
        employeeNo: "PAYOUT-007", employeeName: "Safe Worker",
        bankAccount: "1234567890", bankCode: "BDO", mobile: null,
      }},
    }).returning();

    const frozen = await loadPayrollPayoutRows(run.id);
    assert.equal(frozen.length, 1);
    assert.equal(frozen[0].accountNumber, "1234567890");
    assert.equal(frozen[0].amountCents, 1_250_000);

    await db.update(employees).set({ bankAccount: "9999000011" }).where(eq(employees.id, worker.id));
    await assert.rejects(() => loadPayrollPayoutRows(run.id), /PAYOUT_DESTINATION_CHANGED_AFTER_CALCULATION/);

    await db.update(employees).set({ bankAccount: "1234567890" }).where(eq(employees.id, worker.id));
    await db.update(payrollEntries).set({ netPay: "12500.01" }).where(eq(payrollEntries.id, entry.id));
    await assert.rejects(() => loadPayrollPayoutRows(run.id), /PAYOUT_REGISTER_RECONCILIATION_FAILED/);

    await db.update(payrollEntries).set({ netPay: "12500.00", trace: {} }).where(eq(payrollEntries.id, entry.id));
    await assert.rejects(() => loadPayrollPayoutRows(run.id), /PAYOUT_FROZEN_DESTINATION_REQUIRED/);

    await db.update(payrollRuns).set({ status: "Draft" }).where(eq(payrollRuns.id, run.id));
    await assert.rejects(() => loadPayrollPayoutRows(run.id), /PAYOUT_RELEASE_REQUIRED/);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
