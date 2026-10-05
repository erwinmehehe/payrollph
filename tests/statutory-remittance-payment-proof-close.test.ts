import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRemittanceMonthClose } from "../src/lib/statutory-remittance-close";

const batch = {
  id: 1,
  agency: "SSS",
  applicableMonth: "2026-09",
  status: "reconciled",
  snapshotHash: "payroll-snapshot",
  reconciledAt: "2026-10-20T00:00:00Z",
  paymentRecordedBy: "Payroll Officer",
  reconciledBy: "Payroll Officer",
  pendingPostingCount: 0,
  exceptionCount: 0,
};

const member = {
  batchId: 1,
  employeeId: 10,
  postingStatus: "confirmed",
  postedAmount: "1000.00",
  postingReference: "POST-1",
  confirmedBy: "Payroll Officer",
};

function evaluate(fileSha256?: string) {
  return evaluateRemittanceMonthClose({
    applicableMonth: "2026-09",
    batches: [batch],
    members: [member],
    alerts: [],
    corrections: [],
    issueCases: [],
    paymentEvidence: fileSha256 ? [{
      id: 11,
      batchId: 1,
      fileName: "sss-receipt.pdf",
      fileSha256,
      byteSize: 1200,
      status: "active",
      uploadedByName: "Payroll Officer",
      uploadedAt: "2026-10-15T00:00:00Z",
    }] : [],
    requiredAgencies: ["SSS"],
    allPayrollRunsReleased: true,
  });
}

test("month close is blocked when reconciled batch has no active payment proof", () => {
  const result = evaluate();
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((item) => /no active hashed payment proof/i.test(item)));
});

test("payment proof hash participates in the immutable month-close snapshot", () => {
  const first = evaluate("a".repeat(64));
  const second = evaluate("b".repeat(64));
  assert.equal(first.ready, true);
  assert.equal(second.ready, true);
  assert.notEqual(first.snapshotHash, second.snapshotHash);
  assert.equal(first.paymentEvidence[0].fileSha256, "a".repeat(64));
});
