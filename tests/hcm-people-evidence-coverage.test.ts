import assert from "node:assert/strict";
import test from "node:test";
import { describePeopleEvidenceCoverage } from "../src/lib/hcm-people-evidence-coverage";

test("partial roster cannot be labelled fully covered", () => {
  const state = describePeopleEvidenceCoverage({ eligible: 12, verified: 9, unverified: 3, percent: 75 });
  assert.equal(state.status, "partial");
  assert.equal(state.label, "Partial coverage");
  assert.match(state.detail, /9 of 12/);
  assert.match(state.detail, /not treated as zero/);
});

test("full status coverage is qualified to one source, not an enterprise-wide certification", () => {
  const state = describePeopleEvidenceCoverage({ eligible: 5, verified: 5, unverified: 0, percent: 100 });
  assert.equal(state.status, "verified");
  assert.match(state.detail, /Other metrics have independent source limits/);
});

test("an empty eligible scope does not imply entire employer has zero workers", () => {
  const state = describePeopleEvidenceCoverage({ eligible: 0, verified: 0, unverified: 0, percent: 100 });
  assert.equal(state.status, "empty-scope");
  assert.match(state.detail, /does not establish company-wide headcount/);
});
