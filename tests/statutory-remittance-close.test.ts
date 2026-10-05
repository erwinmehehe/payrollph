import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRemittanceMonthClose } from "../src/lib/statutory-remittance-close";

const reconciledBatch = {
  id: 1,
  agency: "SSS",
  applicableMonth: "2026-09",
  status: "reconciled",
  snapshotHash: "abc",
  reconciledAt: "2026-10-20T00:00:00.000Z",
  paymentRecordedBy: "Payroll A",
  reconciledBy: "Payroll B",
  pendingPostingCount: 0,
  exceptionCount: 0,
};

const paymentEvidence = [{
  id: 11,
  batchId: 1,
  fileName: "sss-payment.pdf",
  fileSha256: "a".repeat(64),
  byteSize: 1200,
  status: "active",
  uploadedByName: "Payroll A",
  uploadedAt: "2026-10-15T00:00:00.000Z",
}];

test("remittance month close is ready only when tracked evidence is fully reconciled", () => {
  const result = evaluateRemittanceMonthClose({
    applicableMonth: "2026-09",
    batches: [reconciledBatch],
    members: [{
      batchId: 1,
      employeeId: 10,
      postingStatus: "confirmed",
      postedAmount: "1000.00",
      postingReference: "POST-1",
      confirmedBy: "Payroll B",
    }],
    alerts: [],
    paymentEvidence,
    requiredAgencies: ["SSS"],
    allPayrollRunsReleased: true,
  });

  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
  assert.match(result.snapshotHash, /^[a-f0-9]{64}$/);
});

test("active alerts and unreconciled batches block month certification", () => {
  const result = evaluateRemittanceMonthClose({
    applicableMonth: "2026-09",
    batches: [{
      ...reconciledBatch,
      status: "paid",
      pendingPostingCount: 1,
    }],
    members: [],
    paymentEvidence,
    alerts: [{
      agency: "SSS",
      applicableMonth: "2026-09",
      title: "SSS payment recorded, member posting still unconfirmed",
      tone: "warning",
    }],
    requiredAgencies: ["SSS"],
    allPayrollRunsReleased: true,
  });

  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((value) => /unconfirmed/i.test(value)));
  assert.ok(result.blockers.some((value) => /not reconciled/i.test(value)));
});

test("no remittance batches cannot produce a false green month close", () => {
  const result = evaluateRemittanceMonthClose({
    applicableMonth: "2026-09",
    batches: [],
    members: [],
    alerts: [],
    paymentEvidence,
    requiredAgencies: ["SSS"],
    allPayrollRunsReleased: true,
  });

  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes("No remittance batches exist for this month."));
});

test("snapshot changes when employee posting evidence changes", () => {
  const base = {
    applicableMonth: "2026-09",
    batches: [reconciledBatch],
    alerts: [],
    paymentEvidence,
    requiredAgencies: ["SSS"],
    allPayrollRunsReleased: true,
  };
  const before = evaluateRemittanceMonthClose({
    ...base,
    members: [{
      batchId: 1,
      employeeId: 10,
      postingStatus: "confirmed",
      postedAmount: "1000.00",
      postingReference: "POST-1",
    }],
  });
  const after = evaluateRemittanceMonthClose({
    ...base,
    members: [{
      batchId: 1,
      employeeId: 10,
      postingStatus: "confirmed",
      postedAmount: "1000.00",
      postingReference: "POST-2",
    }],
  });

  assert.notEqual(before.snapshotHash, after.snapshotHash);
});


test("unreleased payroll blocks remittance month close", () => {
  const result = evaluateRemittanceMonthClose({
    applicableMonth: "2026-09",
    batches: [reconciledBatch],
    members: [],
    alerts: [],
    paymentEvidence,
    requiredAgencies: ["SSS"],
    allPayrollRunsReleased: false,
  });

  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((value) => /Every payroll run/i.test(value)));
});

test("missing required agency batch blocks remittance month close", () => {
  const result = evaluateRemittanceMonthClose({
    applicableMonth: "2026-09",
    batches: [reconciledBatch],
    members: [],
    alerts: [],
    paymentEvidence,
    requiredAgencies: ["SSS", "PhilHealth"],
    allPayrollRunsReleased: true,
  });

  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((value) => /PhilHealth remittance batch is missing/i.test(value)));
});


test("approved correction changes the close snapshot and is preserved in certification evidence", () => {
  const base = {
    applicableMonth: "2026-09",
    batches: [reconciledBatch],
    members: [{
      batchId: 1,
      employeeId: 10,
      postingStatus: "confirmed",
      postedAmount: "1000.00",
      postingReference: "POST-1",
      confirmedBy: "Payroll B",
    }],
    alerts: [],
    paymentEvidence,
    requiredAgencies: ["SSS"],
    allPayrollRunsReleased: true,
  };
  const before = evaluateRemittanceMonthClose({ ...base, corrections: [] });
  const after = evaluateRemittanceMonthClose({
    ...base,
    corrections: [{
      id: 90,
      batchId: 1,
      memberId: 10,
      status: "approved",
      decidedByName: "Checker C",
      appliedAt: "2026-10-21T01:00:00.000Z",
    }],
  });
  assert.notEqual(before.snapshotHash, after.snapshotHash);
  assert.equal(after.corrections[0]?.decidedByName, "Checker C");
  assert.equal(after.batches[0]?.paymentRecordedBy, "Payroll A");
  assert.equal(after.members[0]?.confirmedBy, "Payroll B");
});


test("unresolved employee contribution issue blocks month certification", () => {
  const result = evaluateRemittanceMonthClose({
    applicableMonth: "2026-09",
    batches: [reconciledBatch],
    members: [{
      batchId: 1,
      employeeId: 10,
      postingStatus: "confirmed",
      postedAmount: "1000.00",
      postingReference: "POST-1",
      confirmedBy: "Payroll B",
    }],
    alerts: [],
    issueCases: [{
      id: 501,
      employeeId: 10,
      agency: "SSS",
      applicableMonth: "2026-09",
      issueType: "missing_posting",
      status: "open",
      reportedByName: "Employee A",
      createdAt: "2026-10-22T00:00:00.000Z",
    }],
    requiredAgencies: ["SSS"],
    allPayrollRunsReleased: true,
  });

  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((value) => /employee contribution issue case/i.test(value)));
  assert.equal(result.issueCases.length, 1);
});

test("employee issue history permanently changes certification snapshot even after resolution", () => {
  const base = {
    applicableMonth: "2026-09",
    batches: [reconciledBatch],
    members: [{
      batchId: 1,
      employeeId: 10,
      postingStatus: "confirmed",
      postedAmount: "1000.00",
      postingReference: "POST-1",
      confirmedBy: "Payroll B",
    }],
    alerts: [],
    paymentEvidence,
    requiredAgencies: ["SSS"],
    allPayrollRunsReleased: true,
  };

  const original = evaluateRemittanceMonthClose({
    ...base,
    issueCases: [],
  });

  const resolved = evaluateRemittanceMonthClose({
    ...base,
    issueCases: [{
      id: 501,
      employeeId: 10,
      agency: "SSS",
      applicableMonth: "2026-09",
      issueType: "missing_posting",
      status: "resolved",
      reportedByName: "Employee A",
      assignedToName: "Payroll C",
      resolutionOutcome: "posting_confirmed",
      resolutionNote: "Agency posting was reconciled and employee was notified.",
      resolvedByName: "Payroll C",
      createdAt: "2026-10-22T00:00:00.000Z",
      resolvedAt: "2026-10-23T00:00:00.000Z",
    }],
  });

  assert.equal(resolved.ready, true);
  assert.notEqual(original.snapshotHash, resolved.snapshotHash);
  assert.equal(resolved.issueCases[0]?.resolvedByName, "Payroll C");
});
