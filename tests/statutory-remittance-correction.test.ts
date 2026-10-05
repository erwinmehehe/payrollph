import assert from "node:assert/strict";
import test from "node:test";
import {
  batchPaymentSnapshot,
  memberPostingSnapshot,
  snapshotsMatch,
  validatePaymentCorrection,
  validatePostingCorrection,
} from "../src/lib/statutory-remittance-correction";

test("payment evidence snapshot is stable and normalizes dates", () => {
  const snapshot = batchPaymentSnapshot({
    amountPaid: "1000.00",
    paymentReference: "PRN-1",
    agencyReceiptReference: "OR-1",
    paymentChannel: "Portal",
    paymentVarianceNote: null,
    paidAt: "2026-10-10T02:00:00.000Z",
    paymentRecordedBy: "Payroll A",
  });
  assert.deepEqual(snapshot, {
    amountPaid: "1000.00",
    paymentReference: "PRN-1",
    agencyReceiptReference: "OR-1",
    paymentChannel: "Portal",
    paymentVarianceNote: null,
    paidAt: "2026-10-10T02:00:00.000Z",
    paymentRecordedBy: "Payroll A",
  });
});

test("posting snapshot preserves original confirmer identity", () => {
  const snapshot = memberPostingSnapshot({
    postingStatus: "confirmed",
    postingReference: "POST-1",
    postedAmount: "750.00",
    postedAt: "2026-10-12T01:00:00.000Z",
    confirmedBy: "Payroll B",
    exceptionNote: null,
  });
  assert.equal(snapshot.confirmedBy, "Payroll B");
  assert.equal(snapshot.postedAmount, "750.00");
});

test("snapshot comparison fails closed on any evidence mutation", () => {
  assert.equal(snapshotsMatch(
    { paymentReference: "A", amountPaid: "100.00" },
    { paymentReference: "A", amountPaid: "100.00" },
  ), true);
  assert.equal(snapshotsMatch(
    { paymentReference: "A", amountPaid: "100.00" },
    { paymentReference: "B", amountPaid: "100.00" },
  ), false);
});

test("payment correction still blocks underpayment", () => {
  const gate = validatePaymentCorrection({
    expectedTotal: 1000,
    proposed: {
      amountPaid: 999,
      paymentReference: "PRN-2",
      agencyReceiptReference: "OR-2",
      paymentChannel: "Portal",
      paymentVarianceNote: null,
      paidAt: "2026-10-10T02:00:00.000Z",
    },
  });
  assert.equal(gate.ok, false);
});

test("posting correction still requires exact employee contribution amount", () => {
  const bad = validatePostingCorrection({
    expectedTotal: 750,
    proposed: {
      postingReference: "POST-2",
      postedAmount: 700,
      postedAt: "2026-10-12T01:00:00.000Z",
    },
  });
  assert.equal(bad.ok, false);

  const good = validatePostingCorrection({
    expectedTotal: 750,
    proposed: {
      postingReference: "POST-3",
      postedAmount: 750,
      postedAt: "2026-10-12T01:00:00.000Z",
    },
  });
  assert.equal(good.ok, true);
});
