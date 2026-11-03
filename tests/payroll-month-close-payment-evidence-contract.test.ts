import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateRemittanceMonthClose } from "../src/lib/statutory-remittance-close";

const server = readFileSync("src/lib/payroll-month-close-server.ts", "utf8");
const canonicalRoute = readFileSync("src/app/api/compliance/remittance-month-close/route.ts", "utf8");

test("payroll month close uses the same org and batch-scoped payment proof inputs as statutory remittance close", () => {
  for (const source of [server, canonicalRoute]) {
    assert.match(source, /const paymentEvidence = monthBatchIds\.length/);
    assert.match(source, /eq\(statutoryRemittancePaymentEvidence\.organizationId, organizationId\)/);
    assert.match(source, /inArray\(statutoryRemittancePaymentEvidence\.batchId, monthBatchIds\)/);
    assert.match(source, /const evaluation = evaluateRemittanceMonthClose\(\{[\s\S]*?corrections,\s+paymentEvidence,\s+issueCases,/);
  }
});

test("source readiness requires active hashed payment proof and does not trust reconciled status alone", () => {
  const input = {
    applicableMonth: "2026-09",
    batches: [{
      id: 91, agency: "SSS", applicableMonth: "2026-09", status: "reconciled",
      snapshotHash: "f".repeat(64), reconciledAt: "2026-10-01T00:00:00.000Z",
      paymentRecordedBy: "Fictional payment recorder", reconciledBy: "Fictional reconciler",
      pendingPostingCount: 0, exceptionCount: 0,
    }],
    members: [{
      batchId: 91, employeeId: 13, postingStatus: "confirmed",
      postedAmount: "1500.00", postingReference: "FICTIONAL-SSS-POSTING",
      confirmedBy: "Fictional reconciler",
    }],
    alerts: [], corrections: [], issueCases: [], requiredAgencies: ["SSS"],
    allPayrollRunsReleased: true,
  };
  const withoutProof = evaluateRemittanceMonthClose(input);
  assert.equal(withoutProof.ready, false);
  assert.ok(withoutProof.blockers.some((blocker) => blocker.includes("no active hashed payment proof")));
  const withProof = evaluateRemittanceMonthClose({
    ...input,
    paymentEvidence: [{
      id: 99, batchId: 91, status: "active", fileName: "fictional-only.txt",
      fileSha256: "e".repeat(64), byteSize: 30,
      uploadedByName: "Fictional evidence recorder", uploadedAt: "2026-10-01T00:00:00.000Z",
    }],
  });
  assert.equal(withProof.ready, true);
  assert.equal(withProof.blockers.length, 0);
  assert.equal(withProof.paymentEvidence.length, 1);
  assert.notEqual(withProof.snapshotHash, withoutProof.snapshotHash);
});
