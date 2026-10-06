import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSiteEligibility } from "../src/lib/hcm-worksite-eligibility";

const office = { id: 10, active: true, siteType: "office" };
const remote = { id: 20, active: true, siteType: "remote_hub" };
const primary = [{
  id: 1, employeeId: 99, worksiteId: 10,
  effectiveFrom: "2026-01-01", effectiveUntil: null,
}];
const base = {
  employeeId: 99, date: "2026-10-06", sites: [office, remote],
  primaryAssignments: primary,
  arrangements: [],
  authorizations: [],
};

test("authoritative primary site is permitted", () => {
  const result = evaluateSiteEligibility({ ...base, worksiteId: 10 });
  assert.equal(result.status, "eligible");
  assert.equal(result.source, "primary");
});

test("cross-site demand must have effective secondary authorization", () => {
  const denied = evaluateSiteEligibility({ ...base, worksiteId: 20 });
  assert.equal(denied.eligible, false);
  const granted = evaluateSiteEligibility({
    ...base, worksiteId: 20,
    authorizations: [{
      id: 5, employeeId: 99, worksiteId: 20,
      effectiveFrom: "2026-01-01", effectiveUntil: "2026-10-06",
    }],
  });
  assert.equal(granted.eligible, true);
  assert.equal(granted.source, "authorization");
  assert.equal(evaluateSiteEligibility({
    ...base, date: "2026-10-07", worksiteId: 20,
    authorizations: [{
      id: 5, employeeId: 99, worksiteId: 20,
      effectiveFrom: "2026-01-01", effectiveUntil: "2026-10-06",
    }],
  }).eligible, false);
});

test("arrangement mode prevents incompatible physical/remote sites", () => {
  const arrangement = (mode: string) => [{
    id: 11, employeeId: 99, mode, effectiveFrom: "2026-01-01", effectiveUntil: null,
  }];
  assert.equal(evaluateSiteEligibility({ ...base, worksiteId: 10, arrangements: arrangement("remote") }).eligible, false);
  assert.equal(evaluateSiteEligibility({
    ...base, worksiteId: 20, arrangements: arrangement("onsite"),
    authorizations: [{ id: 15, employeeId: 99, worksiteId: 20, effectiveFrom: "2026-01-01", effectiveUntil: null }],
  }).eligible, false);
  assert.equal(evaluateSiteEligibility({
    ...base, worksiteId: 20, arrangements: arrangement("hybrid"),
    authorizations: [{ id: 16, employeeId: 99, worksiteId: 20, effectiveFrom: "2026-01-01", effectiveUntil: null }],
  }).eligible, true);
});

test("legacy workers are visible as ungoverned, not silently excluded from coverage", () => {
  const result = evaluateSiteEligibility({
    ...base, worksiteId: 10, primaryAssignments: [],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.status, "warning");
  assert.equal(result.source, "legacy");
  assert.match(result.warnings.join(" "), /not yet governed/i);
  const governed = evaluateSiteEligibility({
    ...base, worksiteId: 10, primaryAssignments: [],
    arrangements: [{ id: 2, employeeId: 99, mode: "onsite", effectiveFrom: "2026-01-01", effectiveUntil: null }],
  });
  assert.equal(governed.eligible, false);
});

test("inactive worksite always blocks eligibility", () => {
  const result = evaluateSiteEligibility({
    ...base, worksiteId: 10, sites: [{ ...office, active: false }, remote],
  });
  assert.equal(result.eligible, false);
});


test("effective deny overrides the authoritative primary site", () => {
  const result = evaluateSiteEligibility({
    ...base,
    worksiteId: 10,
    authorizations: [{
      id: 30,
      employeeId: 99,
      worksiteId: 10,
      decision: "deny" as const,
      effectiveFrom: "2026-10-01",
      effectiveUntil: null,
    }],
  });
  assert.equal(result.eligible, false);
  assert.match(result.blockers.join(" "), /denied|restricted/i);
});

test("effective deny overrides an overlapping allow and expiry restores allow", () => {
  const evidence = [{
    id: 31,
    employeeId: 99,
    worksiteId: 20,
    decision: "allow" as const,
    effectiveFrom: "2026-01-01",
    effectiveUntil: null,
  }, {
    id: 32,
    employeeId: 99,
    worksiteId: 20,
    decision: "deny" as const,
    effectiveFrom: "2026-10-01",
    effectiveUntil: "2026-10-06",
  }];

  assert.equal(evaluateSiteEligibility({
    ...base,
    worksiteId: 20,
    authorizations: evidence,
  }).eligible, false);

  assert.equal(evaluateSiteEligibility({
    ...base,
    date: "2026-10-07",
    worksiteId: 20,
    authorizations: evidence,
  }).eligible, true);
});


test("site eligibility exposes stable finding codes", () => {
  const denied = evaluateSiteEligibility({
    ...base,
    worksiteId: 10,
    authorizations: [{
      id: 40, employeeId: 99, worksiteId: 10, decision: "deny" as const,
      effectiveFrom: "2026-10-01", effectiveUntil: null,
    }],
  });
  assert.ok(denied.findings.some((finding) => finding.code === "SITE_EXPLICITLY_DENIED" && finding.severity === "blocker"));

  const unauthorized = evaluateSiteEligibility({ ...base, worksiteId: 20 });
  assert.ok(unauthorized.findings.some((finding) => finding.code === "SITE_NOT_AUTHORIZED"));

  const inactive = evaluateSiteEligibility({
    ...base,
    worksiteId: 10,
    sites: [{ ...office, active: false }, remote],
  });
  assert.ok(inactive.findings.some((finding) => finding.code === "SITE_INACTIVE"));

  const mismatch = evaluateSiteEligibility({
    ...base,
    worksiteId: 10,
    arrangements: [{
      id: 41, employeeId: 99, mode: "remote", effectiveFrom: "2026-01-01", effectiveUntil: null,
    }],
  });
  assert.ok(mismatch.findings.some((finding) => finding.code === "WORK_ARRANGEMENT_SITE_MISMATCH"));

  const legacy = evaluateSiteEligibility({
    ...base,
    worksiteId: 10,
    primaryAssignments: [],
  });
  assert.ok(legacy.findings.some((finding) => finding.code === "SITE_GOVERNANCE_UNCONFIGURED" && finding.severity === "warning"));
});
