import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HcmCompensationWhatIfDetails } from "../src/components/hcm-compensation-whatif-details";
import { previewCompensationProposal } from "../src/lib/hcm-compensation-proposal-whatif";

const band = { minimumAnnual: "100000.00", midpointAnnual: "150000.00", maximumAnnual: "200000.00" };
const pool = {
  state: "available" as const, committedAnnual: 50000, pendingAnnual: 60000,
  remainingAnnual: 100000, overCommittedAnnual: 0, potentialOverBudgetAnnual: 0,
  pendingCount: 1, committedCount: 1, authorizesCompensation: false as const,
};

test("salary preview shows source-only what-if and suppresses budget in restricted role DOM", () => {
  const projection = previewCompensationProposal({
    currentAnnual: 150000, proposedAnnual: "190000.25", selectedBand: band,
    authorizedCycleBudget: pool, hasExistingProposal: false,
  });
  assert.equal(projection.state, "ready");
  const owner = renderToStaticMarkup(createElement(HcmCompensationWhatIfDetails, {
    impact: projection, companyWide: true,
  }));
  assert.match(owner, /Hypothetical pool remaining/);
  assert.match(owner, /compa-ratio/);
  assert.match(owner, /salary-band position/);

  // Even with a populated caller projection, restricted viewers must not
  // receive the aggregate compensation pool in HTML.
  const restricted = renderToStaticMarkup(createElement(HcmCompensationWhatIfDetails, {
    impact: projection, companyWide: false,
  }));
  assert.match(restricted, /budget totals are not available/);
  assert.doesNotMatch(restricted, /Hypothetical pool remaining|Potential budget excess/);
});

test("render warnings for outside-band proposal and budget exceedance", () => {
  const result = previewCompensationProposal({
    currentAnnual: 150000, proposedAnnual: "240000.00", selectedBand: band,
    authorizedCycleBudget: { ...pool, remainingAnnual: 1000 }, hasExistingProposal: false,
  });
  const html = renderToStaticMarkup(createElement(HcmCompensationWhatIfDetails, {
    impact: result, companyWide: true,
  }));
  assert.match(html, /outside the selected band/);
  assert.match(html, /Potential budget excess/);
  assert.match(html, /not effective-dated/);
});

test("existing worker proposal prevents a duplicate provisional budget estimate", () => {
  const result = previewCompensationProposal({
    currentAnnual: 150000, proposedAnnual: "180000.00", selectedBand: band,
    authorizedCycleBudget: pool, hasExistingProposal: true,
  });
  const html = renderToStaticMarkup(createElement(HcmCompensationWhatIfDetails, {
    impact: result, companyWide: true,
  }));
  assert.match(html, /already has an in-flight or applied proposal/);
  assert.match(html, /Full budget estimate unavailable/);
  assert.doesNotMatch(html, /Hypothetical pool remaining/);
});

test("invalid source data never displays monetary amounts", () => {
  const html = renderToStaticMarkup(createElement(HcmCompensationWhatIfDetails, {
    impact: {state: "unavailable", reason: "Salary source evidence unavailable.", authorizesCompensation: false},
    companyWide: true,
  }));
  assert.match(html, /Salary source evidence unavailable/);
  assert.doesNotMatch(html, /Hypothetical pool remaining|salary-band position|Current ₱/);
});

test("the parent compensation screen masks stale employer data and stale responses", () => {
  const source = readFileSync("src/components/compensation-panel.tsx", "utf8");
  assert.ok(source.includes("loadedOrganizationId !== organizationId"));
  assert.ok(source.includes("requestSequence.current !== requestId"));
  assert.ok(source.includes("requestSequence.current++"));
  assert.ok(source.includes("setLoadedOrganizationId(organizationId)"));
  assert.ok(source.includes("setFailedLoad("));
  assert.ok(source.includes("<HcmCompensationWhatIfDetails"));
  assert.ok(source.includes("companyWide={access.companyWide}"));
  const component = readFileSync("src/components/hcm-compensation-whatif-details.tsx", "utf8");
  for (const operation of ["db.insert(", "db.update(", "db.delete(", "fetch(", "process.env"]) {
    assert.ok(!component.includes(operation));
  }
});
