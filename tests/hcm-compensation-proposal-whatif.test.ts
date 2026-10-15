import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { previewCompensationProposal } from "../src/lib/hcm-compensation-proposal-whatif";

const band = { minimumAnnual: "1000000.00", midpointAnnual: "1200000.00", maximumAnnual: "1400000.00" };
const budget = {
  state: "available" as const,
  committedAnnual: 200000,
  pendingAnnual: 100000,
  remainingAnnual: 300000,
  overCommittedAnnual: 0,
  potentialOverBudgetAnnual: 0,
  committedCount: 1,
  pendingCount: 1,
  authorizesCompensation: false as const,
};

test("salary what-if displays signed increase, proposed band position and full pending budget impact", () => {
  const result = previewCompensationProposal({
    currentAnnual: 1200000,
    proposedAnnual: "1320000.00",
    selectedBand: band,
    authorizedCycleBudget: budget,
    hasExistingProposal: false,
  });
  assert.equal(result.state, "ready");
  if (result.state !== "ready") return;
  assert.equal(result.changeAnnual, 120000);
  assert.equal(result.changePercent, 10);
  assert.equal(result.proposedCompaRatioPercent, 110);
  assert.equal(result.proposedRangePositionPercent, 80);
  assert.equal(result.withinSelectedBand, true);
  assert.equal(result.remainingIfAllProceedAnnual, 80000);
  assert.equal(result.possibleBudgetOverageAnnual, 0);
  assert.equal(result.authorizesCompensation, false);
});

test("out-of-range and over-budget proposals remain warnings, not approvals", () => {
  const result = previewCompensationProposal({
    currentAnnual: 1200000,
    proposedAnnual: "1500000.00",
    selectedBand: band,
    authorizedCycleBudget: { ...budget, remainingAnnual: 100000 },
    hasExistingProposal: false,
  });
  assert.equal(result.state, "ready");
  if (result.state !== "ready") return;
  assert.equal(result.withinSelectedBand, false);
  assert.equal(result.changeAnnual, 300000);
  assert.equal(result.remainingIfAllProceedAnnual, -300000);
  assert.equal(result.possibleBudgetOverageAnnual, 300000);
  assert.equal(result.authorizesCompensation, false);
});

test("salary reductions never fabricate reusable budget and existing proposal never double counts", () => {
  const cut = previewCompensationProposal({
    currentAnnual: 1200000,
    proposedAnnual: "1100000.00",
    selectedBand: band,
    authorizedCycleBudget: budget,
    hasExistingProposal: false,
  });
  assert.equal(cut.state, "ready");
  if (cut.state === "ready") {
    assert.equal(cut.changeAnnual, -100000);
    assert.equal(cut.remainingIfAllProceedAnnual, 200000);
  }
  const duplicate = previewCompensationProposal({
    currentAnnual: 1200000,
    proposedAnnual: "1320000",
    selectedBand: band,
    authorizedCycleBudget: budget,
    hasExistingProposal: true,
  });
  assert.equal(duplicate.state, "ready");
  if (duplicate.state === "ready") {
    assert.equal(duplicate.hasExistingProposal, true);
    assert.equal(duplicate.remainingIfAllProceedAnnual, null);
    assert.equal(duplicate.possibleBudgetOverageAnnual, null);
  }
});

test("missing company-wide budget and source failures hide budget totals", () => {
  for (const unavailable of [null, {state: "unavailable" as const, reason: "source error"}]) {
    const result = previewCompensationProposal({
      currentAnnual: 1200000,
      proposedAnnual: "1320000",
      selectedBand: band,
      authorizedCycleBudget: unavailable,
      hasExistingProposal: false,
    });
    assert.equal(result.state, "ready");
    if (result.state === "ready") {
      assert.equal(result.remainingIfAllProceedAnnual, null);
      assert.equal(result.possibleBudgetOverageAnnual, null);
    }
  }
});

test("malformed money, missing source pay and inconsistent bands fail closed", () => {
  for (const proposedAnnual of ["-10", "1e6", "Infinity", "200.999", "0", "9007199254740992", "abc"]) {
    const result = previewCompensationProposal({
      currentAnnual: 1200000,
      proposedAnnual, selectedBand: band,
      authorizedCycleBudget: budget, hasExistingProposal: false,
    });
    assert.equal(result.state, "unavailable", proposedAnnual);
  }
  assert.equal(previewCompensationProposal({
    currentAnnual: null, proposedAnnual: "1300000",
    selectedBand: band, authorizedCycleBudget: budget, hasExistingProposal: false,
  }).state, "unavailable");
  assert.equal(previewCompensationProposal({
    currentAnnual: 1200000, proposedAnnual: "1300000",
    selectedBand: { ...band, maximumAnnual: "1100000" },
    authorizedCycleBudget: budget, hasExistingProposal: false,
  }).state, "unavailable");
  assert.equal(previewCompensationProposal({
    currentAnnual: 1200000, proposedAnnual: "",
    selectedBand: band, authorizedCycleBudget: budget, hasExistingProposal: false,
  }).state, "incomplete");
});

test("what-if stays inside existing authorized compensation view and creates no writable authority", () => {
  const source = readFileSync("src/lib/hcm-compensation-proposal-whatif.ts", "utf8");
  const panel = readFileSync("src/components/compensation-panel.tsx", "utf8");
  assert.ok(panel.includes("previewCompensationProposal({"));
  assert.ok(panel.includes("authorizedCycleBudget: access?.companyWide"));
  assert.ok(panel.includes('post("proposal"'));
  assert.ok(panel.includes("role=\"status\""));
  for (const forbidden of ["db.insert(", "db.update(", "db.delete(", "fetch(", "pool.connect(", "process.env"]) {
    assert.ok(!source.includes(forbidden), "Read-only what-if cannot access " + forbidden);
  }
});
