import assert from "node:assert/strict";
import test from "node:test";
import { validateContributionDisputeResolution } from "../src/lib/statutory-contribution-dispute";

test("corrected contribution dispute requires a matching confirmed agency posting", () => {
  assert.equal(validateContributionDisputeResolution({
    resolutionCode: "corrected",
    member: null,
  }).ok, false);

  assert.equal(validateContributionDisputeResolution({
    resolutionCode: "corrected",
    member: {
      postingStatus: "pending",
      postedAmount: "1500.00",
      totalContribution: "1500.00",
    },
  }).ok, false);

  assert.equal(validateContributionDisputeResolution({
    resolutionCode: "posted_confirmed",
    member: {
      postingStatus: "confirmed",
      postedAmount: "1499.99",
      totalContribution: "1500.00",
    },
  }).ok, false);

  assert.equal(validateContributionDisputeResolution({
    resolutionCode: "posted_confirmed",
    member: {
      postingStatus: "confirmed",
      postedAmount: "1500.00",
      totalContribution: "1500.00",
    },
  }).ok, true);
});

test("documented non-error and duplicate resolutions do not require a posting row", () => {
  assert.equal(validateContributionDisputeResolution({
    resolutionCode: "not_an_error",
    member: null,
  }).ok, true);
  assert.equal(validateContributionDisputeResolution({
    resolutionCode: "duplicate",
    member: null,
  }).ok, true);
});
