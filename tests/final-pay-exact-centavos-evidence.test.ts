import assert from "node:assert/strict";
import test from "node:test";
import {
  storedMoneyCentavos, verifiedPesosFromCentavos,
} from "../src/lib/stored-money-centavos";
import { finalPaySignedBalance } from "../src/lib/final-pay-signed-balance";
import { unresolvedFinalPayMandatoryShortfall } from "../src/lib/final-pay";
import { finalPayReviewShortfall, finalPayReviewCsv } from "../src/lib/final-pay-review-evidence";

test("recorded decimal strings retain exact signed centavos, not floating approximations", () => {
  const cases: Array<readonly [string, number]> = [
    ["0", 0], ["0.00", 0], ["1", 100], ["1.2", 120],
    ["123.45", 12345], ["-0.01", -1], ["-123.45", -12345],
    ["90071992547400.02", 9007199254740002],
  ];
  for (const [value, cents] of cases) {
    assert.equal(storedMoneyCentavos(value), cents, value);
  }
  assert.equal(verifiedPesosFromCentavos(12345), 123.45);
  assert.equal(verifiedPesosFromCentavos(-1), -0.01);
});

test("cannot silently replace a stored one-cent value with a different cent", () => {
  // These inputs contain safe integer centavo counts, but converting the
  // corresponding pesos to Number changes the financial amount.
  for (const value of [
    "90071992547400.01", "90071992547409.90", "-90071992547400.01",
    "90071992547409.92",
  ]) {
    assert.equal(storedMoneyCentavos(value), null, value);
  }
  assert.equal(verifiedPesosFromCentavos(9007199254740001), null);
  assert.equal(verifiedPesosFromCentavos(-9007199254740001), null);
  assert.equal(storedMoneyCentavos(Number("90071992547400.01")), null);
});

test("missing, malformed, coercible and sub-centavo amounts remain unverified", () => {
  for (const value of [
    null, undefined, true, false, "", " ", "00.01", "1e2", "0x10",
    "1.001", "-0.001", "Infinity", NaN, Infinity,
    0.001, 1e-9, -1e-9, 1.000000001, 1e20,
  ]) {
    assert.equal(storedMoneyCentavos(value), null, String(value));
  }
  // Preserve useful Number inputs and harmless floating-point noise.
  assert.equal(storedMoneyCentavos(0.1 + 0.2), 30);
  assert.equal(storedMoneyCentavos(-0.01), -1);
});

test("final-pay balances and shortfall preflight reject unrepresentable derived cents", () => {
  const record = {
    id: 99, employeeNo: "TEST-99", employeeName: "Fictional Worker",
    grossFinalPay: "0.01",
    taxAdjustment: "-90071992547400.02",
    finalStatutoryDeductions: "0.00",
    loanDeductions: "0.00",
    netFinalPay: "0.00",
  };
  // Every source individually has a representable peso value. Arithmetic
  // produces +/- 90071992547400.01, which Number would display as .02.
  assert.equal(storedMoneyCentavos(record.grossFinalPay), 1);
  assert.equal(storedMoneyCentavos(record.taxAdjustment), -9007199254740002);
  assert.equal(finalPaySignedBalance(record), null);
  assert.equal(unresolvedFinalPayMandatoryShortfall(record), null);
  const shortfall = finalPayReviewShortfall(record);
  assert.equal(shortfall.total, null);
  assert.equal(shortfall.reconciliationRequired, true);
  assert.equal(shortfall.splitRecorded, false);
  const csv = finalPayReviewCsv(record, true);
  assert.ok(csv.includes('"Unpaid mandatory deductions (PHP)","UNVERIFIABLE"'));
  assert.ok(csv.includes('"Signed reconciliation balance (PHP; NOT a payout instruction)","UNVERIFIABLE"'));
  assert.ok(csv.includes("BLOCKED - FINANCE/PAYROLL RECONCILIATION REQUIRED"));
});

test("ordinary final-pay centavo arithmetic and zero-shortfall behavior are unchanged", () => {
  const record = {
    id: 100, employeeNo: "TEST-100", employeeName: "Fictional Worker",
    grossFinalPay: "100.01", taxAdjustment: "-0.01",
    finalStatutoryDeductions: "0.01", loanDeductions: "0.00",
    netFinalPay: "99.99",
  };
  assert.equal(finalPaySignedBalance(record), 99.99);
  assert.equal(unresolvedFinalPayMandatoryShortfall(record), 0);
  assert.equal(finalPayReviewShortfall(record).total, 0);
});
