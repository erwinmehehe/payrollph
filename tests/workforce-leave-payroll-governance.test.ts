import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveApprovedLeaveForPayroll } from "../src/lib/leave-payroll";

const request = {
  id: 41,
  leaveType: "Vacation",
  startDate: "2026-10-06",
  endDate: "2026-10-06",
  days: 1,
};

test("approved leave payroll treatment is explicit for paid unpaid and partial leave", () => {
  const paid = resolveApprovedLeaveForPayroll({
    requests: [request],
    policies: [{ leaveType: "Vacation", payTreatment: "paid", paidPercentage: 100 }],
    periodStart: "2026-10-01",
    periodEnd: "2026-10-15",
  })[0];
  assert.equal(paid.payTreatment, "paid");
  assert.equal(paid.paidDays, 1);
  assert.equal(paid.unpaidDays, 0);

  const unpaid = resolveApprovedLeaveForPayroll({
    requests: [request],
    policies: [{ leaveType: "Vacation", payTreatment: "unpaid", paidPercentage: 0 }],
    periodStart: "2026-10-01",
    periodEnd: "2026-10-15",
  })[0];
  assert.equal(unpaid.payTreatment, "unpaid");
  assert.equal(unpaid.paidDays, 0);
  assert.equal(unpaid.unpaidDays, 1);

  const partial = resolveApprovedLeaveForPayroll({
    requests: [request],
    policies: [{ leaveType: "Vacation", payTreatment: "partial", paidPercentage: 50 }],
    periodStart: "2026-10-01",
    periodEnd: "2026-10-15",
  })[0];
  assert.equal(partial.payTreatment, "partial");
  assert.equal(partial.paidDays, 0.5);
  assert.equal(partial.unpaidDays, 0.5);
});

test("approved leave without a policy fails payroll closed", () => {
  assert.throws(() => resolveApprovedLeaveForPayroll({
    requests: [request],
    policies: [],
    periodStart: "2026-10-01",
    periodEnd: "2026-10-15",
  }), /has no leave policy.*Configure its payroll treatment/i);
});

test("approved leave with unconfigured or invalid treatment fails payroll closed", () => {
  assert.throws(() => resolveApprovedLeaveForPayroll({
    requests: [request],
    policies: [{ leaveType: "Vacation", payTreatment: "unconfigured", paidPercentage: 0 }],
    periodStart: "2026-10-01",
    periodEnd: "2026-10-15",
  }), /no configured payroll treatment/i);

  assert.throws(() => resolveApprovedLeaveForPayroll({
    requests: [request],
    policies: [{ leaveType: "Vacation", payTreatment: "partial", paidPercentage: 100 }],
    periodStart: "2026-10-01",
    periodEnd: "2026-10-15",
  }), /invalid paid percentage/i);
});

test("overlapping approved leave fails payroll closed instead of double-counting absence", () => {
  assert.throws(() => resolveApprovedLeaveForPayroll({
    requests: [
      { ...request, id: 41, startDate: "2026-10-06", endDate: "2026-10-07", days: 2 },
      { ...request, id: 42, startDate: "2026-10-07", endDate: "2026-10-08", days: 2 },
    ],
    policies: [{ leaveType: "Vacation", payTreatment: "paid", paidPercentage: 100 }],
    periodStart: "2026-10-01",
    periodEnd: "2026-10-15",
  }), /overlap.*Resolve the duplicate leave coverage before calculating payroll/i);
});

test("payroll engine resolves approved leave through the fail-closed treatment resolver", () => {
  const engine = readFileSync("src/lib/payroll-engine.ts", "utf8");
  assert.ok(engine.includes("resolveApprovedLeaveForPayroll({"));
  assert.ok(engine.includes("payTreatment: policy.payTreatment"));
  assert.ok(engine.includes("approvedLeaveByEmployee.set(employeeId, resolved)"));
});
