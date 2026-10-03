import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOwnerReleaseSummary,
  employerStatutoryCostFromTrace,
} from "../src/lib/owner-release-summary";

test("reads employer statutory cost from the stored payroll trace", () => {
  assert.equal(
    employerStatutoryCostFromTrace({
      trace: { inputs: ["rule=PH-2026.03", "employerStatutoryCost=2350.50"] },
    }),
    2350.5,
  );
  assert.equal(employerStatutoryCostFromTrace({ trace: { inputs: [] } }), null);
});

test("owner funding requirement is gross payroll plus employer statutory cost", () => {
  const result = buildOwnerReleaseSummary({
    runStatus: "Ready for release",
    grossPay: "100000",
    netPay: "82000",
    approvalStatus: "Approved",
    entries: [
      { trace: { inputs: ["employerStatutoryCost=3000.00"] } },
      { trace: { inputs: ["employerStatutoryCost=2500.00"] } },
    ],
    checklist: [
      { key: "approval", label: "Checker approval", passed: true, blocking: true, detail: "approved" },
      { key: "bank", label: "Payout readiness", passed: true, blocking: true, detail: "ready" },
    ],
  });
  assert.equal(result.employerStatutoryCost, 5500);
  assert.equal(result.totalFundingRequirement, 105500);
  assert.equal(result.canRelease, true);
});

test("hard blockers prevent owner release but acknowledgeable exceptions do not hide final sign-off", () => {
  const blocked = buildOwnerReleaseSummary({
    runStatus: "Ready for release",
    grossPay: "100000",
    netPay: "82000",
    approvalStatus: "Approved",
    entries: [{ trace: { inputs: ["employerStatutoryCost=3000.00"] } }],
    checklist: [
      { key: "bank", label: "Payout readiness", passed: false, blocking: true, detail: "missing bank" },
    ],
  });
  assert.equal(blocked.canRelease, false);
  assert.equal(blocked.hardBlockers.length, 1);

  const reviewable = buildOwnerReleaseSummary({
    runStatus: "Ready for release",
    grossPay: "100000",
    netPay: "82000",
    approvalStatus: "Approved",
    entries: [{ trace: { inputs: ["employerStatutoryCost=3000.00"] } }],
    checklist: [
      { key: "exceptions", label: "Exceptions", passed: false, blocking: true, acknowledgeable: true, detail: "review" },
    ],
  });
  assert.equal(reviewable.canRelease, true);
  assert.equal(reviewable.acknowledgementItems.length, 1);
});

test("checker approval and release state remain mandatory", () => {
  const pending = buildOwnerReleaseSummary({
    runStatus: "Pending approval",
    grossPay: "100000",
    netPay: "82000",
    approvalStatus: "Pending",
    entries: [{ trace: { inputs: ["employerStatutoryCost=3000.00"] } }],
    checklist: [],
  });
  assert.equal(pending.canRelease, false);
  assert.equal(pending.checkerApproved, false);
});

test("funding total is withheld when trace coverage is incomplete", () => {
  const result = buildOwnerReleaseSummary({
    runStatus: "Ready for release",
    grossPay: "100000",
    netPay: "82000",
    approvalStatus: "Approved",
    entries: [
      { trace: { inputs: ["employerStatutoryCost=3000.00"] } },
      { trace: { inputs: [] } },
    ],
    checklist: [],
  });
  assert.equal(result.employerStatutoryCost, null);
  assert.equal(result.totalFundingRequirement, null);
  assert.equal(result.employerCostCoverage, 1);
});
