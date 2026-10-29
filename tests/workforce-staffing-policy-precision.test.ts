import assert from "node:assert/strict";
import test from "node:test";
import { parseStaffingPolicyDraft, policySpec } from "../src/lib/workforce-demand-staffing-policy";

const candidate = {
  organizationId: 41,
  worksiteId: 7,
  jobProfileId: null,
  metricKind: "transactions",
  intervalMinutes: 15,
  effectiveFrom: "2027-01-01",
  effectiveUntil: "2027-01-31",
  productiveUnitsPerWorkerHour: 1.2345,
  serviceTargetCoveragePercent: 89.99,
  rationale: "Synthetic employer staffing policy",
  idempotencyKey: "fictional-policy-841",
};

test("valid staffing rate/coverage inputs round-trip the persisted decimal scale exactly", () => {
  for (const productivity of [0.01, 1.2345, 50, 1_000_000]) {
    for (const coverage of [0.01, 25.5, 89.99, 100]) {
      const draft = parseStaffingPolicyDraft({
        ...candidate,
        productiveUnitsPerWorkerHour: productivity,
        serviceTargetCoveragePercent: coverage,
      });
      assert.equal(draft.productiveUnitsPerWorkerHour,
        Number(draft.productiveUnitsPerWorkerHour.toFixed(4)));
      assert.equal(draft.serviceTargetCoveragePercent,
        Number(draft.serviceTargetCoveragePercent.toFixed(2)));
      assert.equal(policySpec(draft).productiveUnitsPerWorkerHour, productivity);
    }
  }
});

test("hidden fractional digits cannot be accepted and then changed by database rounding", () => {
  for (const productivity of [1.2345000001, 1.0000000001, 12.34567]) {
    assert.throws(() => parseStaffingPolicyDraft({
      ...candidate, productiveUnitsPerWorkerHour: productivity,
    }), /Exact, finite and effective-dated staffing policy evidence is required/);
  }
  for (const coverage of [89.9900000001, 75.0000000001, 99.999]) {
    assert.throws(() => parseStaffingPolicyDraft({
      ...candidate, serviceTargetCoveragePercent: coverage,
    }), /Exact, finite and effective-dated staffing policy evidence is required/);
  }
});

test("non-numeric, out-of-range and non-finite staffing terms remain rejected", () => {
  for (const invalid of ["1.5", null, true, NaN, Infinity, -1, 0, 1_000_001]) {
    assert.throws(() => parseStaffingPolicyDraft({
      ...candidate, productiveUnitsPerWorkerHour: invalid,
    }));
  }
});
