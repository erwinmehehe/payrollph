import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { finalPaySignedBalance } from "../src/lib/final-pay-signed-balance";
import { finalPayReviewCsv, finalPayReviewShortfall } from "../src/lib/final-pay-review-evidence";
import { thirteenthMonthFromCentavos } from "../src/lib/thirteenth-month-centavos";
const record = { id: 1, employeeName: "Fictional worker", employeeNo: "FICT", grossFinalPay: "0.00", taxAdjustment: "-7500.00", finalStatutoryDeductions: "0.00", loanDeductions: "0.00", netFinalPay: "0.00", computationSnapshot: { unpaidTaxWithholding: 7500, unpaidStatutoryDeductions: 0 } };
test("signed review preserves deficit, separates unknown evidence and never changes payout or holds", () => {
  assert.equal(finalPaySignedBalance(record), -7500);
  assert.equal(finalPayReviewShortfall(record).reconciliationRequired, true);
  assert.equal(record.netFinalPay, "0.00");
  assert.equal(finalPaySignedBalance({ ...record, grossFinalPay: "10000.00", taxAdjustment: "500.00", finalStatutoryDeductions: "100.00", loanDeductions: "200.00" }), 10200);
  for (const bad of [null, undefined, "", "0.001", NaN, Infinity, "bad"]) assert.equal(finalPaySignedBalance({ ...record, grossFinalPay: bad }), null);
  assert.equal(finalPaySignedBalance({ ...record, loanDeductions: "-1.00" }), null);
  const legacy = finalPayReviewCsv(record);
  // Captured by executing the pre-change helper at a8b01b510 on this record.
  assert.equal(createHash("sha256").update(legacy).digest("hex"), "7678a66c8d27f822ae69444a31e180008f23aa26eeaca2c318a06a09267337cd");
  assert.equal(legacy.includes("Signed reconciliation"), false);
  assert.equal(finalPayReviewCsv(record, false), legacy);
  assert.match(finalPayReviewCsv(record, true), /Signed reconciliation balance/);
  assert.match(finalPayReviewCsv(record, true), /-7500\.00/);
  assert.match(finalPayReviewCsv(record, true), /BLOCKED - FINANCE\/PAYROLL/);
});
test("all twelve exact-centavo division residues match independently computed BigInt half-up", () => {
  for (const base of [0, 12000000, 1200000000000, 99999999999000]) for (let residue = 0; residue < 12; residue++) {
    const cents = base + residue;
    const expected = Number((BigInt(cents) + BigInt(6)) / BigInt(12)) / 100;
    assert.equal(thirteenthMonthFromCentavos(cents / 100), expected);
  }
  for (const invalid of [-1, NaN, Infinity, 0.001, 1000000000001, 1e20]) assert.throws(() => thirteenthMonthFromCentavos(invalid));
});
