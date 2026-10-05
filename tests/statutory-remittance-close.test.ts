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
  pendingPostingCount: 0,
  exceptionCount: 0,
};

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
    }],
    alerts: [],
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
    requiredAgencies: ["SSS", "PhilHealth"],
    allPayrollRunsReleased: true,
  });

  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((value) => /PhilHealth remittance batch is missing/i.test(value)));
});
