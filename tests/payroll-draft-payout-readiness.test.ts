import test from "node:test";
import assert from "node:assert/strict";
import { payrollDraftPayoutReadiness } from "../src/lib/payroll-draft-payout-readiness";
import { evaluatePayrollAssurance } from "../src/lib/payroll-assurance";

const incomplete = [{ id: 10, bankAccount: null, bankCode: null, mobile: null }];
test("missing payout remains blocked unless draft deferral is explicitly enabled", () => {
  for (const value of [undefined, "", "false", "TRUE", "1"]) {
    const result = payrollDraftPayoutReadiness(incomplete, { PAYROLL_DRAFT_PAYOUT_DEFERRAL_ENABLED: value });
    assert.equal(result.allowed, false);
    assert.equal(result.deferred, false);
    assert.deepEqual(result.missingEmployeeIds, [10]);
    assert.equal(result.message, "1 active employee is missing a usable bank account or mobile-wallet destination. Complete payout details before starting payroll.");
  }
});
test("deferral permits calculation and reports only the supplied incomplete cohort", () => {
  const result = payrollDraftPayoutReadiness([
    ...incomplete, { id: 11, bankAccount: "synthetic-encrypted", bankCode: "BPI" },
    { id: 12, mobile: "synthetic-wallet" }, { id: 13, bankAccount: " ", bankCode: "BPI", mobile: " " },
  ], { PAYROLL_DRAFT_PAYOUT_DEFERRAL_ENABLED: "true" });
  assert.equal(result.allowed, true);
  assert.equal(result.deferred, true);
  assert.deepEqual(result.missingEmployeeIds, [10, 13]);
  assert.match(result.message!, /before review or release/);
});
test("complete payout retains the legacy path even with deferral enabled", () => {
  for (const value of [undefined, "true"]) {
    assert.deepEqual(payrollDraftPayoutReadiness([{ id: 10, bankAccount: "synthetic", bankCode: "BPI" }], {
      PAYROLL_DRAFT_PAYOUT_DEFERRAL_ENABLED: value,
    }), { allowed: true, deferred: false, missingEmployeeIds: [], message: null });
  }
});
test("a permitted draft with positive net and no bank still has a blocking assurance finding", () => {
  assert.equal(payrollDraftPayoutReadiness(incomplete, { PAYROLL_DRAFT_PAYOUT_DEFERRAL_ENABLED: "true" }).allowed, true);
  const report = evaluatePayrollAssurance([{
    id: 1, employeeId: 10, grossPay: "1000", deductions: "100", netPay: "900", status: "Ready",
    lineItems: [{ code: "BASIC", label: "Basic", amount: "1000" }, { code: "SSS", label: "SSS", amount: "-100" }],
    trace: { flags: [] },
  }], [], { employees: [{ id: 10, bankAccount: null, bankCode: null }] });
  assert.ok(report.findings.some(f => f.code === "MISSING_BANK_DETAILS" && f.blocking));
  assert.ok(report.summary.blocking > 0);
});
